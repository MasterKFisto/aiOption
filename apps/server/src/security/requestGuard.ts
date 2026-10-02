import type { FastifyReply, FastifyRequest } from 'fastify';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Hostnames that always refer to this machine. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/** User-facing message when a write is blocked because of its origin. */
export const CROSS_SITE_BLOCKED_MESSAGE =
  'This action was blocked because the request did not come from the AI Option app. ' +
  'Open the app at http://localhost:5173 (or add the address you use to CORS_ORIGIN in .env) and try again.';

export const HOST_BLOCKED_MESSAGE =
  'This server only accepts requests addressed to localhost. ' +
  'Open the app at http://localhost:5173 (or add the hostname you use to ALLOWED_HOSTS in .env).';

export interface RequestGuardOptions {
  /** Hostnames (no port) the API may be addressed as. */
  allowedHosts: string[];
  /** Browser origins allowed to make state-changing requests ('*' = any). */
  allowedOrigins: string[];
}

interface ParsedOrigin {
  protocol: string;
  hostname: string;
  port: string;
}

function parseOrigin(origin: string): ParsedOrigin | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return {
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    };
  } catch {
    return null; // "null" or malformed origins are never trusted
  }
}

/**
 * Builds the origin matcher shared by CORS and the CSRF guard.
 *
 * An origin is trusted when it is exactly allow-listed, OR when it is a
 * loopback origin (localhost / 127.0.0.1 / [::1]) using the same scheme and
 * port as an allow-listed loopback origin. So http://127.0.0.1:5173 and
 * http://[::1]:5173 are treated like the configured http://localhost:5173 —
 * they are the same app on this machine — while any other site stays blocked.
 */
export function createOriginMatcher(allowedOrigins: string[]): (origin: string) => boolean {
  const exact = new Set(allowedOrigins.map((o) => o.trim().toLowerCase().replace(/\/$/, '')));
  const loopbackKeys = new Set<string>();
  for (const entry of exact) {
    const parsed = parseOrigin(entry);
    if (parsed && LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
      loopbackKeys.add(`${parsed.protocol}//${parsed.port}`);
    }
  }
  return (origin: string): boolean => {
    const normalized = origin.trim().toLowerCase().replace(/\/$/, '');
    if (exact.has(normalized)) {
      return true;
    }
    const parsed = parseOrigin(normalized);
    return (
      parsed !== null &&
      LOOPBACK_HOSTNAMES.has(parsed.hostname) &&
      loopbackKeys.has(`${parsed.protocol}//${parsed.port}`)
    );
  };
}

/** Hostname part of a Host header ("localhost:8080" → "localhost", "[::1]:8080" → "::1"). */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : value;
  }
  const colon = value.lastIndexOf(':');
  return colon > 0 && value.indexOf(':') === colon ? value.slice(0, colon) : value;
}

/**
 * Request guard for a personal, single-user local app (Phase 6.5.1 security):
 *
 * 1. DNS-rebinding protection: rejects requests whose Host header is not a
 *    configured local hostname (a rebinding domain would send its own name).
 * 2. CSRF protection: rejects state-changing requests sent by a browser from
 *    a foreign origin (Origin not allow-listed, or Sec-Fetch-Site:
 *    cross-site). CORS alone only hides the response — it does not stop a
 *    "simple" cross-site POST from executing.
 *
 * Non-browser clients (curl, scripts) send no Origin header and are allowed.
 */
export function createRequestGuard(
  options: RequestGuardOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  const hosts = new Set(options.allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const anyOrigin = options.allowedOrigins.includes('*');
  const isAllowedOrigin = createOriginMatcher(options.allowedOrigins);

  const deny = (reply: FastifyReply, code: 'CROSS_SITE_BLOCKED' | 'HOST_NOT_ALLOWED', error: string) =>
    reply.code(403).send({ error, code });

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const host = request.headers.host;
    if (!host || !hosts.has(hostnameOf(host))) {
      request.log.warn({ host }, 'request rejected: host not allowed');
      return deny(reply, 'HOST_NOT_ALLOWED', HOST_BLOCKED_MESSAGE);
    }

    if (!STATE_CHANGING.has(request.method) || anyOrigin) {
      return undefined;
    }
    const origin = request.headers.origin;
    if (origin !== undefined) {
      // Allowed: an allow-listed (or equivalent loopback) origin, or a
      // same-origin request (origin host:port equals the validated Host).
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
      } catch {
        sameOrigin = false;
      }
      if (!isAllowedOrigin(origin) && !sameOrigin) {
        request.log.warn({ origin, url: request.url }, 'request rejected: cross-site origin');
        return deny(reply, 'CROSS_SITE_BLOCKED', CROSS_SITE_BLOCKED_MESSAGE);
      }
      return undefined;
    }
    // No Origin: block only when the browser explicitly marks it cross-site.
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      request.log.warn({ url: request.url }, 'request rejected: Sec-Fetch-Site cross-site');
      return deny(reply, 'CROSS_SITE_BLOCKED', CROSS_SITE_BLOCKED_MESSAGE);
    }
    return undefined;
  };
}
