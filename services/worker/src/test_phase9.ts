import { PrismaClient } from '@flowpilot/database';
import { ContributionEvaluator } from './services/contribution.evaluator';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function runTests() {
  console.log('--- STARTING PHASE 9 VALIDATION SUITE ---\n');
  
  // Setup Test Data
  const userId = crypto.randomUUID();
  const user = await prisma.user.create({ data: { id: userId, email: `test_${userId}@phase9.local` } });
  
  const communityIdA = crypto.randomUUID();
  const communityIdB = crypto.randomUUID();
  await prisma.community.create({ data: { id: communityIdA, name: 'Community A', platform: 'test', externalId: communityIdA } });
  await prisma.community.create({ data: { id: communityIdB, name: 'Community B', platform: 'test', externalId: communityIdB } });
  
  // Map GitHub identity
  const githubUserId = `gh_user_${crypto.randomUUID()}`;
  await prisma.userIdentity.create({
    data: { userId, platform: 'github', externalId: githubUserId }
  });

  // Track Repositories
  const repoName = `owner/repo_${crypto.randomUUID()}`;
  await prisma.communityRepository.create({
    data: { communityId: communityIdA, repositoryFullName: repoName }
  });
  await prisma.communityRepository.create({
    data: { communityId: communityIdB, repositoryFullName: repoName }
  });

  const createEvent = (action: string, merged: boolean, eventId: string, overrides: any = {}) => ({
    provider: 'github',
    eventType: 'pull_request',
    target: `${overrides.repo || repoName}#1`,
    eventId,
    eventTime: new Date(),
    payload: {
      action,
      repository: { full_name: overrides.repo || repoName },
      pull_request: {
        merged,
        user: { id: overrides.ghUserId || githubUserId },
        title: 'Test PR',
        labels: []
      }
    }
  });

  try {
    // 1. IMPACT ACCOUNTING
    console.log('[Test] Impact Accounting');
    await ContributionEvaluator.evaluate(createEvent('closed', true, 'evt_1') as any);
    let acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (acct?.balance !== 10) throw new Error(`Expected 10, got ${acct?.balance}`);
    
    // docs PR +5
    const evt2 = createEvent('closed', true, 'evt_2');
    evt2.payload.pull_request.labels = [{ name: 'docs' }] as any;
    await ContributionEvaluator.evaluate(evt2 as any);
    acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (acct?.balance !== 15) throw new Error(`Expected 15, got ${acct?.balance}`);
    
    console.log('✅ Impact Accounting Passed\n');

    // 2. IDEMPOTENCY
    console.log('[Test] Idempotency (Concurrent duplicates)');
    const dupEvent = createEvent('closed', true, 'evt_dup');
    await Promise.all(Array(10).fill(0).map(() => ContributionEvaluator.evaluate(dupEvent as any)));
    acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (acct?.balance !== 25) throw new Error(`Expected 25 after exactly ONE success, got ${acct?.balance}`);
    let txCount = await prisma.impactTransaction.count({ where: { impactAccountId: acct.id } });
    if (txCount !== 3) throw new Error(`Expected 3 tx, got ${txCount}`);
    console.log('✅ Idempotency Passed\n');

    // 3. CONCURRENT DIFFERENT EVENTS
    console.log('[Test] Concurrent Different Events');
    const events = Array(10).fill(0).map((_, i) => createEvent('closed', true, `evt_conc_${i}`));
    await Promise.all(events.map(e => ContributionEvaluator.evaluate(e as any)));
    acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (acct?.balance !== 125) throw new Error(`Expected 125 (25 + 100), got ${acct?.balance}`);
    txCount = await prisma.impactTransaction.count({ where: { impactAccountId: acct.id } });
    if (txCount !== 13) throw new Error(`Expected 13 tx, got ${txCount}`);
    console.log('✅ Concurrent Different Events Passed\n');

    // 4. COMMUNITY ISOLATION
    console.log('[Test] Community Isolation');
    let acctB = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdB } } });
    if (acctB?.balance !== 125) throw new Error(`Expected 125 for Comm B too, got ${acctB?.balance}`);
    
    // Now create an event for a repo tracked ONLY by Community A
    await prisma.communityRepository.create({ data: { communityId: communityIdA, repositoryFullName: 'owner/onlyA' } });
    await ContributionEvaluator.evaluate(createEvent('closed', true, 'evt_onlyA', { repo: 'owner/onlyA' }) as any);
    
    acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    acctB = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdB } } });
    if (acct?.balance !== 135) throw new Error(`Expected 135 for Comm A, got ${acct?.balance}`);
    if (acctB?.balance !== 125) throw new Error(`Expected 125 for Comm B, got ${acctB?.balance}`);
    console.log('✅ Community Isolation Passed\n');

    // 5. UNKNOWN REPOSITORY
    console.log('[Test] Unknown Repository');
    await ContributionEvaluator.evaluate(createEvent('closed', true, 'evt_unk', { repo: 'owner/unknown' }) as any);
    // Just verify it doesn't crash and balances don't change
    acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (acct?.balance !== 135) throw new Error(`Expected unchanged 135, got ${acct?.balance}`);
    console.log('✅ Unknown Repository Passed\n');

    // 6. UNKNOWN USER
    console.log('[Test] Unknown User');
    await ContributionEvaluator.evaluate(createEvent('closed', true, 'evt_unk_user', { ghUserId: 'unknown_ghost' }) as any);
    acct = await prisma.impactAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (acct?.balance !== 135) throw new Error(`Expected unchanged 135, got ${acct?.balance}`);
    console.log('✅ Unknown User Passed\n');

    // 7. REP / IMPACT ISOLATION
    console.log('[Test] REP / Impact Isolation');
    // Ensure ReputationAccount wasn't touched
    let repAcct = await prisma.reputationAccount.findUnique({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (repAcct) throw new Error('ReputationAccount should not exist yet');
    
    // Create REP manually
    repAcct = await prisma.reputationAccount.create({ data: { userId, communityId: communityIdA, balance: 100 } });
    await prisma.reputationTransaction.create({
      data: { reputationAccountId: repAcct.id, amount: 100, transactionType: 'COMMITMENT_FULFILLED', reason: 'Test', referenceKey: `rep_${crypto.randomUUID()}` }
    });

    // Award impact again
    await ContributionEvaluator.evaluate(createEvent('closed', true, 'evt_rep_iso') as any);
    repAcct = await prisma.reputationAccount.findUniqueOrThrow({ where: { userId_communityId: { userId, communityId: communityIdA } } });
    if (repAcct.balance !== 100) throw new Error(`Expected REP 100, got ${repAcct.balance}`);
    let repTxCount = await prisma.reputationTransaction.count({ where: { reputationAccountId: repAcct.id } });
    if (repTxCount !== 1) throw new Error(`Expected 1 REP tx, got ${repTxCount}`);
    console.log('✅ REP / Impact Isolation Passed\n');

    // 8. GLOBAL REP LEADERBOARD
    console.log('[Test] Global REP Leaderboard');
    // Setup users
    const uA = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `ua_${crypto.randomUUID()}@local` } });
    const uB = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `ub_${crypto.randomUUID()}@local` } });
    const uC = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `uc_${crypto.randomUUID()}@local` } });
    
    await prisma.reputationAccount.create({ data: { userId: uA.id, communityId: communityIdA, balance: 50, lockedBalance: 100 } });
    await prisma.reputationAccount.create({ data: { userId: uB.id, communityId: communityIdA, balance: 140, lockedBalance: 0 } });
    await prisma.reputationAccount.create({ data: { userId: uC.id, communityId: communityIdA, balance: 75, lockedBalance: 100 } });

    const { ReputationLeaderboardService } = require('../../api/src/services/reputation-leaderboard.service');
    const uCRank = await ReputationLeaderboardService.getUserRank(uC.id);
    const uARank = await ReputationLeaderboardService.getUserRank(uA.id);
    const uBRank = await ReputationLeaderboardService.getUserRank(uB.id);
    
    if (uCRank.totalRep !== 175) throw new Error(`Expected 175, got ${uCRank.totalRep}`);
    if (uARank.totalRep !== 150) throw new Error(`Expected 150, got ${uARank.totalRep}`);
    if (uBRank.totalRep !== 140) throw new Error(`Expected 140, got ${uBRank.totalRep}`);
    
    if (uCRank.rank >= uARank.rank) throw new Error(`Expected uC to be ranked higher than uA`);
    if (uARank.rank >= uBRank.rank) throw new Error(`Expected uA to be ranked higher than uB`);
    console.log('✅ Global REP Leaderboard Passed\n');

    // 9. IMPACT LEADERBOARD
    console.log('[Test] Impact Leaderboard');
    await prisma.impactAccount.create({ data: { userId: uA.id, communityId: communityIdA, balance: 100 } });
    await prisma.impactAccount.create({ data: { userId: uB.id, communityId: communityIdA, balance: 200 } });
    await prisma.impactAccount.create({ data: { userId: uC.id, communityId: communityIdA, balance: 50 } });

    await prisma.impactAccount.create({ data: { userId: uA.id, communityId: communityIdB, balance: 500 } });
    await prisma.impactAccount.create({ data: { userId: uB.id, communityId: communityIdB, balance: 10 } });

    const { ImpactLeaderboardService } = require('../../api/src/services/impact-leaderboard.service');
    const impactTopA = await ImpactLeaderboardService.getTopUsers(communityIdA, 3);
    const impactTopB = await ImpactLeaderboardService.getTopUsers(communityIdB, 2);

    if (impactTopA[0].userId !== uB.id) throw new Error(`Expected uB #1 in Comm A`);
    if (impactTopA[0].impactScore !== 200) throw new Error(`Expected 200, got ${impactTopA[0].impactScore}`);
    
    if (impactTopB[0].userId !== uA.id) throw new Error(`Expected uA #1 in Comm B`);
    if (impactTopB[0].impactScore !== 500) throw new Error(`Expected 500, got ${impactTopB[0].impactScore}`);
    console.log('✅ Impact Leaderboard Passed\n');

    console.log('--- ALL VALIDATION TESTS PASSED ---');
  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  }
}

runTests();

