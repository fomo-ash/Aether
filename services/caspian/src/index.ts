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

  client.onMessage(async (message: any) => {
    try {
      const receivedAt = Date.now();
      if (!message.text) {
        return;
      }

      console.log(`\n[Caspian Ingress] Received Command: "${message.text}"`);

      const externalUserId = (message.sender?.id || message.sender?.address || "unknown").toString();
      const platform = message.channel; // 'discord', 'email', etc.
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
      if (message.text.trim() === '/aether') {
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
          `**4. Reputation & Account**`,
          `\`/aether rep\` (or \`/aether status\`)`,
          `View your current REP balance, tier, and recent transaction history.`,
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
              `📊 **Reputation Summary**`,
              `**Tier:** ${summary.tier}`,
              `**Balance:** ${summary.balance} REP`
            ];

            if (summary.progressToNextTier !== null) {
              lines.push(`**Progress to ${summary.nextTierName}:** ${summary.progressToNextTier}%`);
            }
            
            lines.push(`**Record:** ${summary.fulfilledCommitments} Fulfilled / ${summary.missedCommitments} Missed`);
            
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

      // Message Filtering
      const isCommand = message.text.startsWith('/aether commit') || message.text.startsWith('/aether bet');
      const pendingKey = `clarify:${community.id}:${userId}:${message.conversationId}`;
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
