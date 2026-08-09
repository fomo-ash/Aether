import express from 'express';
import { CommitmentController } from './controllers/commitment.controller';

const app = express();
const port = process.env.PORT || 3250;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'aether-api' });
});

app.post('/api/commitments', CommitmentController.create);

app.listen(port, () => {
  console.log(`Aether API listening on port ${port}`);
});
