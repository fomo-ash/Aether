import { Request, Response } from 'express';
import { PrismaClient } from '@flowpilot/database';
import { ImpactLeaderboardService } from '../services/impact-leaderboard.service';

const prisma = new PrismaClient();

export class ImpactController {
  static async getImpactProfile(req: Request, res: Response) {
    const { userId, communityId } = req.query;

    if (!userId || !communityId) {
      return res.status(400).json({ error: 'userId and communityId are required' });
    }

    try {
      const account = await prisma.impactAccount.findUnique({
        where: { userId_communityId: { userId: userId as string, communityId: communityId as string } }
      });

      const impactScore = account?.balance || 0;

      let rankData = await ImpactLeaderboardService.getUserRank(communityId as string, userId as string);
      
      const recentTx = account ? await prisma.impactTransaction.findMany({
        where: { impactAccountId: account.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { amount: true, reason: true, createdAt: true, transactionType: true }
      }) : [];

      return res.json({
        userId,
        communityId,
        impactScore,
        rank: rankData?.rank || null,
        recentContributions: recentTx
      });
    } catch (error: any) {
      console.error('Error fetching impact profile:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getLeaderboard(req: Request, res: Response) {
    const { communityId } = req.query;

    if (!communityId) {
      return res.status(400).json({ error: 'communityId is required' });
    }

    try {
      const leaderboard = await ImpactLeaderboardService.getTopUsers(communityId as string, 10);
      return res.json(leaderboard);
    } catch (error: any) {
      console.error('Error fetching impact leaderboard:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
