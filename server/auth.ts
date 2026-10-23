import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DB } from './db.js';
import type { User } from '../shared/types.js';
import { z } from 'zod';

const scrypt = promisify(scryptCallback);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64) as Buffer).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, key] = encoded.split(':');
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
declare module 'fastify' { interface FastifyRequest { user: User } }
const credentials = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(12).max(256) });

export function registerAuth(app: FastifyInstance, db: DB, dataDir: string, secureCookie: boolean) {
  const setupPath = join(dataDir, 'bootstrap-code');
  const hasOwner = () => !!db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!hasOwner() && !existsSync(setupPath)) writeFileSync(setupPath, randomBytes(24).toString('base64url'), { mode: 0o600, flag: 'wx' });
  const createSession = (userId: string) => {
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), userId, Date.now() + 90 * 86400_000);
    return token;
  };
  function sessionReply(reply: FastifyReply, user: User, token: string, native = false) {
    reply.setCookie('kathrine', token, { httpOnly: true, secure: secureCookie, sameSite: 'strict', path: '/', maxAge: 90 * 86400 });
    return { user, ...(native ? { token } : {}) };
  }
  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const token = bearer || req.cookies.kathrine;
    const row = token && db.prepare('SELECT u.id,u.username,u.admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(hash(token), Date.now()) as User | undefined;
    if (!row) return reply.code(401).send({ error: 'Sign in to continue.' });
    req.user = { ...row, admin: !!row.admin };
  };
  const admin = async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (!reply.sent && !req.user.admin) return reply.code(403).send({ error: 'Administrator access is required.' });
  };
  app.addHook('onRequest', async (req, reply) => {
    // Cookie sessions are same-origin only. Native clients authenticate with bearer headers.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin: URL;
      try { origin = new URL(req.headers.origin); }
      catch { return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' }); }
      const protocol = secureCookie ? 'https:' : req.protocol + ':';
      if (origin.host !== req.headers.host || origin.protocol !== protocol) return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
    }
  });
  app.get('/api/auth/status', async () => ({ setupRequired: !hasOwner() }));
  app.post('/api/auth/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (hasOwner()) return reply.code(409).send({ error: 'This server already has an owner.' });
    const body = credentials.extend({ code: z.string(), native: z.boolean().optional() }).parse(req.body);
    const expected = readFileSync(setupPath, 'utf8').trim();
    if (hash(body.code) !== hash(expected)) return reply.code(403).send({ error: 'The setup code is incorrect. Read bootstrap-code in the server data directory.' });
    const encoded = await passwordHash(body.password);
    // Recheck after hashing, which yields to other requests.
    if (hasOwner()) return reply.code(409).send({ error: 'This server already has an owner.' });
    const user = { id: randomUUID(), username: body.username, admin: true };
    db.prepare('INSERT INTO users VALUES(?,?,?,1)').run(user.id, user.username, encoded);
    unlinkSync(setupPath);
    return sessionReply(reply, user, createSession(user.id), body.native);
  });
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ username: z.string().max(64), password: z.string().max(256), native: z.boolean().optional() }).parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(body.username) as (User & { password: string }) | undefined;
    const valid = await verifyPassword(body.password, row?.password || '00000000000000000000000000000000:' + '00'.repeat(64));
    if (!row || !valid) return reply.code(401).send({ error: 'Incorrect username or password.' });
    return sessionReply(reply, { id: row.id, username: row.username, admin: !!row.admin }, createSession(row.id), body.native);
  });
  app.get('/api/auth/me', { preHandler: authenticate }, async req => ({ user: req.user }));
  app.post('/api/auth/logout', { preHandler: authenticate }, async (req, reply) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || req.cookies.kathrine || '';
    db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
    reply.clearCookie('kathrine', { path: '/' });
    return { ok: true };
  });
  app.get('/api/users', { preHandler: admin }, async () => db.prepare('SELECT id,username,admin FROM users').all());
  app.post('/api/users', { preHandler: admin }, async (req, reply) => {
    const body = credentials.parse(req.body);
    const user = { id: randomUUID(), username: body.username, admin: false };
    try { db.prepare('INSERT INTO users VALUES(?,?,?,0)').run(user.id, user.username, await passwordHash(body.password)); }
    catch { return reply.code(409).send({ error: 'That username already exists.' }); }
    return user;
  });
  app.post('/api/pairing', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
    const { device } = z.object({ device: z.string().max(100) }).parse(req.body);
    db.prepare('DELETE FROM pairing WHERE expires<?').run(Date.now());
    const code = randomBytes(5).toString('hex').toUpperCase();
    const pollToken = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO pairing VALUES(?,?,?,NULL,?)').run(code, device, hash(pollToken), Date.now() + 600_000);
    return { code, pollToken, expiresIn: 600 };
  });
  app.post('/api/pairing/approve', { preHandler: authenticate }, async (req, reply) => {
    const { code } = z.object({ code: z.string().max(20) }).parse(req.body);
    const result = db.prepare('UPDATE pairing SET user_id=? WHERE code=? AND expires>? AND user_id IS NULL').run(req.user.id, code.toUpperCase().replace(/\s|-/g, ''), Date.now());
    if (!result.changes) return reply.code(404).send({ error: 'Pairing code is invalid or expired.' });
    return { ok: true };
  });
  app.post('/api/pairing/poll', async (req, reply) => {
    const { code, pollToken } = z.object({ code: z.string(), pollToken: z.string() }).parse(req.body);
    const row = db.prepare('SELECT user_id FROM pairing WHERE code=? AND poll_hash=? AND expires>?').get(code, hash(pollToken), Date.now()) as { user_id: string | null } | undefined;
    if (!row) return reply.code(410).send({ error: 'Pairing expired.' });
    if (!row.user_id) return { pending: true };
    db.prepare('DELETE FROM pairing WHERE code=?').run(code);
    return { token: createSession(row.user_id) };
  });
  return { authenticate, admin };
}
