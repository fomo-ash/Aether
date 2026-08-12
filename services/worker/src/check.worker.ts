import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { VerificationRegistry } from '@aether/verification-registry';
import { EvidenceEvaluator } from './resolvers/evidence.evaluator';
import { OutboundResponder } from './services/outbound-responder';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const checkWorker = new Worker('check-queue', async (job: Job) => {
  const { userId, communityId, conversationId, claim } = job.data;
  
  console.log(`[CheckWorker] Processing check job ${job.id} for claim: "${claim}"`);
  
  try {
    const provider = VerificationRegistry.getProvider('web.search');
    
    // 1. Collect evidence statelessly
    const evidence = await provider.verify(
      'web.search',
      { field: 'state', operator: 'exists', expected: true }, // Not strictly used for WebSearch
      { userId, communityId, target: claim, config: {} }
    );
    
    // 2. Evaluate evidence
    const outcome = await EvidenceEvaluator.evaluateWebSearch(claim, [evidence], { minIndependentSources: 2 });
    
    // 3. Format response
    let icon = '⚠️';
    let label = 'Insufficient evidence';
    if (outcome === 'VERIFIED') {
      icon = '✅';
      label = 'Verified';
    } else if (outcome === 'NOT_VERIFIED') {
      icon = '❌';
      label = 'Not Verified';
    }

    const lines = [
      `🔎 **Verification**`,
      ``,
      `**Claim:** ${claim}`,
      ``,
      `${icon} **${label}**`,
      ``
    ];
    
    // Append sources if available
    if (evidence.payload && evidence.payload.results && evidence.payload.results.length > 0) {
      lines.push(`**Sources**`);
      
      const seenDomains = new Set<string>();
      
      for (const result of evidence.payload.results) {
        try {
          const urlObj = new URL(result.sourceUrl || result.url);
          if (!seenDomains.has(urlObj.hostname)) {
             seenDomains.add(urlObj.hostname);
             lines.push(`• [${urlObj.hostname}](${result.sourceUrl || result.url})`);
          }
        } catch (e) {
          lines.push(`• ${result.sourceUrl || result.url}`);
        }
      }
    } else {
      lines.push(`No authoritative sources found.`);
    }
    
    const responseText = lines.join('\n');
    
    // 4. Send response
    await OutboundResponder.sendMessage(communityId, userId, conversationId, responseText);
    
  } catch (error: any) {
    console.error(`[CheckWorker] Job ${job.id} failed:`, error);
    await OutboundResponder.sendMessage(
      communityId,
      userId,
      conversationId,
      `⚠️ An error occurred while checking this claim: ${error.message}`
    );
    throw error;
  }
}, { connection });

checkWorker.on('completed', job => {
  console.log(`[CheckWorker] Job ${job.id} completed successfully`);
});

checkWorker.on('failed', (job, err) => {
  console.error(`[CheckWorker] Job ${job?.id} failed: ${err.message}`);
});
