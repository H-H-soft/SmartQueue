import express from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { createAuth } from './auth.js';
import { apiRoutes } from './api.js';

export function createApp({ service, staffKey, origin = 'http://localhost:5173', events, logger = console }) {
  if (!staffKey || staffKey.length < 32 || staffKey.startsWith('replace-')) throw new Error('Configure a random STAFF_API_KEY of at least 32 characters.');
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin }));
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Mutations have committed before notifications. A socket failure must not imply rollback.
  const notify = async (method, ...args) => {
    try { await events?.[method](...args); }
    catch (error) { logger.error('Realtime notification failed; REST state remains authoritative.', error); }
  };
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', apiRoutes(service, createAuth(service, staffKey), notify));
  app.use((req, res) => res.status(404).json({ error: { message: 'Endpoint not found.' } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) return res.status(400).json({ error: { message: 'Invalid input.', details: error.issues } });
    const status = error.code === 'P2002' ? 409 : error.code === 'P2025' ? 404 : error.status ?? 500;
    if (status >= 500) logger.error(error);
    res.status(status).json({ error: { message: status >= 500 ? 'Internal server error.'
      : error.code === 'P2002' ? 'A unique value already exists.' : error.message } });
  });
  return app;
}
