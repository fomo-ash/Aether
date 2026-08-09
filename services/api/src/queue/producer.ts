import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new Redis(redisUrl, {
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

export const messageQueue = new Queue('message-queue', { connection });

export interface MessagePayload {
  messageId: string;
  userId: string;
  communityId: string;
  channel: string;
  conversationId: string;
  message: string;
}

/**
 * Enqueues an incoming chat message for asynchronous LLM extraction.
 */
export async function enqueueMessage(payload: MessagePayload) {
  // Namespaced Job ID to prevent duplicate processing on webhook retries
  const jobId = `message_${payload.channel}_${payload.communityId}_${payload.messageId}`;
  
  await messageQueue.add('extract-message', payload, {
    jobId,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000 // 2s, 4s, 8s
    }
  });

  console.log(`Enqueued message ${jobId} for extraction`);
}
