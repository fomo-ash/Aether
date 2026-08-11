import express from 'express';
import { CommitmentController } from './controllers/commitment.controller';
import { MessageController } from './controllers/message.controller';
import { GithubController } from './controllers/github.controller';

const app = express();
const port = process.env.PORT || 3250;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'aether-api' });
});

// Existing synchronous route (to be deprecated/moved to testing later)
app.post('/api/commitments', CommitmentController.create);
app.post('/api/commitments/:id/verify', CommitmentController.verify);

// New asynchronous LLM extraction route (Phase 3)
app.post('/api/messages/parse', MessageController.parse);

// GitHub OAuth App setup routes (Phase 6B)
app.get('/api/github/connect', GithubController.startOAuthFlow);
app.get('/api/github/callback', GithubController.oauthCallback);

app.listen(port, () => {
  console.log(`Aether API listening on port ${port}`);
});
