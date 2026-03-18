import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { membersRouter } from './routes/members.js';
import { registrationsRouter } from './routes/registrations.js';
import { csvRouter } from './routes/csv.js';
import { calendarsRouter } from './routes/calendars.js';
import { dbCopyRouter } from './routes/db-copy.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3002', 10);

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', healthRouter);
app.use('/api/events', eventsRouter);
app.use('/api/members', membersRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/csv', csvRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/db-copy', dbCopyRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Gatewaze API server running on port ${PORT}`);
});

export default app;
