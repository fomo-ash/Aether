import { VerificationCondition, LeafCondition, CompositeCondition, EvidenceData, ResolutionStatus } from '@aether/verification-registry';

export class OutcomeResolver {
  
  /**
   * Evaluates if the collected evidence meets the given verification condition.
   * Also verifies temporal constraints (e.g., event happened before deadline).
   */
  static resolve(
    condition: VerificationCondition,
    evidenceRecords: Partial<EvidenceData>[],
    deadline: Date | null,
    config: any = {}
  ): ResolutionStatus {
    
    // Default to unresolved if no evidence
    if (evidenceRecords.length === 0) return 'UNRESOLVED';

    const minIndependentSources = config.minIndependentSources || 1;
    
    let isFulfilled = false;
    let hasTerminalFailure = false;

    for (const evidence of evidenceRecords) {
      const conditionMet = this.evaluateCondition(condition, evidence);
      
      // Temporal Correctness Logic
      let eventTime: Date | null = null;
      let collectedAt: Date = new Date();
      
      if (evidence.metadata?.collectedAt) collectedAt = new Date(evidence.metadata.collectedAt);
      
      // Extract exact event time if available
      if (evidence.payload?.closed_at) eventTime = new Date(evidence.payload.closed_at);
      else if (evidence.payload?.merged_at) eventTime = new Date(evidence.payload.merged_at);
      else if (evidence.payload?.completed_at) eventTime = new Date(evidence.payload.completed_at);
      else if (evidence.payload?.created_at) eventTime = new Date(evidence.payload.created_at);
      else if (evidence.payload?.updated_at) eventTime = new Date(evidence.payload.updated_at);
      
      // For web search results, check if we have enough independent sources meeting temporal bounds
      if (evidence.source === 'tavily' && evidence.payload?.results) {
        let independentValidSources = new Set<string>();
        
        for (const result of evidence.payload.results) {
           // We can't trust collectedAt for pre-deadline events.
           let publishedAt = result.publishedAt ? new Date(result.publishedAt) : null;
           
           // If we have a deadline, and the article was published AFTER the deadline, it does NOT prove it happened BEFORE.
           // If we have a deadline, and it was published BEFORE the deadline, it's valid evidence.
           // If there is no publication date, we can't definitively prove it happened before the deadline based on search time alone.
           // (For Phase 7, we'll assume if it's found and condition met, we check if publication was strictly before deadline).
           let isValidTemporally = true;
           if (deadline) {
             if (publishedAt && publishedAt > deadline) isValidTemporally = false;
             // If publishedAt is null, and collectedAt > deadline, we technically can't prove it.
             // But for simplicity in this phase, if we don't have publishedAt, we'll assume it's valid if conditionMet,
             // UNLESS we want to be strict. Let's be strict: if no published date, and collected after deadline, it's UNRESOLVED (treated as MISSED if deadline past).
             if (!publishedAt && collectedAt > deadline) isValidTemporally = false;
           }

           if (isValidTemporally) {
              try {
                const urlObj = new URL(result.sourceUrl || result.url);
                independentValidSources.add(urlObj.hostname);
              } catch (e) {
                independentValidSources.add(result.sourceUrl || result.url);
              }
           }
        }
        
        if (conditionMet && independentValidSources.size >= minIndependentSources) {
           isFulfilled = true;
           break;
        } else if (independentValidSources.size < minIndependentSources && deadline && new Date() > deadline) {
           // Not enough sources and deadline passed -> MISSED
           // But if it's a sweep, it will return UNRESOLVED or MISSED based on below
        }
      } else {
        // Standard single-source GitHub logic
        const happenedBeforeDeadline = !deadline || (eventTime && eventTime <= deadline) || (!eventTime && collectedAt <= deadline);

        if (conditionMet && happenedBeforeDeadline) {
          isFulfilled = true;
          break; // Short-circuit if any evidence proves it was fulfilled in time
        } else if (!conditionMet) {
          if (evidence.payload?.state === 'closed' && evidence.payload?.merged === false) {
             hasTerminalFailure = true;
          }
        }
      }
    }

    if (isFulfilled) return 'FULFILLED';
    
    // If we reach here, condition is not met.
    const now = new Date();
    if (deadline && now > deadline) {
      return 'MISSED'; // The deadline has passed and we have no proof of fulfillment
    }

    if (hasTerminalFailure) {
      return 'MISSED'; // Example: PR closed unmerged
    }

    return 'UNRESOLVED'; // Replaced PENDING with UNRESOLVED as requested for web search insufficient evidence
  }

  private static evaluateCondition(condition: VerificationCondition, evidence: Partial<EvidenceData>): boolean {
    if ('logicalOperator' in condition) {
      const comp = condition as CompositeCondition;
      if (comp.logicalOperator === 'AND') {
        return comp.conditions.every(c => this.evaluateCondition(c, evidence));
      } else if (comp.logicalOperator === 'OR') {
        return comp.conditions.some(c => this.evaluateCondition(c, evidence));
      }
      return false;
    } else {
      const leaf = condition as LeafCondition;
      return this.evaluateLeaf(leaf, evidence);
    }
  }

  private static evaluateLeaf(leaf: LeafCondition, evidence: Partial<EvidenceData>): boolean {
    // Determine the actual value from the evidence.
    // 'field' can be top-level observedState or a path in payload
    let actualValue: any;
    
    if (!leaf.field || leaf.field === 'state' || leaf.field === 'observedState') {
       actualValue = evidence.observedState;
    } else if (evidence.payload && leaf.field in evidence.payload) {
       actualValue = evidence.payload[leaf.field];
    } else if (evidence.payload && evidence.payload.statuses) {
       // specific for commit_status
       if (leaf.field === 'state') actualValue = evidence.payload.state;
       else actualValue = undefined;
    } else if (evidence.payload && evidence.payload.check_runs) {
       // specific for check_runs
       actualValue = evidence.observedState; // which we mapped to conclusion/status
    }

    switch (leaf.operator) {
      case 'equals':
        return actualValue === leaf.expected;
      case 'contains':
        return Array.isArray(actualValue) ? actualValue.includes(leaf.expected) : String(actualValue).includes(String(leaf.expected));
      case 'greater_than':
        return Number(actualValue) > Number(leaf.expected);
      case 'exists':
        return actualValue !== undefined && actualValue !== null;
      default:
        return false;
    }
  }
}
