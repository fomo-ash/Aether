import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

const connection = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
});

export const verificationQueue = new Queue('verification-queue', { connection });

/**
 * Schedules a verification job to run at a specific deadline.
 * @param commitmentId The ID of the commitment to verify.
 * @param deadline The exact Date/time to run the verification.
 */
export async function scheduleVerification(commitmentId: string, deadline: Date) {
  const now = Date.now();
  const delay = Math.max(0, deadline.getTime() - now);

  await verificationQueue.add(
    'verify',
    { commitmentId },
    { delay, jobId: `verify-${commitmentId}` } // jobId prevents duplicate scheduling
  );

  console.log(`Scheduled verification for commitment ${commitmentId} in ${delay}ms`);
}
