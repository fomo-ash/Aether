import { PrismaClient, TransactionType } from '../packages/database';

const prisma = new PrismaClient();

async function main() {
  console.log('--- FUNDING ALL TEST USERS & COMMUNITIES ---');
  
  const communities = await prisma.community.findMany();
  console.log(`Found ${communities.length} communities.`);

  const users = await prisma.user.findMany({
    include: { identities: true, reputationAccounts: true }
  });
  console.log(`Found ${users.length} users in database.`);

  for (const user of users) {
    const ident = user.identities.map(i => `${i.platform}:${i.externalId}`).join(', ');
    console.log(`User ${user.id} (${ident || 'no identity'}):`);

    for (const comm of communities) {
      const acct = await prisma.reputationAccount.upsert({
        where: { userId_communityId: { userId: user.id, communityId: comm.id } },
        update: { balance: { increment: 500 } },
        create: {
          userId: user.id,
          communityId: comm.id,
          balance: 500,
          lockedBalance: 0
        }
      });

      await prisma.reputationTransaction.create({
        data: {
          reputationAccountId: acct.id,
          amount: 500,
          transactionType: TransactionType.MANUAL_ADJUSTMENT,
          reason: 'Testing Grant +500 REP',
          referenceKey: `grant_${acct.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        }
      });

      console.log(`  -> Community ${comm.name} (${comm.id}): New Balance = ${acct.balance + 500} REP`);
    }
  }

  console.log('✅ ALL USERS FUNDED SUCCESSFULLY WITH +500 REP!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
