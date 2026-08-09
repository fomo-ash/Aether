import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { processVerificationJob } from './processor';

// Ensure required env vars
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required');
}

const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker('verification-queue', processVerificationJob, {
  connection,
  concurrency: 5
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed with error: ${err.message}`);
});

console.log('Verification worker started');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});
