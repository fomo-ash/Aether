import { PrismaClient, RewardPoolTransactionType } from '@flowpilot/database';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class RewardPoolService {
  /**
   * Initializes the global reward pool with the given amount.
   */
  static async initializeFund(amount: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      let pool = await tx.rewardPool.findUnique({
        where: { isGlobal: true }
      });

      if (!pool) {
        pool = await tx.rewardPool.create({
          data: { isGlobal: true, balance: 0 }
        });
      }

      await tx.rewardPool.update({
        where: { id: pool.id },
        data: { balance: { increment: amount } }
      });

      await tx.rewardPoolTransaction.create({
        data: {
          rewardPoolId: pool.id,
          type: RewardPoolTransactionType.INITIAL_FUNDING,
          amount,
          referenceKey: `initial_funding_${crypto.randomUUID()}`
        }
      });
    });
  }

  /**
   * Returns the current balance of the global reward pool.
   */
  static async getBalance(): Promise<number> {
    const pool = await prisma.rewardPool.findUnique({
      where: { isGlobal: true }
    });
    return pool?.balance || 0;
  }

  /**
   * Checks if the reward pool has sufficient funds for a potential net payout.
   */
  static async checkSolvency(netPayout: number): Promise<boolean> {
    const balance = await this.getBalance();
    return balance >= netPayout;
  }
}
