import { VerificationProvider, VerificationCondition, VerificationContext, EvidenceData } from '../../types';
import { GithubAuthFactory } from './auth';

export class GithubProvider implements VerificationProvider {
  readonly name = 'github';

  private supportedTypes = [
    'github.issue',
    'github.pull_request',
    'github.check_run',
    'github.commit_status',
    'github.deployment'
  ];

  canVerify(verifierType: string): boolean {
    return this.supportedTypes.includes(verifierType);
  }

  async verify(
    verifierType: string,
    condition: VerificationCondition, // Conditions are evaluated by OutcomeResolver, but passed for context if needed
    context: VerificationContext
  ): Promise<Partial<EvidenceData>> {
    const octokit = GithubAuthFactory.getOctokit(context);

    try {
      switch (verifierType) {
        case 'github.issue':
          return await this.verifyIssue(octokit, context.target);
        case 'github.pull_request':
          return await this.verifyPullRequest(octokit, context.target);
        case 'github.check_run':
          return await this.verifyCheckRun(octokit, context.target);
        case 'github.commit_status':
          return await this.verifyCommitStatus(octokit, context.target);
        case 'github.deployment':
          return await this.verifyDeployment(octokit, context.target);
        default:
          throw new Error(`Unsupported verifierType for GithubProvider: ${verifierType}`);
      }
    } catch (error: any) {
      return {
        source: this.name,
        observedState: 'ERROR',
        payload: { error: error.message },
      };
    }
  }

  private async verifyIssue(octokit: any, target: string): Promise<Partial<EvidenceData>> {
    // Expected target: owner/repo#issue_number
    const match = target.match(/^([^/]+)\/(.+)#(\d+)$/);
    if (!match) throw new Error('Invalid target format for github.issue. Expected owner/repo#issue_number');
    const [, owner, repo, issue_number] = match;

    const { data } = await octokit.issues.get({ owner, repo, issue_number: parseInt(issue_number, 10) });

    return {
      source: this.name,
      observedState: data.state, // 'open' or 'closed'
      externalIdentifier: target,
      payload: {
        id: data.id,
        number: data.number,
        state: data.state,
        closed_at: data.closed_at,
        created_at: data.created_at,
      },
      metadata: { sourceUrl: data.html_url }
    };
  }

  private async verifyPullRequest(octokit: any, target: string): Promise<Partial<EvidenceData>> {
    const match = target.match(/^([^/]+)\/(.+)#(\d+)$/);
    if (!match) throw new Error('Invalid target format for github.pull_request. Expected owner/repo#pr_number');
    const [, owner, repo, pull_number] = match;

    const { data } = await octokit.pulls.get({ owner, repo, pull_number: parseInt(pull_number, 10) });

    return {
      source: this.name,
      observedState: data.merged ? 'merged' : data.state,
      externalIdentifier: target,
      payload: {
        id: data.id,
        number: data.number,
        state: data.state,
        merged: data.merged,
        merged_at: data.merged_at,
        closed_at: data.closed_at,
      },
      metadata: { sourceUrl: data.html_url }
    };
  }

  private async verifyCheckRun(octokit: any, target: string): Promise<Partial<EvidenceData>> {
    // Expected target format: owner/repo@sha#check_name
    // or owner/repo@sha (all checks)
    // For simplicity, let's assume owner/repo@sha
    const match = target.match(/^([^/]+)\/(.+)@([a-f0-9]+)$/);
    if (!match) throw new Error('Invalid target format for github.check_run. Expected owner/repo@sha');
    const [, owner, repo, ref] = match;

    const { data } = await octokit.checks.listForRef({ owner, repo, ref });
    
    // For aggregate check state, GitHub returns 'conclusion' on each. Let's return the full payload.
    return {
      source: this.name,
      observedState: data.total_count > 0 ? (data.check_runs[0].conclusion || data.check_runs[0].status) : 'missing',
      externalIdentifier: target,
      payload: {
        total_count: data.total_count,
        check_runs: data.check_runs.map((c: any) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion,
          completed_at: c.completed_at
        }))
      },
      metadata: { sourceUrl: `https://github.com/${owner}/${repo}/commits/${ref}` }
    };
  }

  private async verifyCommitStatus(octokit: any, target: string): Promise<Partial<EvidenceData>> {
    const match = target.match(/^([^/]+)\/(.+)@([a-f0-9]+)$/);
    if (!match) throw new Error('Invalid target format for github.commit_status. Expected owner/repo@sha');
    const [, owner, repo, ref] = match;

    const { data } = await octokit.repos.getCombinedStatusForRef({ owner, repo, ref });

    return {
      source: this.name,
      observedState: data.state, // 'pending', 'success', 'error', 'failure'
      externalIdentifier: target,
      payload: {
        state: data.state,
        statuses: data.statuses.map((s: any) => ({
          context: s.context,
          state: s.state,
          created_at: s.created_at,
          updated_at: s.updated_at
        }))
      },
      metadata: { sourceUrl: data.repository.html_url + '/commits/' + ref }
    };
  }

  private async verifyDeployment(octokit: any, target: string): Promise<Partial<EvidenceData>> {
    // Expected target format: owner/repo#environment (e.g. owner/repo#production)
    const match = target.match(/^([^/]+)\/(.+)#(.+)$/);
    if (!match) throw new Error('Invalid target format for github.deployment. Expected owner/repo#environment');
    const [, owner, repo, environment] = match;

    const { data: deployments } = await octokit.repos.listDeployments({ owner, repo, environment, per_page: 1 });
    
    if (deployments.length === 0) {
      return {
        source: this.name,
        observedState: 'not_found',
        externalIdentifier: target,
        payload: { deployments: [] }
      };
    }

    const deployment = deployments[0];
    const { data: statuses } = await octokit.repos.listDeploymentStatuses({ owner, repo, deployment_id: deployment.id, per_page: 1 });
    
    const latestStatus = statuses.length > 0 ? statuses[0].state : 'pending';

    return {
      source: this.name,
      observedState: latestStatus, // 'success', 'pending', 'error', 'failure', etc.
      externalIdentifier: target,
      payload: {
        deployment_id: deployment.id,
        environment: deployment.environment,
        created_at: deployment.created_at,
        latest_status: latestStatus,
        status_created_at: statuses.length > 0 ? statuses[0].created_at : null
      }
    };
  }
}
