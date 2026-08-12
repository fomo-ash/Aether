import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const commitments = await prisma.commitment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { verificationPolicy: true, user: true, community: true }
  });

  console.log('Latest 5 Commitments:');
  for (const c of commitments) {
    console.log(`- ID: ${c.id}`);
    console.log(`  Status: ${c.status}`);
    console.log(`  Target: ${c.verificationPolicy?.target}`);
    console.log(`  CreatedAt: ${c.createdAt}`);
  }

  const events = await prisma.event.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.log('\nLatest 5 Events:');
  for (const e of events) {
    console.log(`- ${e.eventType} at ${e.createdAt}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
