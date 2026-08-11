import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables for the GitHub App credentials
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function run() {
  console.log('Starting Phase 6B Migration...');
  const communities = await prisma.community.findMany({
    where: {
      githubInstallationId: {
        not: null,
      },
    },
  });

  console.log(`Found ${communities.length} communities with a legacy githubInstallationId.`);

  if (communities.length === 0) {
    console.log('No migration needed.');
    return;
  }

  const appId = process.env.GITHUB_APP_ID;
  let privateKeyRaw = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKeyRaw) {
    console.error('Error: GITHUB_APP_ID or GITHUB_PRIVATE_KEY is missing. Cannot fetch metadata from GitHub.');
    process.exit(1);
  }

  let privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  } else if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
    privateKey = privateKey.slice(1, -1);
  }

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });

  for (const community of communities) {
    const installationId = community.githubInstallationId!;
    const legacyId = installationId;
    console.log(`\nMigrating installation ${installationId} for Community ${community.id}...`);

    try {
      // Fetch installation metadata from GitHub
        const { data: installationData } = await octokit.request('GET /app/installations/{installation_id}', {
          installation_id: parseInt(legacyId, 10),
        });

        const accountLogin = (installationData as any).account?.login || 'unknown';
        const accountType = (installationData as any).account?.type || 'unknown';
      const githubAccountId = (installationData as any).account?.id || 0;

      // Upsert the GithubInstallation record
      const githubInstallation = await prisma.githubInstallation.upsert({
        where: { installationId },
        update: {
          accountLogin,
          accountType,
          githubAccountId: BigInt(githubAccountId),
        },
        create: {
          installationId,
          accountLogin,
          accountType,
          githubAccountId: BigInt(githubAccountId),
        },
      });

      console.log(`Verified and saved GithubInstallation: ${githubInstallation.id}`);

      // Link it to the Community
      await prisma.communityGithubInstallation.upsert({
        where: {
          communityId_githubInstallationId: {
            communityId: community.id,
            githubInstallationId: githubInstallation.id,
          },
        },
        update: {},
        create: {
          communityId: community.id,
          githubInstallationId: githubInstallation.id,
        },
      });

      console.log(`Successfully linked Installation ${installationId} to Community ${community.id}`);
    } catch (err: any) {
      console.error(`Failed to migrate installation ${installationId}:`, err.message);
    }
  }

  console.log('\nMigration complete.');
}

run()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
