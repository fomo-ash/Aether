import { PrismaClient } from '@flowpilot/database';

// Simple jest mock shim MUST be declared before we mock anything
const jest = {
  fn: () => () => {},
  spyOn: (obj: any, method: string) => {
    let original = obj[method];
    let mockFn: any;
    obj[method] = function(...args: any[]) {
      if (mockFn) return mockFn(...args);
      return original.apply(this, args);
    };
    return {
      mockReturnValue: (val: any) => { mockFn = () => val; }
    };
  }
};

import { processVerificationJob } from './processor';
import { CommitmentService } from '@aether/commitments/dist/commitment.service';
import { OutboundResponder } from './services/outbound-responder';
import * as verifierRegistry from '@aether/verification-registry';

const prisma = new PrismaClient();

// Mock OutboundResponder to silence Discord noise
const sendMessageSpy = jest.fn();
(OutboundResponder as any).sendMessage = sendMessageSpy;

async function runTests() {
  console.log('--- STARTING E2E VERIFICATION MATRIX ---');

  // Clear DB
  await prisma.event.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.resolution.deleteMany();
  await prisma.reputationTransaction.deleteMany();
  await prisma.commitment.deleteMany();

  // Test 1-4 are mostly covered by processor.test.ts and github.provider.test.ts, but let's do a fast pass.
  // Test 5-16: Tavily
  
  // We'll mock VerificationRegistry to intercept Tavily requests and return specific test payloads
  const originalGetProvider = verifierRegistry.VerificationRegistry.getProvider;
  
  const runSearchTest = async (testName: string, mockResults: any[], expectedStatus: string, deadlineOffset: number = 100000) => {
    console.log(`\n[TEST] ${testName}`);
    
    // Mock provider
    jest.spyOn(verifierRegistry.VerificationRegistry, 'getProvider').mockReturnValue({
      name: 'tavily',
      canVerify: () => true,
      verify: async (type: string, cond: any, ctx: any) => ({
        source: 'tavily',
        observedState: mockResults.length > 0 ? 'found_results' : 'no_results',
        payload: { results: mockResults },
        metadata: { collectedAt: new Date().toISOString() }
      })
    } as any);

    const c = await CommitmentService.createCommitment({
      userId: 'e2e_user',
      communityId: 'e2e_comm',
      statement: testName,
      deadline: new Date(Date.now() + deadlineOffset).toISOString(),
      verifierType: 'web.search',
      target: testName,
      successCondition: { field: 'observedState', operator: 'equals', expected: 'found_results' },
      configuration: { minIndependentSources: 2 },
      reward: 5,
      penalty: 5
    });

    await processVerificationJob({ data: { commitmentId: c.id } });
    const dbC = await prisma.commitment.findUnique({ where: { id: c.id } });
    
    if (dbC?.status !== expectedStatus) {
      throw new Error(`Test failed: ${testName} - Expected ${expectedStatus} but got ${dbC?.status}`);
    }
    console.log(`✅ Passed (${expectedStatus})`);
  };

  // 6. Multiple independent sources agree -> FULFILLED
  await runSearchTest('6. Multiple independent sources', [
    { url: 'https://site1.com', publishedAt: new Date(Date.now() - 10000).toISOString() },
    { url: 'https://site2.com', publishedAt: new Date(Date.now() - 10000).toISOString() }
  ], 'VERIFIED_FULFILLED');

  // 8. Insufficient evidence (1 source when 2 needed) -> UNRESOLVED
  await runSearchTest('8. Insufficient evidence', [
    { url: 'https://site1.com', publishedAt: new Date(Date.now() - 10000).toISOString() }
  ], 'AWAITING_VERIFICATION'); // Pending unresolved is returned to engine, which leaves it awaiting

  // 12. Same article syndicated (same hostname) -> UNRESOLVED
  await runSearchTest('12. Syndicated article', [
    { url: 'https://site1.com/a', publishedAt: new Date(Date.now() - 10000).toISOString() },
    { url: 'https://site1.com/b', publishedAt: new Date(Date.now() - 10000).toISOString() }
  ], 'AWAITING_VERIFICATION');

  // 14. Evidence published after deadline -> UNRESOLVED/MISSED
  await runSearchTest('14. Published after deadline', [
    { url: 'https://site1.com', publishedAt: new Date(Date.now() + 50000).toISOString() },
    { url: 'https://site2.com', publishedAt: new Date(Date.now() + 50000).toISOString() }
  ], 'VERIFIED_MISSED', -10000); // Deadline in past

  // 16. No useful search evidence -> UNRESOLVED
  await runSearchTest('16. No search evidence', [], 'AWAITING_VERIFICATION');

  console.log('\nALL E2E MATRIX TESTS PASSED! 🚀');
  process.exit(0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
