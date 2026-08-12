import assert from 'node:assert';
import { EvidenceEvaluator } from './resolvers/evidence.evaluator';
import { EvidenceData } from '@aether/verification-registry';
import { AIService } from './services/ai.service';

// Mock AIService
(AIService as any).evaluateFactCheck = async (claim: string, evidenceText: string) => {
  if (claim.includes('verified')) return 'VERIFIED';
  if (claim.includes('contradicted')) return 'NOT_VERIFIED';
  return 'INSUFFICIENT_EVIDENCE';
};

async function runTests() {
  console.log('Running CheckWorker tests...');

  // 1. INSUFFICIENT_EVIDENCE if no evidence
  let outcome = await EvidenceEvaluator.evaluateWebSearch('test', [], { minIndependentSources: 1 });
  assert.strictEqual(outcome, 'INSUFFICIENT_EVIDENCE');

  // 2. INSUFFICIENT_EVIDENCE if no results found
  let evidence: Partial<EvidenceData> = {
    source: 'tavily',
    observedState: 'no_results'
  };
  outcome = await EvidenceEvaluator.evaluateWebSearch('test', [evidence], { minIndependentSources: 1 });
  assert.strictEqual(outcome, 'INSUFFICIENT_EVIDENCE');

  // 3. INSUFFICIENT_EVIDENCE if not enough independent sources (syndicated)
  evidence = {
    source: 'tavily',
    observedState: 'found_results',
    payload: {
      results: [
        { url: 'https://example.com/1', title: 'test1', content: 'test1' },
        { url: 'https://example.com/2', title: 'test2', content: 'test2' }
      ]
    }
  };
  outcome = await EvidenceEvaluator.evaluateWebSearch('test verified', [evidence], { minIndependentSources: 2 });
  assert.strictEqual(outcome, 'INSUFFICIENT_EVIDENCE');

  // 4. VERIFIED if claim supported by enough independent sources
  evidence = {
    source: 'tavily',
    observedState: 'found_results',
    payload: {
      results: [
        { url: 'https://example1.com/1', title: 'test1', content: 'test1' },
        { url: 'https://example2.com/2', title: 'test2', content: 'test2' }
      ]
    }
  };
  outcome = await EvidenceEvaluator.evaluateWebSearch('test verified', [evidence], { minIndependentSources: 2 });
  assert.strictEqual(outcome, 'VERIFIED');

  // 5. NOT_VERIFIED if claim contradicted
  outcome = await EvidenceEvaluator.evaluateWebSearch('test contradicted', [evidence], { minIndependentSources: 2 });
  assert.strictEqual(outcome, 'NOT_VERIFIED');

  console.log('✅ All unit tests passed.');
}

runTests().catch(console.error);
