import { PrismaClient } from '@flowpilot/database';
import { NormalizedWebhookEvent } from '@aether/verification-registry';

const prisma = new PrismaClient();

const CONTRIBUTION_RULES = {
  'github.pull_request.merged': {
    points: 10,
    reason: 'Pull Request merged',
  },
  'github.issues.resolved': {
    points: 10,
    reason: 'Issue resolved',
  },
  'github.pull_request.documentation_merged': {
    points: 5,
    reason: 'Documentation PR merged',
  },
  'github.pull_request.security_merged': {
    points: 20,
    reason: 'Significant/Security PR merged',
  }
};

export class ContributionEvaluator {
  /**
   * Evaluates a normalized webhook event to award Impact points to a community.
   */
  static async evaluate(event: NormalizedWebhookEvent) {
    if (event.provider !== 'github') return;

    // Determine specific sub-event type (e.g. pull_request closed and merged -> merged)
    let ruleKey: string | null = null;
    let githubUserId: string | null = null;
    let githubEventId = event.eventId; // e.g. deliveryId

    const payload = event.payload as any;

    if (event.eventType === 'pull_request') {
      const pr = payload.pull_request;
      const action = payload.action;

      if (action === 'closed' && pr.merged) {
        githubUserId = pr.user.id.toString();

        // Check if it's documentation or security based on labels or title
        const labels = pr.labels?.map((l: any) => l.name.toLowerCase()) || [];
        const isDocs = labels.some((l: string) => l.includes('doc')) || pr.title.toLowerCase().includes('doc');
        const isSecurity = labels.some((l: string) => l.includes('security')) || pr.title.toLowerCase().includes('security');

        if (isSecurity) {
          ruleKey = 'github.pull_request.security_merged';
        } else if (isDocs) {
          ruleKey = 'github.pull_request.documentation_merged';
        } else {
          ruleKey = 'github.pull_request.merged';
        }
      }
    } else if (event.eventType === 'issues') {
      const issue = payload.issue;
      const action = payload.action;

      // Closed with reason "completed" (resolved)
      if (action === 'closed' && issue.state_reason === 'completed') {
        githubUserId = issue.user.id.toString();
        // If an assignee closed it, we should reward the assignee, but user.id is safe fallback
        if (issue.assignee && issue.assignee.id) {
          githubUserId = issue.assignee.id.toString();
        }
        ruleKey = 'github.issues.resolved';
      }
    }

    if (!ruleKey || !githubUserId) {
      console.log(`[ContributionEvaluator] Event ${event.eventId} did not match any contribution rule or lacked user id.`);
      return;
    }

    const rule = (CONTRIBUTION_RULES as any)[ruleKey];
    if (!rule) return;

    // 1. Find the Aether User linked to this GitHub ID
    const identity = await prisma.userIdentity.findUnique({
      where: {
        platform_externalId: {
          platform: 'github',
          externalId: githubUserId
        }
      }
    });

    if (!identity) {
      console.log(`[ContributionEvaluator] GitHub user ${githubUserId} is not linked to any Aether account. Skipping Impact.`);
      return;
    }

    const userId = identity.userId;

    // 2. Find Communities tracking this Repository
    const repositoryFullName = payload.repository.full_name;
    const communityRepos = await prisma.communityRepository.findMany({
      where: { repositoryFullName },
      include: { community: true }
    });

    if (communityRepos.length === 0) {
      console.log(`[ContributionEvaluator] Repository ${repositoryFullName} is not tracked by any community.`);
      return;
    }

    // 3. Award Impact to each tracked Community Idempotently
    for (const cr of communityRepos) {
      const communityId = cr.communityId;
      const referenceKey = `impact_${communityId}_github_${githubEventId}_${ruleKey}`;

      try {
        await prisma.$transaction(async (tx: any) => {
          // Ensure ImpactAccount exists
          let impactAccount = await tx.impactAccount.findUnique({
            where: { userId_communityId: { userId, communityId } }
          });

          if (!impactAccount) {
            impactAccount = await tx.impactAccount.create({
              data: {
                userId,
                communityId,
                balance: 0
              }
            });
          }

          // Create the ledger entry (Throws P2002 if duplicate)
          await tx.impactTransaction.create({
            data: {
              impactAccountId: impactAccount.id,
              amount: rule.points,
              transactionType: 'CONTRIBUTION_AWARD',
              reason: rule.reason,
              referenceKey,
              metadata: { eventId: githubEventId, target: event.target, ruleKey }
            }
          });

          // Increment balance
          await tx.impactAccount.update({
            where: { id: impactAccount.id },
            data: { balance: { increment: rule.points } }
          });
        });

        console.log(`[ContributionEvaluator] Successfully awarded +${rule.points} Impact to User ${userId} in Community ${communityId}.`);
      } catch (err: any) {
        if (err.code === 'P2002') {
          console.log(`[ContributionEvaluator] Impact for event ${githubEventId} already awarded to User ${userId} in Community ${communityId} (Idempotent success).`);
        } else {
          console.error(`[ContributionEvaluator] Error awarding Impact to User ${userId} in Community ${communityId}:`, err);
        }
      }
    }
  }
}
