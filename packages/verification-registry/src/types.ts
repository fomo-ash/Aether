export type ResolutionStatus = 'FULFILLED' | 'MISSED' | 'UNRESOLVED' | 'PENDING' | 'CONFLICT';

export type ConditionOperator = 'equals' | 'contains' | 'greater_than' | 'exists';

export interface LeafCondition {
  field: string;
  operator: ConditionOperator;
  expected: any;
}

export interface CompositeCondition {
  logicalOperator: 'AND' | 'OR';
  conditions: Array<VerificationCondition>;
}

export type VerificationCondition = LeafCondition | CompositeCondition;

export interface VerificationContext {
  userId: string;
  communityId?: string | null;
  target: string;
  config?: any;
}

export interface EvidenceData {
  source: string;
  observedState: string;
  payload: any;
  externalIdentifier?: string;
  metadata?: any;
}

export interface VerificationProvider {
  readonly name: string;
  canVerify(verifierType: string): boolean;
  verify(
    verifierType: string,
    condition: VerificationCondition,
    context: VerificationContext
  ): Promise<Partial<EvidenceData>>;
}

export interface NormalizedWebhookEvent {
  provider: string;
  eventType: string;
  target: string;
  eventId: string;
  eventTime: Date;
  payload: any;
}
