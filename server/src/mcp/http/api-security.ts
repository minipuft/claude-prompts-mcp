// @lifecycle canonical - Guards authenticated HTTP authority and catalog routes.
import { createHash, timingSafeEqual } from 'node:crypto';

import type { Application, NextFunction, Request, Response } from 'express';

type Credential = 'read' | 'write';

interface ApiSecurityOptions {
  readToken?: string | null;
  writeToken?: string | null;
  allowedOrigins?: readonly string[];
  now?: () => number;
}

/**
 * Loopback origins only. A browser page served from anywhere else has no business driving a local
 * MCP server, and every non-browser client — which is most MCP clients — sends no Origin header at
 * all and is unaffected by this list.
 *
 * Restored 2026-08-31 while merging onto #249. This boundary was extracted with an empty default,
 * which silently dropped the defaults #249 established: every loopback browser origin began
 * answering 403. Caught by #249's own test (`allows a loopback Origin and echoes it instead of a
 * wildcard`) — the merge compiled and 13 of its 14 cases passed, and only that one case was
 * measuring the property that had been lost.
 */
const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://[::1]',
  'https://[::1]',
];

interface WindowState {
  count: number;
  resetsAt: number;
}

/** Security middleware registered before JSON parsing and all API routes. */
export class ApiSecurityBoundary {
  private readonly readToken: string | null;
  private readonly writeToken: string | null;
  private readonly allowedOrigins: Set<string>;
  private readonly now: () => number;
  private readonly windows = new Map<string, WindowState>();

  constructor(options: ApiSecurityOptions = {}) {
    this.readToken = normalizeToken(options.readToken);
    const writeToken = normalizeToken(options.writeToken);
    this.writeToken = writeToken === this.readToken ? null : writeToken;
    // Naming any origin REPLACES the loopback defaults rather than adding to them, so an
    // operator publishing under a real hostname states the whole policy in one place.
    this.allowedOrigins = new Set(
      (options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS).map((origin) =>
        origin.trim().toLowerCase().replace(/\/$/, '')
      )
    );
    this.now = options.now ?? Date.now;
  }

  register(app: Application): void {
    app.use((req, res, next) => this.guardOrigin(req, res, next));
    app.use('/api/v1/catalog/prompts', (req, res, next) =>
      this.guardCredential('read', req, res, next)
    );
    app.use('/api/v1/authority/prompts', (req, res, next) =>
      this.guardCredential(req.method === 'GET' ? 'read' : 'write', req, res, next)
    );
    app.use('/api/v1/tools', (req, res, next) => this.guardCredential('write', req, res, next));
  }

  /** Origin matches on scheme+host+port; the port-less defaults admit any port on loopback. */
  private isAllowedOrigin(origin: string): boolean {
    const normalized = origin.trim().toLowerCase().replace(/\/$/, '');
    if (this.allowedOrigins.has(normalized)) return true;
    // `http://localhost:3000` matches the `http://localhost` default.
    try {
      const url = new URL(normalized);
      return this.allowedOrigins.has(`${url.protocol}//${url.hostname}`);
    } catch {
      return false;
    }
  }

  private guardOrigin(req: Request, res: Response, next: NextFunction): void {
    const origin = req.header('origin');
    if (origin !== undefined && !this.isAllowedOrigin(origin)) {
      this.respond(res, req, 403, 'forbidden_origin', 'Origin is not allowed');
      return;
    }
    if (origin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  }

  private guardCredential(
    credential: Credential,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const expected = credential === 'read' ? this.readToken : this.writeToken;
    if (expected === null) {
      const message =
        credential === 'read'
          ? 'Catalog detail endpoint is unavailable'
          : 'Prompt mutation endpoint is unavailable';
      this.respond(res, req, 503, 'authority_unavailable', message);
      return;
    }
    if (!hasValidBearer(req, expected)) {
      this.respond(res, req, 401, 'unauthorized', 'Unauthorized');
      return;
    }
    const limit = credential === 'read' ? 120 : 30;
    const key = `${credential}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    if (!this.consume(key, limit, 60_000)) {
      res.setHeader('Retry-After', '60');
      this.respond(res, req, 429, 'rate_limited', 'Too many requests');
      return;
    }
    next();
  }

  private consume(key: string, limit: number, durationMs: number): boolean {
    const now = this.now();
    const current = this.windows.get(key);
    if (current === undefined || current.resetsAt <= now) {
      this.windows.set(key, { count: 1, resetsAt: now + durationMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  private respond(
    res: Response,
    req: Request,
    status: number,
    code: string,
    message: string
  ): void {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/v1/authority/')) {
      res.status(status).json({ error: { code, message } });
      return;
    }
    res.status(status).json({ error: message });
  }
}

function normalizeToken(value: string | null | undefined): string | null {
  const token = value?.trim();
  return token === undefined || token.length === 0 ? null : token;
}

function hasValidBearer(req: Request, expected: string): boolean {
  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ') !== true) return false;
  const candidate = authorization.slice('Bearer '.length).trim();
  if (candidate.length === 0) return false;
  const expectedDigest = createHash('sha256').update(expected).digest();
  const candidateDigest = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}
