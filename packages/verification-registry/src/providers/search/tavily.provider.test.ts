import { TavilyProvider } from './tavily.provider';

async function runTests() {
  console.log('--- STARTING TAVILY PROVIDER TESTS ---');

  const provider = new TavilyProvider();

  // Mock Context
  const context = {
    userId: 'user1',
    target: 'When did OpenAI release GPT-4?',
  };
  const emptyCondition = { field: '', operator: 'exists' as const, expected: null };

  // 1. Mocked successful response
  console.log('\n[TEST 1] Mocked API Success');
  
  // Save original fetch
  const originalFetch = global.fetch;
  
  global.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        results: [
          { title: 'GPT-4 Release', url: 'https://openai.com/gpt-4', content: 'GPT-4 was released on March 14, 2023.', score: 0.99, published_date: '2023-03-14' }
        ]
      })
    } as any;
  };

  process.env.TAVILY_API_KEY = 'mock_key';
  let result = await provider.verify('web.search', emptyCondition, context);
  
  if (result.observedState !== 'found_results') throw new Error('Test 1 failed: Expected found_results');
  if (result.payload?.results.length !== 1) throw new Error('Test 1 failed: Expected 1 result');
  if (result.payload?.results[0].sourceType !== 'general_web') throw new Error('Test 1 failed: Expected general_web source type');
  console.log('✅ Test 1 Passed');

  // 2. Mocked API Error
  console.log('\n[TEST 2] Mocked API Error');
  global.fetch = async (url, options) => {
    return {
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    } as any;
  };

  result = await provider.verify('web.search', emptyCondition, context);
  if (result.observedState !== 'ERROR') throw new Error('Test 2 failed: Expected ERROR state');
  if (!result.payload?.error) throw new Error('Test 2 failed: Expected error message in payload');
  console.log('✅ Test 2 Passed');

  // Restore fetch
  global.fetch = originalFetch;

  console.log('\nALL MOCK TESTS PASSED SUCCESSFULLY! 🚀');

  // If we have a real key, run a real integration test
  if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY !== 'mock_key') {
    console.log('\n--- RUNNING REAL TAVILY INTEGRATION TEST ---');
    try {
      const realResult = await provider.verify('web.search', emptyCondition, {
        userId: 'test',
        target: 'Who won the Super Bowl in 2024?'
      });
      console.log('Integration result:', realResult.observedState, `(Found ${realResult.payload?.results?.length} results)`);
      if (realResult.observedState === 'found_results') {
        console.log('✅ Real Integration Test Passed');
      } else {
        console.error('❌ Real Integration Test Failed:', realResult);
      }
    } catch (e: any) {
      console.error('❌ Real Integration Test threw:', e.message);
    }
  } else {
    console.log('\n(Skipping real integration test - No valid TAVILY_API_KEY found in .env)');
  }
  
  process.exit(0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
