import type { FastifyInstance } from 'fastify';

import { subscribeToEvents } from '../events/eventBus.js';

/**
 * Server-sent events stream. Registered with prefix /api → GET /api/events.
 * Pushes account, trade, risk, decision, deposit and withdrawal events to the
 * frontend so the dashboard updates without polling.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/events', async (_request, reply) => {
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const unsubscribe = subscribeToEvents((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);

    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
