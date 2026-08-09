import { Octokit } from '@octokit/rest';
import { Verifier, VerificationPolicyContext, VerificationResult } from '../../types';

export class GithubPrMergedVerifier implements Verifier {
  id = 'github.pr_merged';

  private getOctokit(context: VerificationPolicyContext): Octokit {
    if (context.githubInstallationId) {
      console.log(`[Github Auth] Using Installation ID: ${context.githubInstallationId}`);
      throw new Error('GitHub App Installation exchange not yet implemented');
    }

    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log(`[Github Auth] Falling back to GITHUB_TOKEN environment variable (dev only)`);
      return new Octokit(process.env.GITHUB_TOKEN ? { auth: process.env.GITHUB_TOKEN } : undefined);
    }

    throw new Error('Production authentication requires a githubInstallationId.');
  }

  async verify(context: VerificationPolicyContext): Promise<VerificationResult> {
    try {
      // Expect target format: owner/repo#pr_number
      const match = context.target.match(/^([^/]+)\/(.+)#(\d+)$/);
      if (!match) {
        return {
          status: 'UNRESOLVED',
          observedState: 'Invalid target format',
          payload: { error: 'Expected owner/repo#pr_number' }
        };
      }

      const [, owner, repo, pull_number] = match;
      const octokit = this.getOctokit(context);

      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: parseInt(pull_number, 10)
      });

      const safePayload = {
        id: data.id,
        number: data.number,
        state: data.state,
        title: data.title,
        locked: data.locked,
        merged: data.merged
      };

      // PR Merged verification specifically checks if merged === true
      let isSuccess = false;
      if (context.successCondition?.operator === 'equals' && context.successCondition.expected === 'merged') {
        isSuccess = data.merged === true;
      } else if (context.successCondition?.operator === 'equals') {
        // Fallback for just checking state === 'closed'
        isSuccess = data.state === context.successCondition.expected;
      }

      return {
        status: isSuccess ? 'FULFILLED' : 'MISSED',
        observedState: data.merged ? 'merged' : data.state,
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
