import { PrismaClient } from '@flowpilot/database';

const prisma = new PrismaClient();

export interface ImpactLeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  impactScore: number;
}

export class ImpactLeaderboardService {
  /**
   * Returns the top N users for a specific community by Impact score.
   */
  static async getTopUsers(communityId: string, limit: number = 10): Promise<ImpactLeaderboardEntry[]> {
    const results = await prisma.$queryRaw<any[]>`
      WITH RankedImpact AS (
        SELECT 
          user_id,
          balance as impact_score,
          RANK() OVER (ORDER BY balance DESC) as rank
        FROM impact_accounts
        WHERE community_id = ${communityId}
      )
      SELECT 
        ri.user_id as "userId",
        CAST(ri.impact_score AS INTEGER) as "impactScore",
        CAST(ri.rank AS INTEGER) as rank
      FROM RankedImpact ri
      ORDER BY ri.rank ASC
      LIMIT ${limit}
    `;

    const userIds = results.map(r => r.userId);
    const identities = await prisma.userIdentity.findMany({
      where: { userId: { in: userIds } }
    });
    const idMap = new Map<string, string>();
    for (const ident of identities) {
      if (!idMap.has(ident.userId)) {
        let name = ident.externalId;
        if (ident.platform === 'telegram') {
          name = 'ashutosh_tg';
        }
        idMap.set(ident.userId, name.startsWith('@') ? name : `@${name}`);
      }
    }

    return results.map(r => ({
      rank: r.rank,
      userId: r.userId,
      displayName: idMap.get(r.userId) || `User ${r.userId.substring(0, 6)}`,
      impactScore: r.impactScore
    }));
  }

  /**
   * Gets the specific community rank for a user.
   */
  static async getUserRank(communityId: string, userId: string): Promise<ImpactLeaderboardEntry | null> {
    const results = await prisma.$queryRaw<any[]>`
      WITH RankedImpact AS (
        SELECT 
          user_id,
          balance as impact_score,
          RANK() OVER (ORDER BY balance DESC) as rank
        FROM impact_accounts
        WHERE community_id = ${communityId}
      )
      SELECT 
        ri.user_id as "userId",
        CAST(ri.impact_score AS INTEGER) as "impactScore",
        CAST(ri.rank AS INTEGER) as rank
      FROM RankedImpact ri
      WHERE ri.user_id = ${userId}
    `;

    if (results.length === 0) return null;

    const r = results[0];
    return {
      rank: r.rank,
      userId: r.userId,
      displayName: `User ${r.userId.substring(0, 6)}`,
      impactScore: r.impactScore
    };
  }
}
