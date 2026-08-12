import { GithubProvider } from './github.provider';
import { GithubAuthFactory } from './auth';

async function runTests() {
  console.log('--- STARTING GITHUB PROVIDER TESTS ---');

  const provider = new GithubProvider();

  // Mock Context
  const context = {
    userId: 'user1',
    target: '',
  };
  const emptyCondition = { field: '', operator: 'exists' as const, expected: null };

  // 1. github.pull_request
  console.log('\n[TEST 1] github.pull_request - Merged');
  let mockOctokit = {
    pulls: {
      get: async () => ({ data: { id: 1, number: 1, state: 'closed', merged: true, html_url: 'url' } })
    }
  };
  jest.spyOn(GithubAuthFactory, 'getOctokit').mockReturnValue(mockOctokit as any);

  let result = await provider.verify('github.pull_request', emptyCondition, { ...context, target: 'owner/repo#1' });
  if (result.observedState !== 'merged') throw new Error('Test 1 failed: Expected merged');
  console.log('✅ Test 1 Passed');

  console.log('\n[TEST 2] github.deployment - Success');
  mockOctokit = {
    repos: {
      listDeployments: async () => ({ data: [{ id: 123, environment: 'production', created_at: 'now' }] }),
      listDeploymentStatuses: async () => ({ data: [{ state: 'success', created_at: 'now' }] })
    }
  } as any;
  jest.spyOn(GithubAuthFactory, 'getOctokit').mockReturnValue(mockOctokit as any);

  result = await provider.verify('github.deployment', emptyCondition, { ...context, target: 'owner/repo#production' });
  if (result.observedState !== 'success') throw new Error('Test 2 failed: Expected success');
  console.log('✅ Test 2 Passed');

  console.log('\n[TEST 3] github.deployment - Missing Deployment');
  mockOctokit = {
    repos: {
      listDeployments: async () => ({ data: [] }),
    }
  } as any;
  jest.spyOn(GithubAuthFactory, 'getOctokit').mockReturnValue(mockOctokit as any);

  result = await provider.verify('github.deployment', emptyCondition, { ...context, target: 'owner/repo#production' });
  if (result.observedState !== 'not_found') throw new Error('Test 3 failed: Expected not_found');
  console.log('✅ Test 3 Passed');

  console.log('\n[TEST 4] github.check_run - Failed Checks');
  mockOctokit = {
    checks: {
      listForRef: async () => ({ data: { total_count: 2, check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] } })
    }
  } as any;
  jest.spyOn(GithubAuthFactory, 'getOctokit').mockReturnValue(mockOctokit as any);

  result = await provider.verify('github.check_run', emptyCondition, { ...context, target: 'owner/repo@abc1234' });
  if (result.observedState !== 'failure') throw new Error('Test 4 failed: Expected failure');
  console.log('✅ Test 4 Passed');
  
  console.log('\n[TEST 5] github.commit_status - Pending Status');
  mockOctokit = {
    repos: {
      getCombinedStatusForRef: async () => ({ data: { state: 'pending', statuses: [], repository: { html_url: 'url' } } })
    }
  } as any;
  jest.spyOn(GithubAuthFactory, 'getOctokit').mockReturnValue(mockOctokit as any);

  result = await provider.verify('github.commit_status', emptyCondition, { ...context, target: 'owner/repo@abc1234' });
  if (result.observedState !== 'pending') throw new Error('Test 5 failed: Expected pending');
  console.log('✅ Test 5 Passed');

  console.log('\nALL GITHUB PROVIDER TESTS PASSED SUCCESSFULLY! 🚀');
  process.exit(0);
}

// We need jest to mock properly in a standalone script without actual jest runner
const jest = {
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

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
