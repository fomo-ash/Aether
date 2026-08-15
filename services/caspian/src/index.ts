import { CommClient } from 'caspian-sdk';
import { PrismaClient } from '@flowpilot/database';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
if (!process.env.AETHER_API_URL) throw new Error('AETHER_API_URL is required for production.');
const AETHER_API_URL = process.env.AETHER_API_URL;

if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for production.');
const redisUrl = process.env.REDIS_URL;
const redis = new Redis(redisUrl);

function parseNaturalDeadline(str?: string): Date {
  if (!str) return new Date(Date.now() + 24 * 3600 * 1000);
  const trimmed = str.trim().toLowerCase();
  const now = Date.now();

  const minMatch = trimmed.match(/^(\d+)\s*(?:m|min|mins|minute|minutes)$/);
  if (minMatch) {
    return new Date(now + parseInt(minMatch[1], 10) * 60 * 1000);
  }

  const hrMatch = trimmed.match(/^(\d+)\s*(?:h|hr|hrs|hour|hours)$/);
  if (hrMatch) {
    return new Date(now + parseInt(hrMatch[1], 10) * 3600 * 1000);
  }

  const dayMatch = trimmed.match(/^(\d+)\s*(?:d|day|days)$/);
  if (dayMatch) {
    return new Date(now + parseInt(dayMatch[1], 10) * 24 * 3600 * 1000);
  }

  if (trimmed.includes('tomorrow')) {
    return new Date(now + 24 * 3600 * 1000);
  }

  if (trimmed.includes('next week')) {
    return new Date(now + 7 * 24 * 3600 * 1000);
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getTime() > now) {
    return parsed;
  }

  return new Date(now + 24 * 3600 * 1000);
}

