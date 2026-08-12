import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { processVerificationJob, processWebhookJob } from './processor';
import { processMessageJob } from './message.worker';

// Ensure required env vars
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required');
}

const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

// Import check worker to start it (side-effect)
import './check.worker';

// 1. Verification Worker
const verificationWorker = new Worker('verification-queue', processVerificationJob, {
  connection,
  concurrency: 5
});

verificationWorker.on('completed', (job) => console.log(`[Verification] Job ${job.id} completed successfully`));
verificationWorker.on('failed', (job, err) => console.error(`[Verification] Job ${job?.id} failed: ${err.message}`));

// 2. Message Extraction Worker
const messageWorker = new Worker('message-queue', processMessageJob, {
  connection,
  concurrency: 10 // Can handle more concurrency as it's just I/O bound LLM calls
});

messageWorker.on('completed', (job) => console.log(`[Message Queue] Job ${job.id} completed successfully`));
messageWorker.on('failed', (job, err) => console.error(`[Message Queue] Job ${job?.id} failed: ${err.message}`));

// 3. Webhook Event Worker
const webhookWorker = new Worker('webhook-queue', processWebhookJob, {
  connection,
  concurrency: 10 // Fast processing
});

webhookWorker.on('completed', (job) => console.log(`[Webhook Queue] Job ${job.id} completed successfully`));
webhookWorker.on('failed', (job, err) => console.error(`[Webhook Queue] Job ${job?.id} failed: ${err.message}`));

// 4. Reconciler Worker
import { Queue } from 'bullmq';
import { PrismaClient } from '@flowpilot/database';
const prisma = new PrismaClient();

const verificationQueue = new Queue('verification-queue', { connection });
const reconcilerQueue = new Queue('reconciler-queue', { connection });

const reconcilerWorker = new Worker('reconciler-queue', async () => {
  console.log('[Reconciler] Sweeping for overdue AWAITING_VERIFICATION commitments...');
  
  // Find commitments that are past their deadline but still awaiting verification
  const overdue = await prisma.commitment.findMany({
    where: {
      status: 'AWAITING_VERIFICATION',
      deadline: {
        lte: new Date() // Past the deadline
      }
    },
    take: 100 // Batch limit to prevent memory spikes
  });

  if (overdue.length > 0) {
    console.log(`[Reconciler] Found ${overdue.length} overdue commitments. Re-enqueueing...`);
    for (const commitment of overdue) {
      await verificationQueue.add(
        'verify',
        { commitmentId: commitment.id },
        { jobId: `verify-${commitment.id}-reconcile` } // Distinct jobId or we can use the same to dedupe
      );
    }
  }
}, { connection });

// Schedule the repeatable job
reconcilerQueue.add('sweep', {}, {
  repeat: {
    pattern: '*/5 * * * *' // Every 5 minutes
  },
  jobId: 'reconciler-sweep-job'
});

console.log('⚡ Aether Workers Started ⚡');
console.log('- Verification Queue: Listening');
console.log('- Message Queue: Listening');
console.log('- Webhook Queue: Listening');
console.log('- Check Queue: Listening');
console.log('- Reconciler Queue: Scheduled (*/5 * * * *)');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down workers...');
  await Promise.all([
    verificationWorker.close(),
    messageWorker.close(),
    webhookWorker.close(),
    reconcilerWorker.close()
  ]);
  process.exit(0);
});
