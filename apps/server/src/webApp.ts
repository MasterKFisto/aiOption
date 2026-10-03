import fs from 'node:fs';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
  RawServerDefault,
} from 'fastify';

/**
 * Content-Security-Policy for the SPA. antd (CSS-in-JS) needs inline styles;
 * scripts are same-origin only; the browser talks only to this API.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/**
 * Serves the built web app (Phase 7 production). Only files under `distDir`
 * are reachable; dotfiles are never served; unknown non-API GETs fall back
 * to index.html (SPA routing); unknown /api routes stay JSON 404s.
 */
export async function registerWebApp<
  TServer extends RawServerBase = RawServerDefault,
  TLogger extends FastifyBaseLogger = FastifyBaseLogger,
>(
  app: FastifyInstance<
    TServer,
    RawRequestDefaultExpression<TServer>,
    RawReplyDefaultExpression<TServer>,
    TLogger
  >,
  distDir: string,
): Promise<void> {
  const root = path.resolve(distDir);
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile)) {
    app.log.warn({ root }, 'WEB_DIST_DIR has no index.html — web UI not served');
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: false,
    serveDotFiles: false,
    index: ['index.html'],
    setHeaders(reply, filePath) {
      reply.header('Content-Security-Policy', WEB_CSP);
      // Hashed asset names are immutable; index.html must always revalidate.
      reply.header(
        'Cache-Control',
        filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '/';
    if (request.method !== 'GET' || url.startsWith('/api/') || url === '/api' || path.extname(url) !== '') {
      return reply.code(404).send({ error: 'not found' });
    }
    reply.header('Content-Security-Policy', WEB_CSP);
    reply.header('Cache-Control', 'no-cache');
    return reply.type('text/html').send(fs.createReadStream(indexFile));
  });
  app.log.info({ root }, 'serving web app');
}