async function bootstrap() {
  console.log(`[Caspian Ingress] Starting adapter...`);

  if (!process.env.CASPIAN_API_KEY) {
    console.warn(`[Caspian Ingress] WARNING: CASPIAN_API_KEY is missing. You will not be able to connect to real Caspian webhooks.`);
    // don't exit for local testing of the HTTP route
  }

  const client = new CommClient({
    apiKey: process.env.CASPIAN_API_KEY,
    baseUrl: process.env.CASPIAN_BASE_URL || 'https://api.trycaspianai.com'
  });

  // Connect Telegram if TELEGRAM_BOT_TOKEN is configured
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim() !== '') {
    const botToken = process.env.TELEGRAM_BOT_TOKEN.trim();
    try {
      console.log(`[Caspian Ingress] Connecting Telegram bot with Caspian SDK...`);
      const conn = await client.connectTelegram({ botToken });
      console.log(`[Caspian Ingress] Telegram connected successfully: ${conn.address || conn.id} (Status: ${conn.status})`);
    } catch (err: any) {
      const errMsg = err.message || String(err);
      if (errMsg.includes('409') || err.status === 409) {
        console.log(`[Caspian Ingress] Telegram bot token is already registered/active on Caspian project gateway.`);
      } else {
        console.error(`[Caspian Ingress] ERROR connecting Telegram bot to Caspian gateway: ${errMsg}`);
      }
    }
  } else {
    console.log(`[Caspian Ingress] TELEGRAM_BOT_TOKEN not provided. Telegram integration remains inactive.`);
  }

  client.onMessage(async (message: any) => {
    try {
      const receivedAt = Date.now();
      if (!message.text) {
        return;
      }

      // Normalize Telegram group slash commands (e.g. "/aether@AetherVerifierBot rep" -> "/aether rep")
      let cleanText = message.text.trim();
      if (cleanText.startsWith('/aether@')) {
        cleanText = cleanText.replace(/^\/aether@\w+/i, '/aether');
      }
      message.text = cleanText;

      console.log(`\n[Caspian Ingress] Received Command: "${message.text}" (Platform: ${message.channel || 'unknown'})`);

      const externalUserId = (message.sender?.id || message.sender?.address || "unknown").toString();
      const platform = message.channel; // 'discord', 'telegram', 'email', etc.
      const externalCommunityId = message.connectionId;

      if (!externalCommunityId) {
        console.error(`[Caspian Ingress] Message lacks connectionId. Cannot map to Aether Community.`);
        return;
      }

      // 2. Resolve Community
      const community = await prisma.community.upsert({
        where: {
          platform_externalId: {
            platform,
            externalId: externalCommunityId
          }
        },
        update: {},
        create: {
          name: `Caspian ${platform} Community`,
          platform,
          externalId: externalCommunityId,
          githubInstallationId: null // explicitly null until configured
        }
      });

      // 3. Resolve User Identity
      let identity = await prisma.userIdentity.findUnique({
        where: {
          platform_externalId: {
            platform,
            externalId: externalUserId
          }
        },
        include: { user: true }
      });

      if (!identity) {
        console.log(`[Caspian Ingress] New identity observed (${platform}/${externalUserId}). Provisioning Aether User...`);
        try {
          const user = await prisma.user.create({
            data: { email: null }
          });
          identity = await prisma.userIdentity.create({
            data: {
              userId: user.id,
              platform,
              externalId: externalUserId
            },
            include: { user: true }
          });
        } catch (e: any) {
          if (e.code === 'P2002') {
             // Handled concurrent creation
             identity = await prisma.userIdentity.findUniqueOrThrow({
                where: { platform_externalId: { platform, externalId: externalUserId } },
                include: { user: true }
             });
          } else {
             throw e;
          }
        }
      }

      const userId = identity.userId;

      // Handle Help Command
      if (message.text.trim() === '/aether' || message.text.trim() === '/aether help') {
        console.log(`[Caspian Ingress] Intercepted help command.`);
        const helpLines = [
          `🤖 **Aether: The Autonomous AI Verifier**`,
          ``,
          `**1. Commitments** (No risk)`,
          `\`/aether commit <what you will do>\``,
          `Create a personal commitment. Aether will verify it and reward you if fulfilled.`,
          `*Example: /aether commit I'll close fomo-ash/Forester#7 by tomorrow*`,
          ``,
          `**2. Bets** (High risk, high reward)`,
          `\`/aether bet <amount> REP on <multiplier>x <outcome>\``,
          `Stake your REP on a future event or current fact. Multipliers can be 2x, 3x, or 5x.`,
          `*Example: /aether bet 20 REP on 2x Bitcoin is currently trading above $50,000*`,
          `*(Note: Brand new users get 3 FREE "Bootstrap" bets! Just bet "0 REP")*`,
          ``,
          `**3. Stateless Checks** (Instant Fact-Checking)`,
          `\`/aether check <claim>\``,
          `Instantly verify a factual claim without creating any database records.`,
          `*Example: /aether check India won the 2011 Cricket World Cup*`,
          ``,
          `📊 **REPUTATION & LEADERBOARDS**`,
          `\`/aether rep\` — View your REP balance, tier, and Impact.`,
          `\`/aether leaderboard\` — Global REP leaderboard.`,
          `\`/aether impact\` — View community Impact score.`,
          `\`/aether impact leaderboard\` — Community Impact leaderboard.`,
          `\`/aether bets\` — View your active bets.`,
          ``,
          `🥊 **HEAD-TO-HEAD CHALLENGES**`,
          `\`/aether challenge @user <stake> REP on <claim> by <deadline>\``,
          `\`/aether challenge open <stake> REP on <claim> by <deadline>\``,
          `\`/aether accept <challengeId>\``,
          `\`/aether cancel <challengeId>\``,
          `\`/aether challenges\` — List open/active challenges.`,
          ``,
          `📊 **PREDICTION MARKETS (POOLS)**`,
          `\`/aether market create "<claim>" by <deadline>\``,
          `\`/aether bet <marketId> YES <amount>\``,
          `\`/aether bet <marketId> NO <amount>\``,
          `\`/aether markets\` — List open prediction pools.`,
          `\`/aether market <marketId>\` — View market odds/details.`,
          ``,
          `💡 **Important Guidelines:**`,
          `- Aether supports **GitHub** tracking (Issues, PRs, Deployments) and **Web Search** (for facts/news).`,
          `- If your bet is a factual check (like Bitcoin's price), you don't need a deadline.`,
          `- If your bet/commitment is in the future, you **MUST** specify a time (e.g. "by Friday", "tomorrow", "next week").`
        ];
        try {
          await client.sendMessage(message.conversationId, helpLines.join('\n'));
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error sending help menu: ${err.message}`);
        }
        return;
      }

      // Handle Check Command
      if (message.text.trim().startsWith('/aether check ')) {
        const claim = message.text.replace('/aether check ', '').trim();
        if (!claim) return;
        
        console.log(`[Caspian Ingress] Intercepted check command: "${claim}"`);
        
        // Send initial checking message
        try {
          await client.sendMessage(message.conversationId, `🔬 Gathering and analyzing evidence...`);
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error sending checking message: ${err.message}`);
        }
        
        const payload = {
          userId,
          communityId: community.id,
          conversationId: message.conversationId,
          claim
        };

        const response = await fetch(`${AETHER_API_URL}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          console.error(`[Caspian Ingress] Aether API check endpoint returned ${response.status}`);
        }
        return;
      }

      // Handle Reputation Command
      if (message.text.trim() === '/aether rep' || message.text.trim() === '/aether status') {
        console.log(`[Caspian Ingress] Intercepted reputation command.`);
        try {
          const response = await fetch(`${AETHER_API_URL}/api/reputation?userId=${userId}&communityId=${community.id}`);
          if (response.ok) {
            const summary = await response.json();
            
            const lines = [
              `👤 **AETHER PROFILE**`,
              ``,
              `**REP**`,
              `${summary.totalRep || summary.balance + summary.lockedBalance}`,
              ``,
              `**Available:** ${summary.balance} REP`,
              `**Locked:** ${summary.lockedBalance} REP`,
              `**Tier:** ${summary.tier}`,
              `**Global Rank:** ${summary.globalRank ? '#' + summary.globalRank : 'Unranked'}`
            ];

            if (summary.communityImpact > 0) {
              lines.push(``);
              lines.push(`**COMMUNITY IMPACT**`);
              lines.push(`${summary.communityImpact}`);
              lines.push(`**Rank:** ${summary.impactRank ? '#' + summary.impactRank : 'Unranked'}`);
            }

            if (summary.recentTransactions && summary.recentTransactions.length > 0) {
              lines.push(``);
              lines.push(`**Recent Changes:**`);
              summary.recentTransactions.forEach((tx: any) => {
                const sign = tx.amount >= 0 ? '+' : '';
                lines.push(`- \`${sign}${tx.amount}\` : ${tx.reason}`);
              });
            }

            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            console.error(`[Caspian Ingress] Failed to fetch reputation: ${response.status}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching reputation: ${err.message}`);
        }
        return;
      }

      // Handle Leaderboard Command
      if (message.text.trim() === '/aether leaderboard') {
        console.log(`[Caspian Ingress] Intercepted leaderboard command.`);
        try {
          const response = await fetch(`${AETHER_API_URL}/api/reputation/leaderboard`);
          if (response.ok) {
            const leaderboard = await response.json();
            
            const lines = [
              `🏆 **AETHER REP LEADERBOARD**`,
              ``
            ];

            leaderboard.forEach((entry: any) => {
              lines.push(`${entry.rank}. ${entry.displayName} — ${entry.totalRep} REP`);
            });

            // If we wanted to, we could fetch user rank here, but we will leave it for /rep for simplicity
            
            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            console.error(`[Caspian Ingress] Failed to fetch leaderboard: ${response.status}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching leaderboard: ${err.message}`);
        }
        return;
      }

      // Handle Impact Command
      if (message.text.trim() === '/aether impact') {
        console.log(`[Caspian Ingress] Intercepted impact command.`);
        try {
          const response = await fetch(`${AETHER_API_URL}/api/impact?userId=${userId}&communityId=${community.id}`);
          if (response.ok) {
            const summary = await response.json();
            
            const lines = [
              `🌟 **YOUR IMPACT**`,
              ``,
              `**Community:** ${community.name}`,
              ``,
              `**Impact:** ${summary.impactScore}`,
              `**Rank:** ${summary.rank ? '#' + summary.rank : 'Unranked'}`
            ];

            if (summary.recentContributions && summary.recentContributions.length > 0) {
              lines.push(``);
              lines.push(`**Recent Contributions:**`);
              summary.recentContributions.forEach((tx: any) => {
                const sign = tx.amount >= 0 ? '+' : '';
                lines.push(`- \`${sign}${tx.amount}\` : ${tx.reason}`);
              });
            }

            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            console.error(`[Caspian Ingress] Failed to fetch impact: ${response.status}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching impact: ${err.message}`);
        }
        return;
      }

      // Handle Impact Leaderboard Command
      if (message.text.trim() === '/aether impact leaderboard') {
        console.log(`[Caspian Ingress] Intercepted impact leaderboard command.`);
        try {
          const response = await fetch(`${AETHER_API_URL}/api/impact/leaderboard?communityId=${community.id}`);
          if (response.ok) {
            const leaderboard = await response.json();
            
            const lines = [
              `🌟 **COMMUNITY IMPACT**`,
              ``,
              `**${community.name}**`,
              ``
            ];

            leaderboard.forEach((entry: any) => {
              lines.push(`${entry.rank}. ${entry.displayName} — ${entry.impactScore}`);
            });
            
            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            console.error(`[Caspian Ingress] Failed to fetch impact leaderboard: ${response.status}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching impact leaderboard: ${err.message}`);
        }
        return;
      }

      // Handle Bets Listing Command
      if (message.text.trim() === '/aether bets') {
        console.log(`[Caspian Ingress] Intercepted bets listing command.`);
        try {
          const bets = await prisma.bet.findMany({
            where: {
              creatorId: userId,
              communityId: community.id,
              status: { in: ['ACTIVE', 'AWAITING_RESOLUTION', 'EVIDENCE_COLLECTION'] }
            },
            include: {
              commitment: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          });

          if (bets.length === 0) {
            await client.sendMessage(message.conversationId, `🎲 **ACTIVE BETS**\n\nYou currently have no active bets in this community.\nUse \`/aether bet <amount> REP on <multiplier>x <outcome>\` to place a bet!`);
            return;
          }

          const lines = [
            `🎲 **ACTIVE BETS (${bets.length})**`,
            ``
          ];

          bets.forEach((bet, idx) => {
            const claim = bet.commitment?.normalizedClaim || bet.commitment?.statement || 'Unknown bet';
            const multiplierStr = bet.multiplier ? `${bet.multiplier}x` : 'Bootstrap';
            const deadlineStr = bet.deadline ? new Date(bet.deadline).toUTCString() : 'N/A';
            lines.push(`**${idx + 1}. ${claim}**`);
            lines.push(`- Stake: ${bet.stake} REP | Multiplier: ${multiplierStr} | Payout: ${bet.potentialPayout} REP`);
            lines.push(`- Status: \`${bet.status}\` | Deadline: ${deadlineStr}`);
            lines.push(``);
          });

          await client.sendMessage(message.conversationId, lines.join('\n'));
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching bets: ${err.message}`);
        }
        return;
      }

      // Handle Challenges Listing Command
      if (message.text.trim() === '/aether challenges') {
        console.log(`[Caspian Ingress] Intercepted challenges listing command.`);
        try {
          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/challenges?communityId=${community.id}`);
          if (res.ok) {
            const challenges = await res.json();
            if (challenges.length === 0) {
              await client.sendMessage(message.conversationId, `🥊 **HEAD-TO-HEAD CHALLENGES**\n\nNo active or open challenges in this community.\nCreate one with:\n\`/aether challenge open <stake> REP on <claim> by <deadline>\``);
              return;
            }

            const lines = [
              `🥊 **COMMUNITY CHALLENGES (${challenges.length})**`,
              ``
            ];

            challenges.forEach((c: any, idx: number) => {
              const opponentStr = c.targetUserId ? `Targeted` : `Open to Anyone`;
              const deadlineStr = new Date(c.deadline).toUTCString();
              lines.push(`**${idx + 1}. ID:** \`${c.id.slice(0, 8)}\` — ${c.claim}`);
              lines.push(`- Stake: ${c.targetStake} REP each (Pot: ${c.totalPot} REP) | Status: \`${c.status}\``);
              lines.push(`- Opponent: ${opponentStr} | Deadline: ${deadlineStr}`);
              if (c.status === 'OFFERED' && c.creatorId !== userId) {
                lines.push(`- *To accept: /aether accept ${c.id.slice(0, 8)}*`);
              }
              lines.push(``);
            });

            await client.sendMessage(message.conversationId, lines.join('\n'));
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching challenges: ${err.message}`);
        }
        return;
      }

      // Handle Challenge Creation (/aether challenge ...)
      if (message.text.trim().startsWith('/aether challenge')) {
        const rest = message.text.replace(/^\/aether\s+challenge\s*/i, '').trim();
        console.log(`[Caspian Ingress] Intercepted challenge creation: "${rest}"`);
        
        let targetStr = 'open';
        let stakeStr = '0';
        let claimStr = '';
        let deadlineStr = 'tomorrow';

        // Format A: /aether challenge @user [for] 20 REP on <claim> [by <deadline>]
        // Format B: /aether challenge open [for] 20 REP on <claim> [by <deadline>]
        const matchWithTarget = rest.match(/^(open|@?\S+|<@!?\d+>)\s+(?:for\s+)?(\d+)\s+REP\s+on\s+(.+?)(?:\s+by\s+(.+))?$/i);
        
        // Format C: /aether challenge [for] 20 REP on <claim> [by <deadline>] (implied open)
        const matchNoTarget = rest.match(/^(?:for\s+)?(\d+)\s+REP\s+on\s+(.+?)(?:\s+by\s+(.+))?$/i);

        if (matchWithTarget) {
          targetStr = matchWithTarget[1];
          stakeStr = matchWithTarget[2];
          claimStr = matchWithTarget[3];
          deadlineStr = matchWithTarget[4] || 'tomorrow';
        } else if (matchNoTarget) {
          targetStr = 'open';
          stakeStr = matchNoTarget[1];
          claimStr = matchNoTarget[2];
          deadlineStr = matchNoTarget[3] || 'tomorrow';
        } else {
          await client.sendMessage(
            message.conversationId,
            `⚠️ **Invalid Challenge Format**\n\nUse:\n\`/aether challenge open <stake> REP on <claim> [by <deadline>]\`\nOR\n\`/aether challenge @user <stake> REP on <claim> [by <deadline>]\`\n\n*Example: /aether challenge @user 20 REP on Bitcoin price was above $20k in 2018*`
          );
          return;
        }

        const stake = parseInt(stakeStr, 10);
        let targetUserId: string | null = null;

        if (targetStr.toLowerCase() !== 'open') {
          const cleanTarget = targetStr.replace(/^[<@!]+|[>]+$/g, '');
          
          const targetIdentity = await prisma.userIdentity.findFirst({
            where: {
              OR: [
                { externalId: cleanTarget },
                { externalId: targetStr }
              ]
            }
          });

          if (targetIdentity) {
            targetUserId = targetIdentity.userId;
          } else {
            const member = await prisma.communityMember.findFirst({
              where: {
                communityId: community.id,
                displayName: { contains: cleanTarget, mode: 'insensitive' }
              }
            });
            if (member) targetUserId = member.userId;
          }
        }

        try {
          const calculatedDeadline = parseNaturalDeadline(deadlineStr);
          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/challenge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              communityId: community.id,
              creatorId: userId,
              targetUserId,
              claim: claimStr.replace(/^["']|["']$/g, ''),
              normalizedClaim: claimStr.replace(/^["']|["']$/g, ''),
              deadline: calculatedDeadline.toISOString(),
              stake
            })
          });

          if (res.ok) {
            const bet = await res.json();
            await redis.set(`mp_conv:${bet.id}`, message.conversationId, 'EX', 7 * 24 * 3600);
            const opponentDisplay = targetStr.toLowerCase() === 'open' ? 'Open to Anyone' : targetStr;
            const lines = [
              `🥊 **HEAD-TO-HEAD CHALLENGE CREATED**`,
              ``,
              `**ID:** \`${bet.id}\``,
              `**Claim:** "${bet.claim}"`,
              `**Stake:** ${bet.targetStake} REP each (Total Pot: ${bet.targetStake * 2} REP in Escrow)`,
              `**Opponent:** ${opponentDisplay}`,
              `**Status:** \`OFFERED\``,
              ``,
              `*Opponent can accept using:*`,
              `\`/aether accept ${bet.id}\``
            ];
            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            const err = await res.json();
            await client.sendMessage(message.conversationId, `❌ **Challenge Creation Failed**: ${err.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error creating challenge: ${err.message}`);
        }
        return;
      }

      // Handle Challenge Acceptance (/aether accept <id>)
      if (message.text.trim().startsWith('/aether accept ')) {
        const idArg = message.text.replace('/aether accept ', '').trim();
        console.log(`[Caspian Ingress] Intercepted challenge acceptance: "${idArg}"`);
        
        try {
          // Resolve full ID if prefix provided
          let betId = idArg;
          if (idArg.length < 30) {
            const match = await prisma.multiplayerBet.findFirst({
              where: { id: { startsWith: idArg }, communityId: community.id }
            });
            if (match) betId = match.id;
          }

          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/challenge/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              multiplayerBetId: betId,
              userId,
              communityId: community.id,
              conversationId: message.conversationId
            })
          });

          if (res.ok) {
            const bet = await res.json();
            const lines = [
              `🥊 **CHALLENGE ACCEPTED & ACTIVE!**`,
              ``,
              `**ID:** \`${bet.id}\``,
              `**Claim:** "${bet.claim}"`,
              `**Total Pot:** ${bet.totalPot} REP in Escrow`,
              `**Status:** \`ACTIVE\``,
              ``,
              `🔎 *Aether is autonomously verifying the claim right now... Stand by for the verdict!*`
            ];
            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            const err = await res.json();
            await client.sendMessage(message.conversationId, `❌ **Acceptance Failed**: ${err.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error accepting challenge: ${err.message}`);
        }
        return;
      }

      // Handle Challenge Cancellation (/aether cancel <id>)
      if (message.text.trim().startsWith('/aether cancel ')) {
        const idArg = message.text.replace('/aether cancel ', '').trim();
        console.log(`[Caspian Ingress] Intercepted challenge cancellation: "${idArg}"`);
        
        try {
          let betId = idArg;
          if (idArg.length < 30) {
            const match = await prisma.multiplayerBet.findFirst({
              where: { id: { startsWith: idArg }, communityId: community.id }
            });
            if (match) betId = match.id;
          }

          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/challenge/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              multiplayerBetId: betId,
              userId,
              communityId: community.id
            })
          });

          if (res.ok) {
            await client.sendMessage(message.conversationId, `🚫 **Challenge Cancelled**: Your stake has been fully refunded.`);
          } else {
            const err = await res.json();
            await client.sendMessage(message.conversationId, `❌ **Cancellation Failed**: ${err.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error cancelling challenge: ${err.message}`);
        }
        return;
      }

      // Handle Prediction Markets Listing (/aether markets)
      if (message.text.trim() === '/aether markets') {
        console.log(`[Caspian Ingress] Intercepted prediction markets listing.`);
        try {
          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/markets?communityId=${community.id}`);
          if (res.ok) {
            const markets = await res.json();
            if (markets.length === 0) {
              await client.sendMessage(message.conversationId, `📊 **PREDICTION MARKETS**\n\nNo active prediction markets in this community.\nCreate one with:\n\`/aether market create "<claim>" by <deadline>\``);
              return;
            }

            const lines = [
              `📊 **PREDICTION MARKETS (${markets.length})**`,
              ``
            ];

            markets.forEach((m: any, idx: number) => {
              const deadlineStr = new Date(m.deadline).toUTCString();
              lines.push(`**${idx + 1}. ID:** \`${m.id.slice(0, 8)}\` — "${m.claim}"`);
              lines.push(`- YES Pool: ${m.yesPool} REP | NO Pool: ${m.noPool} REP | Total Pot: ${m.totalPot} REP`);
              lines.push(`- Participants: ${m.participants?.length || 0} | Closes: ${deadlineStr}`);
              lines.push(`- *Bet with: /aether bet ${m.id.slice(0, 8)} YES <amount>*`);
              lines.push(``);
            });

            await client.sendMessage(message.conversationId, lines.join('\n'));
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error fetching markets: ${err.message}`);
        }
        return;
      }

      // Handle Prediction Market Creation (/aether market create ...)
      if (message.text.trim().startsWith('/aether market create ')) {
        const rest = message.text.replace('/aether market create ', '').trim();
        console.log(`[Caspian Ingress] Intercepted market creation: "${rest}"`);
        
        const match = rest.match(/^["']?(.+?)["']?\s+by\s+(.+)$/i);
        if (!match) {
          await client.sendMessage(
            message.conversationId,
            `⚠️ **Invalid Market Format**\n\nUse:\n\`/aether market create "<claim>" by <deadline>\`\n\n*Example: /aether market create "Will Bitcoin be above $100k?" by August 31*`
          );
          return;
        }

        const [, claimStr, deadlineStr] = match;
        const calculatedDeadline = parseNaturalDeadline(deadlineStr);

        try {
          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/market`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              communityId: community.id,
              creatorId: userId,
              claim: claimStr.replace(/^["']|["']$/g, ''),
              normalizedClaim: claimStr.replace(/^["']|["']$/g, ''),
              deadline: calculatedDeadline.toISOString()
            })
          });

          if (res.ok) {
            const market = await res.json();
            await redis.set(`mp_conv:${market.id}`, message.conversationId, 'EX', 7 * 24 * 3600);
            const lines = [
              `📊 **PREDICTION MARKET OPENED!**`,
              ``,
              `**ID:** \`${market.id}\``,
              `**Claim:** "${market.claim}"`,
              `**Status:** \`OPEN\``,
              `**Deadline:** ${new Date(market.deadline).toUTCString()}`,
              ``,
              `*Join this market using:*`,
              `\`/aether bet ${market.id.slice(0, 8)} YES <amount>\``,
              `\`/aether bet ${market.id.slice(0, 8)} NO <amount>\``
            ];
            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            const err = await res.json();
            await client.sendMessage(message.conversationId, `❌ **Market Creation Failed**: ${err.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error creating market: ${err.message}`);
        }
        return;
      }

      // Handle Prediction Market Bet Placement (/aether bet <marketId> YES/NO <stake>)
      const marketBetMatch = message.text.trim().match(/^\/aether\s+bet\s+(\S+)\s+(YES|NO)(?:\s+(.*))?$/i);
      if (marketBetMatch) {
        const [, idArg, sideRaw, stakeArg] = marketBetMatch;
        const side = sideRaw.toUpperCase() as 'YES' | 'NO';
        const cleanStake = (stakeArg || '').replace(/[^\d]/g, '');
        const stake = cleanStake ? parseInt(cleanStake, 10) : 0;

        if (!stake || stake <= 0) {
          await client.sendMessage(
            message.conversationId,
            `⚠️ **Invalid Amount**\n\nPlease specify how much REP you want to bet.\n*Example: /aether bet ${idArg} ${side} 20*`
          );
          return;
        }

        console.log(`[Caspian Ingress] Intercepted market bet: ID ${idArg}, Side ${side}, Stake ${stake}`);

        try {
          let betId = idArg;
          if (idArg.length < 30) {
            const match = await prisma.multiplayerBet.findFirst({
              where: { id: { startsWith: idArg }, communityId: community.id, betType: 'PREDICTION_POOL' }
            });
            if (match) betId = match.id;
          }

          const res = await fetch(`${AETHER_API_URL}/api/multiplayer/market/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              multiplayerBetId: betId,
              userId,
              communityId: community.id,
              side,
              stake
            })
          });

          if (res.ok) {
            const market = await prisma.multiplayerBet.findUnique({ where: { id: betId } });
            const lines = [
              `✅ **POSITION PLACED!**`,
              ``,
              `**Market:** "${market?.claim}"`,
              `**Side:** \`${side}\``,
              `**Your Stake:** ${stake} REP (Locked in Escrow)`,
              `**Current Pools:** YES: ${market?.yesPool} REP | NO: ${market?.noPool} REP (Total Pot: ${market?.totalPot} REP)`
            ];
            await client.sendMessage(message.conversationId, lines.join('\n'));
          } else {
            const err = await res.json();
            await client.sendMessage(message.conversationId, `❌ **Bet Placement Failed**: ${err.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error placing market bet: ${err.message}`);
        }
        return;
      }

      // Handle Single Market View (/aether market <id>)
      if (message.text.trim().startsWith('/aether market ') && !message.text.trim().startsWith('/aether market create')) {
        const idArg = message.text.replace('/aether market ', '').trim();
        console.log(`[Caspian Ingress] Intercepted market view: "${idArg}"`);

        try {
          let betId = idArg;
          if (idArg.length < 30) {
            const match = await prisma.multiplayerBet.findFirst({
              where: { id: { startsWith: idArg }, communityId: community.id, betType: 'PREDICTION_POOL' }
            });
            if (match) betId = match.id;
          }

          const market = await prisma.multiplayerBet.findUnique({
            where: { id: betId },
            include: { participants: true }
          });

          if (!market) {
            await client.sendMessage(message.conversationId, `❌ Market \`${idArg}\` not found.`);
            return;
          }

          const userPos = market.participants.find(p => p.userId === userId);
          const userPosStr = userPos ? `${userPos.side} — ${userPos.stake} REP` : 'None';

          const lines = [
            `📊 **PREDICTION MARKET DETAILS**`,
            ``,
            `**Claim:** "${market.claim}"`,
            `**Status:** \`${market.status}\``,
            `**YES Pool:** ${market.yesPool} REP`,
            `**NO Pool:** ${market.noPool} REP`,
            `**Total Pot:** ${market.totalPot} REP`,
            `**Participants:** ${market.participants.length}`,
            `**Closes:** ${new Date(market.deadline).toUTCString()}`,
            `**Your Position:** ${userPosStr}`
          ];
          await client.sendMessage(message.conversationId, lines.join('\n'));
        } catch (err: any) {
          console.error(`[Caspian Ingress] Error viewing market: ${err.message}`);
        }
        return;
      }

      // Message Filtering
      const isCommand = message.text.startsWith('/aether commit') || message.text.startsWith('/aether bet ');
      const pendingKey = `clarify:${community.id}:${userId}:${message.conversationId}`;

      // Clear pending clarify key if user explicitly issues a new /aether command
      if (message.text.startsWith('/aether')) {
        await redis.del(pendingKey);
      }

      const hasPending = await redis.exists(pendingKey);
      
      if (!isCommand && !hasPending) {
         console.log(`[Caspian Ingress] Message ignored (Not a command and no pending interaction).`);
         return;
      }

      // 4. Normalize and send to Aether API
      const payload = {
        platform,
        messageId: message.id,
        userId: userId,
        communityId: community.id,
        channel: platform,
        conversationId: message.conversationId,
        message: message.text,
        telemetry: {
          receivedAt
        }
      };

      console.log(`[Caspian Ingress] Forwarding normalized event to Aether API...`);

      const response = await fetch(`${AETHER_API_URL}/api/messages/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Caspian Ingress] Aether API returned ${response.status}: ${errorText}`);
        return;
      }

      console.log(`[Caspian Ingress] Successfully handed off to Aether message-queue.`);

    } catch (error: any) {
      console.error(`[Caspian Ingress] Error processing message: ${error.message}`);
    }
  });

  console.log(`[Caspian Ingress] Listening for events...`);
  await client.listen();

  // Graceful shutdown
  ['SIGINT', 'SIGTERM'].forEach(sig => {
    process.on(sig, async () => {
      console.log(`[Caspian Ingress] ${sig} received. Shutting down gracefully...`);
      // CommClient has no exposed disconnect, shutting down directly
      console.log('[Caspian Ingress] Graceful shutdown complete.');
      process.exit(0);
    });
  });
}

bootstrap().catch(console.error);
