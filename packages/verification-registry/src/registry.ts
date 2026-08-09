import { Verifier } from './types';
import { GithubIssueStatusVerifier } from './providers/github/issue-status';
import { GithubPrMergedVerifier } from './providers/github/pr-merged';

export const registry = new Map<string, Verifier>();

function register(verifier: Verifier) {
  registry.set(verifier.id, verifier);
}

// Register all verifiers
register(new GithubIssueStatusVerifier());
register(new GithubPrMergedVerifier());

export function getVerifier(id: string): Verifier {
  const verifier = registry.get(id);
  if (!verifier) {
    throw new Error(`Verifier not found for id: ${id}`);
  }
  return verifier;
}
