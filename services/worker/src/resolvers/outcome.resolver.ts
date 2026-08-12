import { VerificationCondition, LeafCondition, CompositeCondition, EvidenceData, ResolutionStatus } from '@aether/verification-registry';

export class OutcomeResolver {
  
  /**
   * Evaluates if the collected evidence meets the given verification condition.
   * Also verifies temporal constraints (e.g., event happened before deadline).
   */
  static resolve(
    condition: VerificationCondition,
    evidenceRecords: Partial<EvidenceData>[],
    deadline: Date | null
  ): ResolutionStatus {
    
    // Default to unresolved if no evidence
    if (evidenceRecords.length === 0) return 'UNRESOLVED';

    // Phase 7 simple conflict resolution: If any evidence meets the condition, it's FULFILLED.
    // If all evidence says it's not fulfilled and we are past the deadline, it's MISSED.
    // If we are before the deadline, it's PENDING.

    // Let's grab the latest evidence based on timestamp or just evaluate all.
    // Since we want to support event_time vs deadline:
    
    let isFulfilled = false;
    let isTemporarilyFailing = false;
    let hasTerminalFailure = false; // Optional, hard to determine from raw state

    for (const evidence of evidenceRecords) {
      const conditionMet = this.evaluateCondition(condition, evidence);
      
      // Check temporal constraint: did the event happen before the deadline?
      let eventTime = new Date();
      if (evidence.payload?.closed_at) eventTime = new Date(evidence.payload.closed_at);
      else if (evidence.payload?.merged_at) eventTime = new Date(evidence.payload.merged_at);
      else if (evidence.payload?.completed_at) eventTime = new Date(evidence.payload.completed_at);
      else if (evidence.payload?.created_at) eventTime = new Date(evidence.payload.created_at);
      else if (evidence.payload?.updated_at) eventTime = new Date(evidence.payload.updated_at);
      // else fallback to current time / collected_at

      const happenedBeforeDeadline = !deadline || (eventTime <= deadline);

      if (conditionMet && happenedBeforeDeadline) {
        isFulfilled = true;
        break; // Short-circuit if any evidence proves it was fulfilled in time
      } else if (!conditionMet) {
        isTemporarilyFailing = true;
        // Check if there is an irreversible failure like PR closed without merging
        if (evidence.payload?.state === 'closed' && evidence.payload?.merged === false) {
           hasTerminalFailure = true;
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

    return 'PENDING'; // Deadline hasn't passed, still waiting
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
