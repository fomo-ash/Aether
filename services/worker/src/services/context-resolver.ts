import * as chrono from 'chrono-node';
import { PrismaClient } from '@flowpilot/database';

const prisma = new PrismaClient();

export interface ResolvedContext {
  isComplete: boolean;
  missingRequirements: string[];
  resolvedTarget?: string;
  resolvedDeadline?: Date;
  resolvedStake?: number;
  proposedVerifier: string;
}

export class ContextResolver {
  /**
   * Deterministically resolves context based on Verifier Requirements and Community Settings.
   */
  static async resolve(
    communityId: string,
    extractedVerifier: string | null | undefined,
    extractedTarget: string | null | undefined,
    extractedDeadline: string | null | undefined,
    extractedStake: number | null | undefined
  ): Promise<ResolvedContext> {

    // Default to github.issue_status if none proposed
    const verifier = extractedVerifier || 'github.issue_status';

    const missing: string[] = [];
    let resolvedTarget: string | undefined = undefined;
    let resolvedDeadline: Date | undefined = undefined;

    // 1. Resolve Deadline
    if (!extractedDeadline) {
      missing.push('deadline');
    } else {
      const parsedDate = new Date(extractedDeadline);
      if (isNaN(parsedDate.getTime())) {
        missing.push('deadline');
      } else {
        resolvedDeadline = parsedDate;
      }
    }

    // 2. Resolve Stake
    let resolvedStake: number | undefined = undefined;
    if (extractedStake === undefined || extractedStake === null || extractedStake < 5 || extractedStake > 20) {
      missing.push('reputation stake amount (must be an integer between 5 and 20)');
    } else {
      resolvedStake = extractedStake;
    }

    // 2. Resolve Target (Repository/Issue) based on Verifier Requirements
    if (verifier === 'github.issue_status' || verifier === 'github.pr_merged') {
      if (!extractedTarget) {
        missing.push('repository or issue/PR number');
      } else {
        // Fetch Community context
        const community = await prisma.community.findFirst({
          where: { id: communityId }
        });

        // E.g., target is "issue #142" -> extract "142"
        const numberMatch = extractedTarget.match(/#?(\d+)/);
        const hasExplicitRepo = extractedTarget.includes('/'); // e.g. "owner/repo#142"

        if (!numberMatch) {
          missing.push('issue/PR number');
        } else if (hasExplicitRepo) {
          // They explicitly provided "owner/repo#142", use it as is (stripped of words)
          const repoMatch = extractedTarget.match(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
          if (repoMatch) {
            resolvedTarget = `${repoMatch[1]}#${numberMatch[1]}`;
          } else {
            missing.push('valid repository format (owner/repo)');
          }
        } else if (community?.defaultRepository) {
          // Deterministically prepend default repo
          resolvedTarget = `${community.defaultRepository}#${numberMatch[1]}`;
        } else {
          // We have the number, but no repo, and no default repo
          missing.push('repository');
        }
      }
    }

    return {
      isComplete: missing.length === 0,
      missingRequirements: missing,
      resolvedTarget,
      resolvedDeadline,
      resolvedStake,
      proposedVerifier: verifier
    };
  }
}
