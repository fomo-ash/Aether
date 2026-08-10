export type ResolutionStatus = 'FULFILLED' | 'MISSED' | 'UNRESOLVED';

export interface VerificationPolicyContext {
  commitmentId: string;
  target: string;
  successCondition: any;
  configuration: any;
  githubInstallationId?: string;
  createdAt: Date;
}

export interface VerificationResult {
  status: ResolutionStatus;
  observedState: string;
  payload: any;
}

export interface Verifier {
  id: string;
  verify(context: VerificationPolicyContext): Promise<VerificationResult>;
}
