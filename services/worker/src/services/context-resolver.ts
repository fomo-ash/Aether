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

    // 3. Resolve Target based on Verifier Requirements
    if (verifier.startsWith('github.')) {
      if (!extractedTarget) {
        missing.push('repository or target identifier');
      } else {
        const community = await prisma.community.findFirst({
          where: { id: communityId }
        });

        // Determine if target contains repo
        const hasExplicitRepo = extractedTarget.includes('/'); // e.g. "owner/repo#142" or "owner/repo@sha"
        const repoMatch = extractedTarget.match(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
        const repoBase = repoMatch ? repoMatch[1] : community?.defaultRepository;

        if (verifier === 'github.issue' || verifier === 'github.pull_request') {
          const numberMatch = extractedTarget.match(/#?(\d+)/);
          if (!numberMatch) {
            missing.push('issue/PR number');
          } else if (repoBase) {
            resolvedTarget = `${repoBase}#${numberMatch[1]}`;
          } else {
            missing.push('repository');
          }
        } else if (verifier === 'github.deployment') {
          const envMatch = extractedTarget.match(/#([a-zA-Z0-9_-]+)/);
          if (!envMatch) {
            missing.push('environment (e.g., #production)');
          } else if (repoBase) {
            resolvedTarget = `${repoBase}#${envMatch[1]}`;
          } else {
            missing.push('repository');
          }
        } else if (verifier === 'github.commit_status' || verifier === 'github.check_run') {
          const shaMatch = extractedTarget.match(/@([a-fA-F0-9]{7,40})/);
          if (!shaMatch) {
            missing.push('commit SHA (e.g., @a1b2c3d)');
          } else if (repoBase) {
            resolvedTarget = `${repoBase}@${shaMatch[1]}`;
          } else {
            missing.push('repository');
          }
        } else {
          resolvedTarget = extractedTarget; // Fallback for unknown github verifiers
        }
      }
    } else if (verifier === 'web.search') {
      resolvedTarget = extractedTarget || 'web.search';
    } else {
      resolvedTarget = extractedTarget || verifier;
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
