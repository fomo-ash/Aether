import { Verifier, VerificationPolicyContext, VerificationResult } from '../../types';
import { GithubAuthFactory } from './auth';

export class GithubIssueStatusVerifier implements Verifier {
  id = 'github.issue_status';

  async verify(context: VerificationPolicyContext): Promise<VerificationResult> {
    try {
      // Expect target format: owner/repo#issue_number
      const match = context.target.match(/^([^/]+)\/(.+)#(\d+)$/);
      if (!match) {
        return {
          status: 'UNRESOLVED',
          observedState: 'Invalid target format',
          payload: { error: 'Expected owner/repo#issue_number' }
        };
      }

      const [, owner, repo, issue_number] = match;
      const octokit = GithubAuthFactory.getOctokit(context);

      const { data } = await octokit.issues.get({
        owner,
        repo,
        issue_number: parseInt(issue_number, 10)
      });

      // We NEVER return the full `data` object which might contain sensitive headers/tokens
      // Extract only the public issue payload necessary for evidence
      const safePayload = {
        id: data.id,
        number: data.number,
        state: data.state,
        title: data.title,
        locked: data.locked,
        closed_at: data.closed_at
      };

      // Simple success condition evaluation: e.g. { "operator": "equals", "expected": "closed" }
      let isSuccess = false;
      if (context.successCondition?.operator === 'equals') {
        isSuccess = data.state === context.successCondition.expected;
      }

      // STRICT TIMELINE CHECK: You cannot claim credit for an issue closed before the commitment was created
      if (isSuccess && data.state === 'closed' && data.closed_at) {
        const closedAt = new Date(data.closed_at);
        if (closedAt <= context.createdAt) {
          isSuccess = false; // Invalid: closed prior to commitment
        } else if (context.deadline && closedAt > context.deadline) {
          isSuccess = false; // Invalid: closed AFTER the deadline
        }
      }

      return {
        status: isSuccess ? 'FULFILLED' : 'MISSED',
        observedState: data.state,
        payload: safePayload
      };
    } catch (error: any) {
      return {
        status: 'UNRESOLVED',
        observedState: 'Error querying GitHub',
        payload: { error: error.message }
      };
    }
  }
}
