import { Verifier, VerificationPolicyContext, VerificationResult } from '../../types';
import { GithubAuthFactory } from './auth';

export class GithubPrMergedVerifier implements Verifier {
  id = 'github.pr_merged';

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
      const octokit = GithubAuthFactory.getOctokit(context);

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
