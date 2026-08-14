import { PrismaClient } from '@flowpilot/database';

const prisma = new PrismaClient();
const repoName = process.argv[2];

async function linkRepo() {
  if (!repoName || !repoName.includes('/')) {
    console.error('❌ Please provide a valid repository name. Example: npx tsx scripts/link-repo.ts "owner/repo"');
    process.exit(1);
  }

  // Get the most recently active community as a guess for the user's Discord server
  const community = await prisma.community.findFirst({
    orderBy: { createdAt: 'desc' }
  });

  if (!community) {
    console.error('❌ No communities found in the database. Please run `/aether rep` in Discord first!');
    process.exit(1);
  }

  await prisma.communityRepository.upsert({
    where: {
      communityId_repositoryFullName: {
        communityId: community.id,
        repositoryFullName: repoName
      }
    },
    update: {},
    create: {
      communityId: community.id,
      repositoryFullName: repoName
    }
  });

  console.log(`✅ Successfully linked repository "${repoName}" to Community "${community.name}" (${community.platform}).`);
  console.log(`\nNext Steps:`);
  console.log(`1. Make sure your GitHub App is sending webhooks to your local Smee URL.`);
  console.log(`2. Smee should forward to: http://localhost:3250/api/webhooks/github`);
  console.log(`3. Merge a PR or close an issue in "${repoName}"!`);
}

linkRepo().catch(console.error).finally(() => prisma.$disconnect());
