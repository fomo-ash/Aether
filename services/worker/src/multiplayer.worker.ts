import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient, MultiplayerBetStatus } from '@flowpilot/database';
import { VerificationRegistry } from '@aether/verification-registry';
import { EvidenceEvaluator } from './resolvers/evidence.evaluator';
import { MultiplayerSettlementService } from './services/multiplayer-settlement.service';
import { OutboundResponder } from './services/outbound-responder';

const prisma = new PrismaClient();

if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for production.');
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

export const multiplayerWorker = new Worker('multiplayer-queue', async (job: Job) => {
  const { multiplayerBetId, conversationId } = job.data;
  console.log(`[MultiplayerWorker] Processing auto-verification for bet: ${multiplayerBetId}`);

  try {
    const bet = await prisma.multiplayerBet.findUnique({
      where: { id: multiplayerBetId },
      include: {
        participants: { include: { user: true } },
        creator: true,
        targetUser: true,
        community: true
      }
    });

    if (!bet) {
      console.warn(`[MultiplayerWorker] Bet ${multiplayerBetId} not found.`);
      return;
    }

    if (bet.status !== MultiplayerBetStatus.ACTIVE && bet.status !== MultiplayerBetStatus.OPEN) {
      console.log(`[MultiplayerWorker] Bet ${multiplayerBetId} is not ACTIVE or OPEN (status: ${bet.status}). Skipping auto-verification.`);
      return;
    }

    // 1. Gather web search evidence
    console.log(`[MultiplayerWorker] Gathering autonomous web evidence for: "${bet.claim}"`);
    const provider = VerificationRegistry.getProvider('web.search');
    const evidence = await provider.verify(
      'web.search',
      { field: 'state', operator: 'exists', expected: true },
      { userId: bet.creatorId, communityId: bet.communityId, target: bet.claim, config: {} }
    );

    // 2. Evaluate evidence with LLM
    const outcome = await EvidenceEvaluator.evaluateWebSearch(bet.claim, [evidence], { minIndependentSources: 1 });
    console.log(`[MultiplayerWorker] Verification outcome for "${bet.claim}": ${outcome}`);

    let resolutionStatus: 'FULFILLED' | 'MISSED' | 'UNRESOLVED' = 'UNRESOLVED';
    if (outcome === 'VERIFIED') {
      resolutionStatus = 'FULFILLED'; // YES / Creator wins
    } else if (outcome === 'NOT_VERIFIED') {
      resolutionStatus = 'MISSED';    // NO / Opponent wins
    }

    // 3. Settle pot
    const settlement = await MultiplayerSettlementService.settle(bet.id, resolutionStatus);

    // 4. Send rich announcement to Discord / Telegram
    const targetConversationId = conversationId || await connection.get(`mp_conv:${bet.id}`);
    if (targetConversationId && bet.communityId) {
      let lines: string[] = [];

      if (bet.betType === 'PREDICTION_POOL') {
        const winningSideStr = outcome === 'VERIFIED' ? 'YES' : (outcome === 'NOT_VERIFIED' ? 'NO' : 'NONE');
        lines = [
          `📊 **PREDICTION MARKET RESOLVED!**`,
          ``,
          `**Claim:** "${bet.claim}"`,
          `**Verdict:** ${outcome === 'VERIFIED' ? '✅ TRUE (YES Wins!)' : (outcome === 'NOT_VERIFIED' ? '❌ FALSE (NO Wins!)' : '⚠️ UNRESOLVED (Stakes Refunded)')}`,
          `**Winning Side:** \`${winningSideStr}\``,
          `**Total Pot:** ${bet.totalPot} REP in Escrow`,
          `**Settlement:** ${settlement.status === 'RESOLVED' ? '✅ Proportional payouts distributed to winning positions!' : 'Refunded 1:1'}`,
          ``
        ];
      } else {
        const creatorName = bet.creator.email || 'Creator';
        const opponentName = bet.targetUser?.email || 'Opponent';
        const winnerName = resolutionStatus === 'FULFILLED' ? creatorName : opponentName;
        
        lines = [
          `🏆 **CHALLENGE RESOLVED!**`,
          ``,
          `**Claim:** "${bet.claim}"`,
          `**Verdict:** ${outcome === 'VERIFIED' ? '✅ TRUE (Creator Wins!)' : (outcome === 'NOT_VERIFIED' ? '❌ FALSE (Opponent Wins!)' : '⚠️ UNRESOLVED (Stakes Refunded)')}`,
          `**Winner:** ${resolutionStatus === 'UNRESOLVED' ? 'None (Refunded)' : winnerName}`,
          `**Pot Awarded:** ${settlement.status === 'RESOLVED' ? `${bet.totalPot} REP` : 'Refunded 1:1'}`,
          ``
        ];
      }

      if (evidence.payload?.results && evidence.payload.results.length > 0) {
        lines.push(`**Authoritative Sources:**`);
        const seenDomains = new Set<string>();
        for (const res of evidence.payload.results.slice(0, 3)) {
          try {
            const urlObj = new URL(res.sourceUrl || res.url);
            if (!seenDomains.has(urlObj.hostname)) {
              seenDomains.add(urlObj.hostname);
              lines.push(`• [${urlObj.hostname}](${res.sourceUrl || res.url}) — ${res.title}`);
            }
          } catch (e) {
            lines.push(`• ${res.sourceUrl || res.url}`);
          }
        }
      }

      await OutboundResponder.sendMessage(
        bet.communityId,
        bet.creatorId,
        targetConversationId,
        lines.join('\n')
      );
    }
  } catch (err: any) {
    console.error(`[MultiplayerWorker] Error resolving bet ${multiplayerBetId}:`, err);
  }
}, { connection });

multiplayerWorker.on('completed', job => {
  console.log(`[MultiplayerWorker] Job ${job.id} completed.`);
});
multiplayerWorker.on('failed', (job, err) => {
  console.error(`[MultiplayerWorker] Job ${job?.id} failed:`, err);
});
