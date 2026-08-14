import { PrismaClient } from '@flowpilot/database';

const prisma = new PrismaClient();

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  totalRep: number;
  availableRep: number;
  lockedRep: number;
}

export class ReputationLeaderboardService {
  /**
   * Returns the top N users globally by total REP (available + locked).
   * Since ReputationAccount is community-scoped, we sum across all communities for a user.
   */
  static async getTopUsers(limit: number = 10): Promise<LeaderboardEntry[]> {
    const results = await prisma.$queryRaw<any[]>`
      WITH UserRep AS (
        SELECT 
          user_id,
          SUM(balance) as available_rep,
          SUM(locked_balance) as locked_rep,
          SUM(balance + locked_balance) as total_rep
        FROM reputation_accounts
        GROUP BY user_id
      ),
      RankedUsers AS (
        SELECT 
          user_id,
          CAST(available_rep AS INTEGER) as available_rep,
          CAST(locked_rep AS INTEGER) as locked_rep,
          CAST(total_rep AS INTEGER) as total_rep,
          RANK() OVER (ORDER BY total_rep DESC) as rank
        FROM UserRep
      )
      SELECT 
        ru.user_id as "userId",
        ru.available_rep as "availableRep",
        ru.locked_rep as "lockedRep",
        ru.total_rep as "totalRep",
        CAST(ru.rank AS INTEGER) as rank
      FROM RankedUsers ru
      ORDER BY ru.rank ASC
      LIMIT ${limit}
    `;

    return results.map(r => ({
      rank: r.rank,
      userId: r.userId,
      displayName: `User ${r.userId.substring(0, 6)}`, // Default display name since User table lacks one
      totalRep: r.totalRep,
      availableRep: r.availableRep,
      lockedRep: r.lockedRep
    }));
  }

  /**
   * Gets the specific global rank for a user.
   */
  static async getUserRank(userId: string): Promise<LeaderboardEntry | null> {
    const results = await prisma.$queryRaw<any[]>`
      WITH UserRep AS (
        SELECT 
          user_id,
          SUM(balance) as available_rep,
          SUM(locked_balance) as locked_rep,
          SUM(balance + locked_balance) as total_rep
        FROM reputation_accounts
        GROUP BY user_id
      ),
      RankedUsers AS (
        SELECT 
          user_id,
          CAST(available_rep AS INTEGER) as available_rep,
          CAST(locked_rep AS INTEGER) as locked_rep,
          CAST(total_rep AS INTEGER) as total_rep,
          RANK() OVER (ORDER BY total_rep DESC) as rank
        FROM UserRep
      )
      SELECT 
        ru.user_id as "userId",
        ru.available_rep as "availableRep",
        ru.locked_rep as "lockedRep",
        ru.total_rep as "totalRep",
        CAST(ru.rank AS INTEGER) as rank
      FROM RankedUsers ru
      WHERE ru.user_id = ${userId}
    `;

    if (results.length === 0) return null;

    const r = results[0];
    return {
      rank: r.rank,
      userId: r.userId,
      displayName: `User ${r.userId.substring(0, 6)}`,
      totalRep: r.totalRep,
      availableRep: r.availableRep,
      lockedRep: r.lockedRep
    };
  }
}
