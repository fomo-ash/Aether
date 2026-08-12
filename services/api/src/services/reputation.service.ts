import { PrismaClient, TransactionType } from '@flowpilot/database';

const prisma = new PrismaClient();

export interface ReputationSummary {
  userId: string;
  communityId: string;
  balance: number;
  tier: string;
  progressToNextTier: number | null; // percentage 0-100
  nextTierName: string | null;
  fulfilledCommitments: number;
  missedCommitments: number;
  recentTransactions: Array<{ amount: number; reason: string; createdAt: Date; type: TransactionType }>;
}

export class ReputationService {
  /**
   * Evaluates the tier of a user based on their REP balance.
   */
  static getTier(balance: number): { name: string; threshold: number; nextThreshold: number | null; nextName: string | null } {
    if (balance < 200) return { name: 'Bronze', threshold: 0, nextThreshold: 200, nextName: 'Silver' };
    if (balance < 400) return { name: 'Silver', threshold: 200, nextThreshold: 400, nextName: 'Gold' };
    if (balance < 700) return { name: 'Gold', threshold: 400, nextThreshold: 700, nextName: 'Platinum' };
    if (balance < 1000) return { name: 'Platinum', threshold: 700, nextThreshold: 1000, nextName: 'Diamond' };
    return { name: 'Diamond', threshold: 1000, nextThreshold: null, nextName: null };
  }

  /**
   * Fetches the user's reputation summary.
   */
  static async getSummary(userId: string, communityId: string): Promise<ReputationSummary> {
    const account = await prisma.reputationAccount.findUnique({
      where: { userId_communityId: { userId, communityId } }
    });

    const balance = account?.balance || 0;
    const tierInfo = ReputationService.getTier(balance);

    const progress = tierInfo.nextThreshold ? (balance - tierInfo.threshold) / (tierInfo.nextThreshold - tierInfo.threshold) * 100 : null;

    // Fetch commitments stats
    const commitments = await prisma.commitment.groupBy({
      by: ['status'],
      where: { userId, communityId },
      _count: { status: true }
    });

    let fulfilledCount = 0;
    let missedCount = 0;
    for (const c of commitments) {
      if (c.status === 'VERIFIED_FULFILLED') fulfilledCount = c._count.status;
      if (c.status === 'VERIFIED_MISSED') missedCount = c._count.status;
    }

    // Fetch recent transactions
    let recentTx: Array<{ amount: number; reason: string; createdAt: Date; transactionType: TransactionType }> = [];
    if (account) {
      recentTx = await prisma.reputationTransaction.findMany({
        where: { reputationAccountId: account.id },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { amount: true, reason: true, createdAt: true, transactionType: true }
      });
    }

    return {
      userId,
      communityId,
      balance,
      tier: tierInfo.name,
      progressToNextTier: progress ? Math.round(progress) : null,
      nextTierName: tierInfo.nextName,
      fulfilledCommitments: fulfilledCount,
      missedCommitments: missedCount,
      recentTransactions: recentTx.map(tx => ({
        amount: tx.amount,
        reason: tx.reason,
        createdAt: tx.createdAt,
        type: tx.transactionType
      }))
    };
  }
}
