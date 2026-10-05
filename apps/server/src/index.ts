import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = await buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  // Explicit, greppable startup line (Phase 7.4.1): the API must bind all
  // container interfaces (HOST=0.0.0.0) so Caddy can reach it — never 127.0.0.1
  // inside the container (loopback-only exposure is enforced by compose).
  logger.info(`Server listening at http://${config.HOST}:${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
