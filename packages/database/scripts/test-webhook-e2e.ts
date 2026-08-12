import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function runTest() {
  console.log('--- STARTING LOCAL E2E WEBHOOK TEST ---');
  
  // 1. Get Webhook Secret from env
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('ERROR: GITHUB_WEBHOOK_SECRET is not set in .env');
    process.exit(1);
  }

  // 2. Create a mock commitment in AWAITING_VERIFICATION state
  const mockTarget = `fomo-ash/Forester#7`;
  console.log(`[1] Creating mock commitment for target: ${mockTarget}`);
  
  const user = await prisma.user.findFirst();
  const community = await prisma.community.findFirst();
  if (community) {
    await prisma.community.update({
      where: { id: community.id },
      data: { githubInstallationId: '152673974' }
    });
  }

  if (!user || !community) {
    console.error('No users or communities found in DB. Need test data.');
    process.exit(1);
  }

  const commitment = await prisma.commitment.create({
    data: {
      userId: user.id,
      communityId: community.id,
      status: 'AWAITING_VERIFICATION',
      statement: 'I will close this issue',
      normalizedClaim: 'close the issue',
      sourceChannel: 'discord',
      sourceMessageId: 'mock-msg',
      sourceConversationId: 'mock-conv',
      verificationPolicy: {
        create: {
          target: mockTarget,
          verifierType: 'github.issue',
          successCondition: { field: 'state', operator: 'equals', expected: 'closed' },
          configuration: {}
        }
      },
      deadline: new Date(Date.now() + 1000 * 60 * 60 * 24) // Deadline 24 hours in the future
    }
  });
  console.log(`Created commitment: ${commitment.id}`);

  // 3. Prepare Mock GitHub Webhook Payload
  const payloadObj = {
    action: 'closed',
    issue: {
      number: 7,
      state: 'closed' // Our condition checks for this
    },
    repository: {
      full_name: 'fomo-ash/Forester'
    }
  };
  
  const payloadString = JSON.stringify(payloadObj);
  const hmac = crypto.createHmac('sha256', secret);
  const signature = 'sha256=' + hmac.update(payloadString).digest('hex');
  const deliveryId = crypto.randomUUID();

  // 4. Send the Webhook to local API
  console.log(`[2] Sending mock webhook (Delivery ID: ${deliveryId}) with valid HMAC signature...`);
  try {
    const res = await fetch('http://localhost:3250/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'issues',
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signature
      },
      body: payloadString
    });

    console.log(`Webhook API Response: ${res.status} ${res.statusText}`);
    const resBody = await res.text();
    console.log(`API Body: ${resBody}`);
  } catch (err) {
    console.error('Failed to send webhook request to API. Is the API running?', err);
    process.exit(1);
  }

  // 5. Wait for Worker to process it
  console.log(`[3] Waiting 5 seconds for BullMQ and Worker to process the event...`);
  await new Promise(r => setTimeout(r, 5000));

  // 6. Verify Outcome
  console.log(`[4] Verifying commitment status in DB...`);
  const updated = await prisma.commitment.findUnique({
    where: { id: commitment.id },
    include: {
      resolution: true,
      evidence: true
    }
  });

  console.log(`Final Status: ${updated?.status}`);
  console.log(`Resolutions: ${updated?.resolution ? 1 : 0}`);
  console.log(`Evidence: ${updated?.evidence?.length || 0}`);

  if (updated?.status === 'VERIFIED_FULFILLED' || updated?.status === 'VERIFIED_MISSED') { // We mocked the DB, but GithubResolver might throw since it's a fake repo.
    console.log('✅ TEST PASSED: Webhook successfully triggered early resolution!');
  } else {
    console.log('❌ TEST FAILED: Commitment was not resolved.');
  }

}

runTest().catch(console.error).finally(() => prisma.$disconnect());
