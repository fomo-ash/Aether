import { PrismaClient } from '@flowpilot/database';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

const prisma = new PrismaClient();

const appId = process.env.GITHUB_APP_ID!;
const privateKeyRaw = process.env.GITHUB_PRIVATE_KEY!;
let privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, '\n') : '';
if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
  privateKey = privateKey.slice(1, -1);
} else if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
  privateKey = privateKey.slice(1, -1);
}

export class InaccessibleRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InaccessibleRepositoryError';
  }
}

export class GithubResolver {
  /**
   * Resolves the correct GitHub App Installation ID for a given repository.
   * Prioritizes Community-linked installations over User-linked installations.
   */
  static async resolveInstallation(
    userId: string,
    targetRepo: string, // e.g., "owner/repo"
    communityId?: string | null
  ): Promise<string> {
    
    // 1. Fetch Candidate Installations
    const candidates = new Map<string, { installationId: string; type: 'community' | 'user' }>();

    // Fetch Community-linked installations
    if (communityId) {
      const communityLinks = await prisma.communityGithubInstallation.findMany({
        where: { communityId },
        include: { installation: true },
        orderBy: { installation: { installationId: 'asc' } }, // Deterministic ordering
      });

      for (const link of communityLinks) {
        candidates.set(link.installation.installationId, {
          installationId: link.installation.installationId,
          type: 'community',
        });
      }
    }

    // Fetch User-linked installations
    const userLinks = await prisma.userGithubInstallation.findMany({
      where: { userId },
      include: { installation: true },
      orderBy: { installation: { installationId: 'asc' } },
    });

    for (const link of userLinks) {
      if (!candidates.has(link.installation.installationId)) {
        candidates.set(link.installation.installationId, {
          installationId: link.installation.installationId,
          type: 'user',
        });
      }
    }

    // Convert map to array and sort (Community > User)
    const candidateList = Array.from(candidates.values()).sort((a, b) => {
      if (a.type === 'community' && b.type === 'user') return -1;
      if (a.type === 'user' && b.type === 'community') return 1;
      return parseInt(a.installationId) - parseInt(b.installationId); // Deterministic fallback
    });

    if (candidateList.length === 0) {
      // Legacy Fallback Check (Phase 5)
      if (communityId) {
        const community = await prisma.community.findUnique({ where: { id: communityId } });
        if (community?.githubInstallationId) {
          console.warn(`[GithubResolver] Using legacy githubInstallationId for Community ${communityId}`);
          return community.githubInstallationId;
        }
      }
      throw new InaccessibleRepositoryError(`No candidate installations found for ${targetRepo}.`);
    }

    // 2. Check Access using the GitHub API
    const app = new App({ appId, privateKey });

    for (const candidate of candidateList) {
      try {
        const octokit = await app.getInstallationOctokit(parseInt(candidate.installationId, 10));
        
        // Paginate to find the repo (MVP: query accessible repos)
        // If the org has 1000s of repos, this could be slow, but GitHub provides a direct repo check API
        const [owner, repo] = targetRepo.split('/');
        
        try {
          // Check if this installation can access this specific repository
          // Using GET /repos/{owner}/{repo} as the installation
          const { data } = await octokit.request('GET /repos/{owner}/{repo}', {
            owner,
            repo,
          });

          if (data && data.full_name.toLowerCase() === targetRepo.toLowerCase()) {
            console.log(`[GithubResolver] Resolved installation ${candidate.installationId} for ${targetRepo}`);
            return candidate.installationId;
          }
        } catch (e: any) {
          if (e.status === 404 || e.status === 403) {
            // Installation cannot access this specific repository. Continue to next candidate.
            continue;
          }
          throw e; // Bubble up 5xx or rate limit errors
        }

      } catch (error: any) {
        console.warn(`[GithubResolver] Installation ${candidate.installationId} failed validation:`, error.message);
        // Could be suspended or uninstalled. In a future PR, we could delete it here or via webhook.
        continue; 
      }
    }

    throw new InaccessibleRepositoryError(`None of the linked installations have access to ${targetRepo}.`);
  }
}
