import { EvidenceData } from '@aether/verification-registry';
import { AIService } from '../services/ai.service';

export type CheckOutcome = 'VERIFIED' | 'NOT_VERIFIED' | 'INSUFFICIENT_EVIDENCE';

export class EvidenceEvaluator {
  /**
   * Evaluates evidence statelessly, independent of commitments or reputation.
   */
  static async evaluateWebSearch(claim: string, evidenceRecords: Partial<EvidenceData>[], config: any = {}): Promise<CheckOutcome> {
    if (evidenceRecords.length === 0) return 'INSUFFICIENT_EVIDENCE';
    
    // Configurable minimum independent sources, defaulting to 1 for MVP
    const minIndependentSources = config.minIndependentSources || 1;
    
    for (const evidence of evidenceRecords) {
      if (evidence.source === 'tavily' && evidence.payload?.results) {
        let independentValidSources = new Set<string>();
        let evidenceText = '';
        
        for (const result of evidence.payload.results) {
          try {
            const urlObj = new URL(result.sourceUrl || result.url);
            independentValidSources.add(urlObj.hostname);
          } catch (e) {
            independentValidSources.add(result.sourceUrl || result.url);
          }
          evidenceText += `Source: ${result.title}\nContent: ${result.content}\n\n`;
        }
        
        // If we found results, evaluate independence
        if (evidence.observedState === 'found_results') {
          if (independentValidSources.size >= minIndependentSources) {
             // Ask LLM to evaluate the evidence against the claim
             const outcome = await AIService.evaluateFactCheck(claim, evidenceText);
             console.log(`[EvidenceEvaluator] AI returned outcome: ${outcome} based on ${independentValidSources.size} sources.`);
             return outcome;
          } else {
             console.log(`[EvidenceEvaluator] INSUFFICIENT_EVIDENCE: found ${independentValidSources.size} sources, needed ${minIndependentSources}`);
             // Not enough independent sources
             return 'INSUFFICIENT_EVIDENCE';
          }
        } else if (evidence.observedState === 'no_results') {
           // We might consider this NOT_VERIFIED, but uncertainty is INSUFFICIENT_EVIDENCE
           return 'INSUFFICIENT_EVIDENCE';
        }
      }
    }
    
    return 'INSUFFICIENT_EVIDENCE';
  }
}
