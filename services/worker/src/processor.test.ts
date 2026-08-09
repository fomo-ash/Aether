import { PrismaClient } from '@flowpilot/database';
import { processVerificationJob } from './processor';
import { CommitmentCreateDTO } from '@aether/commitments/dist/commitment.schema';
import { CommitmentService } from '@aether/commitments/dist/commitment.service';
import { OutboundResponder } from './services/outbound-responder';
import * as verifierRegistry from '@aether/verification-registry';

const prisma = new PrismaClient();

// Mock the OutboundResponder
const sendMessageSpy = jest.fn();
(OutboundResponder as any).sendMessage = sendMessageSpy;

// We need jest/vitest, but since we are running natively we can just use simple asserts
async function runTests() {
  console.log('--- STARTING VERIFICATION PROCESSOR TESTS ---');

  // Clear DB
  await prisma.event.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.resolution.deleteMany();
  await prisma.reputationTransaction.deleteMany();
  await prisma.commitment.deleteMany();
  await prisma.reputationAccount.deleteMany();
  await prisma.communityMember.deleteMany();
  await prisma.community.deleteMany();
  await prisma.user.deleteMany();

  // Setup mock verifier
  let mockVerifierResult = { status: 'FULFILLED', observedState: 'closed', payload: {} };
  jest.spyOn(verifierRegistry, 'getVerifier').mockReturnValue({
    id: 'mock_verifier',
    verify: async () => mockVerifierResult
  });

  // TEST 1: Normal fulfillment
  console.log('\n[TEST 1] Normal Fulfillment');
  const c1 = await CommitmentService.createCommitment({
    userId: 'user1',
    communityId: 'comm1',
    statement: 'close #1',
    deadline: new Date(Date.now() + 100000).toISOString(),
    verifierType: 'github.issue_status',
    target: 'repo#1',
    successCondition: { expected: 'closed' },
    reward: 5,
    penalty: 5
  });

  await processVerificationJob({ data: { commitmentId: c1.id } });
  
  let dbC1 = await prisma.commitment.findUnique({ where: { id: c1.id } });
  let repTx = await prisma.reputationTransaction.findFirst({ where: { commitmentId: c1.id } });
  let acc = await prisma.reputationAccount.findUnique({ where: { userId_communityId: { userId: 'user1', communityId: 'comm1' } } });
  
  if (dbC1?.status !== 'VERIFIED_FULFILLED') throw new Error('Test 1 Failed: Status not FULFILLED');
  if (repTx?.amount !== 5) throw new Error('Test 1 Failed: Rep not +5');
  if (acc?.balance !== 5) throw new Error('Test 1 Failed: Account balance not 5');
  console.log('✅ Test 1 Passed');

  // TEST 2: Normal miss
  console.log('\n[TEST 2] Normal Miss');
  mockVerifierResult = { status: 'MISSED', observedState: 'open', payload: {} };
  const c2 = await CommitmentService.createCommitment({
    userId: 'user1',
    communityId: 'comm1',
    statement: 'close #2',
    deadline: new Date(Date.now() + 100000).toISOString(),
    verifierType: 'github.issue_status',
    target: 'repo#2',
    successCondition: { expected: 'closed' },
    reward: 5,
    penalty: 5
  });

  await processVerificationJob({ data: { commitmentId: c2.id } });
  
  let dbC2 = await prisma.commitment.findUnique({ where: { id: c2.id } });
  acc = await prisma.reputationAccount.findUnique({ where: { userId_communityId: { userId: 'user1', communityId: 'comm1' } } });
  
  if (dbC2?.status !== 'VERIFIED_MISSED') throw new Error('Test 2 Failed: Status not MISSED');
  if (acc?.balance !== 0) throw new Error(`Test 2 Failed: Account balance not 0 (was ${acc?.balance})`);
  console.log('✅ Test 2 Passed');

  // TEST 3: Sequential retry
  console.log('\n[TEST 3] Sequential Retry');
  const res3 = await processVerificationJob({ data: { commitmentId: c2.id } });
  if (res3.reason !== 'already_resolved') throw new Error('Test 3 Failed: Did not fast-fail on status check');
  
  const evidenceCount = await prisma.evidence.count({ where: { commitmentId: c2.id } });
  if (evidenceCount !== 1) throw new Error('Test 3 Failed: Duplicate evidence created');
  console.log('✅ Test 3 Passed');

  // TEST 4 & 5: Concurrent processing & Concurrent Account Creation
  console.log('\n[TEST 4 & 5] Concurrent Processing & Upsert Races');
  mockVerifierResult = { status: 'FULFILLED', observedState: 'closed', payload: {} };
  
  const c4 = await CommitmentService.createCommitment({
    userId: 'user_race',
    communityId: 'comm_race',
    statement: 'race',
    deadline: new Date(Date.now() + 100000).toISOString(),
    verifierType: 'github.issue_status',
    target: 'repo#race',
    successCondition: { expected: 'closed' },
    reward: 10,
    penalty: 10
  });

  // Run two exact same jobs concurrently
  const p1 = processVerificationJob({ data: { commitmentId: c4.id } });
  const p2 = processVerificationJob({ data: { commitmentId: c4.id } });
  
  const results = await Promise.all([p1, p2]);
  
  const dbC4 = await prisma.commitment.findUnique({ where: { id: c4.id }, include: { reputationTransactions: true, evidence: true } });
  if (dbC4?.reputationTransactions.length !== 1) throw new Error('Test 4/5 Failed: Duplicate RepTx created');
  if (dbC4?.evidence.length !== 1) throw new Error('Test 4/5 Failed: Duplicate Evidence created');
  
  const raceAcc = await prisma.reputationAccount.findUnique({ where: { userId_communityId: { userId: 'user_race', communityId: 'comm_race' } } });
  if (raceAcc?.balance !== 10) throw new Error('Test 4/5 Failed: Incorrect balance');
  console.log('✅ Test 4 & 5 Passed');

  // TEST 6: Notification failure
  console.log('\n[TEST 6] Notification Failure does not rollback');
  sendMessageSpy.mockRejectedValueOnce(new Error('Discord is down'));
  
  const c6 = await CommitmentService.createCommitment({
    userId: 'user1',
    communityId: 'comm1',
    statement: 'test notif',
    deadline: new Date().toISOString(),
    verifierType: 'mock',
    target: 'notif',
    successCondition: {},
    reward: 5,
    penalty: 5
  });

  await processVerificationJob({ data: { commitmentId: c6.id } });
  const dbC6 = await prisma.commitment.findUnique({ where: { id: c6.id } });
  if (dbC6?.status !== 'VERIFIED_FULFILLED') throw new Error('Test 6 Failed: DB Rolled back');
  console.log('✅ Test 6 Passed');

  // TEST 7: P2002 Idempotency
  console.log('\n[TEST 7] P2002 Idempotency Handling');
  // We can simulate a P2002 by creating a manual reputation transaction with the same reference key
  // and running the worker again while bypassing the status check artificially.
  // Since we already test concurrent races that hit the updateMany block, this specifically
  // ensures our err.code === 'P2002' check works.
  
  const c7 = await CommitmentService.createCommitment({
    userId: 'user7',
    communityId: 'comm7',
    statement: 'test p2002',
    deadline: new Date().toISOString(),
    verifierType: 'mock',
    target: 'p2002',
    successCondition: {},
    reward: 5,
    penalty: 5
  });

  // Force the DB to have a conflicting reputation transaction manually before the worker runs
  let acc7 = await prisma.reputationAccount.create({
    data: { userId: 'user7', communityId: 'comm7', balance: 0 }
  });
  
  await prisma.reputationTransaction.create({
    data: {
      reputationAccountId: acc7.id,
      amount: 5,
      transactionType: 'COMMITMENT_FULFILLED',
      reason: 'manual conflict',
      commitmentId: c7.id,
      referenceKey: `commitment:${c7.id}:fulfilled`
    }
  });

  mockVerifierResult = { status: 'FULFILLED', observedState: 'closed', payload: {} };
  
  // This will try to insert the exact same referenceKey, throwing P2002.
  // The worker should catch it and return success!
  const res7 = await processVerificationJob({ data: { commitmentId: c7.id } });
  
  if (res7.reason !== 'p2002_idempotency_hit') throw new Error('Test 7 Failed: P2002 was not gracefully handled');
  console.log('✅ Test 7 Passed');

  console.log('\nALL TESTS PASSED SUCCESSFULLY! 🚀');
  process.exit(0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
