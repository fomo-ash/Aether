import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { processVerificationJob } from './processor';
import { processMessageJob } from './message.worker';

// Ensure required env vars
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required');
}

const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

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

console.log('⚡ Aether Workers Started ⚡');
console.log('- Verification Queue: Listening');
console.log('- Message Queue: Listening');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down workers...');
  await Promise.all([
    verificationWorker.close(),
    messageWorker.close()
  ]);
  process.exit(0);
});
