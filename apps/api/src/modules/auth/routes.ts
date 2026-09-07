import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService } from './service.js';
import { registerSchema, loginSchema } from '@ai-options/shared';
import type { AuthPayload } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/register
  app.post('/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body.email, body.password, body.jurisdiction);
    reply.status(201).send(result);
  });

  // POST /auth/login
  app.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.email, body.password);
    reply.send(result);
  });

  // GET /auth/me
  app.get('/me', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await authService.getMe(req.userId!);
    reply.send(user);
  });
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid token' });
      return;
    }

    const token = authHeader.slice(7);
    const payload = req.server.jwt.verify(token) as AuthPayload;
    req.userId = payload.sub;
  } catch {
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' });
  }
}

export async function optionalAuth(req: FastifyRequest): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = req.server.jwt.verify(token) as AuthPayload;
      req.userId = payload.sub;
    }
  } catch {
    // Ignore - optional auth
  }
}