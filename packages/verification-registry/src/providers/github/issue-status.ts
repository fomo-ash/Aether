import { Octokit } from '@octokit/rest';
import { Verifier, VerificationPolicyContext, VerificationResult } from '../../types';

export class GithubIssueStatusVerifier implements Verifier {
  id = 'github.issue_status';
  private octokit: Octokit;

  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }

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
      const { data } = await this.octokit.issues.get({
        owner,
        repo,
        issue_number: parseInt(issue_number, 10)
      });

      // Simple success condition evaluation: e.g. { "operator": "equals", "expected": "closed" }
      let isSuccess = false;
      if (context.successCondition?.operator === 'equals') {
        isSuccess = data.state === context.successCondition.expected;
      }

      return {
        status: isSuccess ? 'FULFILLED' : 'MISSED',
        observedState: data.state,
        payload: data
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
