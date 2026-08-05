import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

// Initialize Express 5
const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Logger (Pino HTTP)
// Note: In production, you would import your centralized logger from @flowpilot/logger
app.use(pinoHttp({
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
}));

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global Error Handler
// Express 5 automatically handles rejected promises in route handlers!
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  req.log.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const server = app.listen(PORT, () => {
  console.log(`API Service listening on port ${PORT}`);
});

// Graceful Shutdown
const shutdown = () => {
  console.log('Received kill signal, shutting down gracefully');
  server.close(() => {
    console.log('Closed out remaining connections');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
