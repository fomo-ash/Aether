import express from 'express';
import { CommitmentController } from './controllers/commitment.controller';
import { MessageController } from './controllers/message.controller';
import { GithubController } from './controllers/github.controller';

const app = express();
const port = process.env.PORT || 3250;

import { WebhookController } from './controllers/webhook.controller';
import { ReputationController } from './controllers/reputation.controller';

app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'aether-api' });
});

// Existing synchronous route (to be deprecated/moved to testing later)
app.post('/api/commitments', CommitmentController.create);
app.post('/api/commitments/:id/verify', CommitmentController.verify);

// Reputation visibility route
app.get('/api/reputation', ReputationController.getReputation);
app.get('/api/reputation/leaderboard', ReputationController.getLeaderboard);

// Impact visibility routes
import { ImpactController } from './controllers/impact.controller';
app.get('/api/impact', ImpactController.getImpactProfile);
app.get('/api/impact/leaderboard', ImpactController.getLeaderboard);

// Multiplayer routes (Phase 10)
import { MultiplayerController } from './controllers/multiplayer.controller';
app.post('/api/multiplayer/challenge', MultiplayerController.createChallenge);
app.post('/api/multiplayer/challenge/accept', MultiplayerController.acceptChallenge);
app.post('/api/multiplayer/challenge/cancel', MultiplayerController.cancelChallenge);
app.get('/api/multiplayer/challenges', MultiplayerController.listChallenges);

app.post('/api/multiplayer/market', MultiplayerController.createMarket);
app.post('/api/multiplayer/market/join', MultiplayerController.joinMarket);
app.post('/api/multiplayer/market/cancel', MultiplayerController.cancelMarket);
app.get('/api/multiplayer/markets', MultiplayerController.listMarkets);
app.get('/api/multiplayer/market/:id', MultiplayerController.getMarket);

// New asynchronous check route (Phase 7)
import { CheckController } from './controllers/check.controller';
app.post('/api/check', CheckController.check);

// New asynchronous LLM extraction route (Phase 3)
app.post('/api/messages/parse', MessageController.parse);

// Webhook route (Phase 7)
app.post('/api/webhooks/:provider', WebhookController.handleWebhook);

// GitHub OAuth App setup routes (Phase 6B)
app.get('/api/github/connect', GithubController.startOAuthFlow);
app.get('/api/github/callback', GithubController.oauthCallback);

const server = app.listen(port as number, '0.0.0.0', () => {
  console.log(`Aether API listening on port ${port}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
