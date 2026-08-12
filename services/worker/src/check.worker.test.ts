import { EvidenceEvaluator } from './resolvers/evidence.evaluator';
import { EvidenceData } from '@aether/verification-registry';

jest.mock('./services/ai.service', () => ({
  AIService: {
    evaluateFactCheck: jest.fn().mockImplementation(async (claim: string, evidenceText: string) => {
      if (claim.includes('verified')) return 'VERIFIED';
      if (claim.includes('contradicted')) return 'NOT_VERIFIED';
      return 'INSUFFICIENT_EVIDENCE';
    })
  }
}));

describe('EvidenceEvaluator', () => {
  it('should return INSUFFICIENT_EVIDENCE if no evidence', async () => {
    const outcome = await EvidenceEvaluator.evaluateWebSearch('test', [], { minIndependentSources: 1 });
    expect(outcome).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('should return INSUFFICIENT_EVIDENCE if no results found', async () => {
    const evidence: Partial<EvidenceData> = {
      source: 'tavily',
      observedState: 'no_results'
    };
    const outcome = await EvidenceEvaluator.evaluateWebSearch('test', [evidence], { minIndependentSources: 1 });
    expect(outcome).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('should return INSUFFICIENT_EVIDENCE if not enough independent sources', async () => {
    const evidence: Partial<EvidenceData> = {
      source: 'tavily',
      observedState: 'found_results',
      payload: {
        results: [
          { url: 'https://example.com/1', title: 'test1', content: 'test1' },
          { url: 'https://example.com/2', title: 'test2', content: 'test2' }
        ]
      }
    };
    // 2 sources from same domain (example.com) should count as 1
    const outcome = await EvidenceEvaluator.evaluateWebSearch('test verified', [evidence], { minIndependentSources: 2 });
    expect(outcome).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('should return VERIFIED if claim supported by enough independent sources', async () => {
    const evidence: Partial<EvidenceData> = {
      source: 'tavily',
      observedState: 'found_results',
      payload: {
        results: [
          { url: 'https://example1.com/1', title: 'test1', content: 'test1' },
          { url: 'https://example2.com/2', title: 'test2', content: 'test2' }
        ]
      }
    };
    const outcome = await EvidenceEvaluator.evaluateWebSearch('test verified', [evidence], { minIndependentSources: 2 });
    expect(outcome).toBe('VERIFIED');
  });

  it('should return NOT_VERIFIED if claim contradicted', async () => {
    const evidence: Partial<EvidenceData> = {
      source: 'tavily',
      observedState: 'found_results',
      payload: {
        results: [
          { url: 'https://example1.com/1', title: 'test1', content: 'test1' },
          { url: 'https://example2.com/2', title: 'test2', content: 'test2' }
        ]
      }
    };
    const outcome = await EvidenceEvaluator.evaluateWebSearch('test contradicted', [evidence], { minIndependentSources: 2 });
    expect(outcome).toBe('NOT_VERIFIED');
  });
});
