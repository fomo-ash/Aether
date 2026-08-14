import { Request, Response } from 'express';
import { ReputationService } from '../services/reputation.service';
import { ReputationLeaderboardService } from '../services/reputation-leaderboard.service';
import { ImpactLeaderboardService } from '../services/impact-leaderboard.service';

export class ReputationController {
  static async getReputation(req: Request, res: Response) {
    const { userId, communityId } = req.query;

    if (!userId || !communityId) {
      return res.status(400).json({ error: 'userId and communityId are required' });
    }

    try {
      const summary = await ReputationService.getSummary(userId as string, communityId as string);
      
      const rankData = await ReputationLeaderboardService.getUserRank(userId as string);
      const impactRankData = await ImpactLeaderboardService.getUserRank(communityId as string, userId as string);
      
      return res.json({
        ...summary,
        globalRank: rankData?.rank || null,
        totalRep: rankData?.totalRep || 0,
        communityImpact: impactRankData?.impactScore || 0,
        impactRank: impactRankData?.rank || null
      });
    } catch (error: any) {
      console.error('Error fetching reputation summary:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getLeaderboard(req: Request, res: Response) {
    try {
      const leaderboard = await ReputationLeaderboardService.getTopUsers(10);
      return res.json(leaderboard);
    } catch (error: any) {
      console.error('Error fetching global reputation leaderboard:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
