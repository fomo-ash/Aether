import { PrismaClient } from '@flowpilot/database';
import { Queue } from 'bullmq';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const prisma = new PrismaClient();

async function runTest() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');

  console.log('--- AETHER VERIFICATION TEST ---');
  
  // 1. Create a mock user
  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@aether.local`
    }
  });
  console.log(`Created User: ${user.id}`);

  // 2. Create a mock community
  const community = await prisma.community.create({
    data: {
      name: 'Aether Test Server',
      platform: 'discord',
      externalId: `discord-${Date.now()}`
    }
  });
  console.log(`Created Community: ${community.id}`);

  // 3. Create a commitment
  // For this test, you'll need to specify a real issue to test against.
  // We'll hardcode one from a popular repo for testing if we just want to see it run,
  // or use a local one. Let's use an old closed issue: owner/repo#1
  
  // Replace with a repository/issue you have access to, or a public one.
  const target = 'octocat/Hello-World#1';
  
  const commitment = await prisma.commitment.create({
    data: {
      userId: user.id,
      communityId: community.id,
      statement: `I'll close issue ${target}`,
      normalizedClaim: `Close ${target}`,
      status: 'AWAITING_VERIFICATION', // Ready to be picked up
      sourceChannel: 'discord',
      sourceConversationId: 'test-convo',
      sourceMessageId: 'test-msg',
      rewardPenaltyPolicy: { reward: 10, penalty: -5 },
      verificationPolicy: {
        create: {
          verifierType: 'github.issue_status',
          target: target,
          successCondition: { operator: 'equals', expected: 'closed' }
        }
      }
    }
  });
  console.log(`Created Commitment: ${commitment.id}`);

  // 4. Enqueue Job
  const queue = new Queue('verification-queue', { connection: { url: process.env.REDIS_URL } });
  
  const job = await queue.add('verify', { commitmentId: commitment.id });
  console.log(`Enqueued Verification Job: ${job.id}`);
  
  console.log('\\nStart the worker by running: pnpm dev in the services/worker directory');
  console.log('You should see it process the job, query GitHub, and apply a +10 reputation transaction.\\n');

  await queue.close();
  await prisma.$disconnect();
}

runTest().catch(console.error);
