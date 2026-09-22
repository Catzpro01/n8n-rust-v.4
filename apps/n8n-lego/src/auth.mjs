/**
 * Users and sessions.
 *
 * Same shape as n8n: an owner account, email + password login, and a session
 * cookie (`n8n-auth`) that the editor sends with every REST call. Passwords are
 * scrypt-hashed; the session token is HMAC-signed with the instance secret so a
 * restart does not log everybody out.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'n8n-auth';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === '') continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookieHeader(token, { secure }) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function createSession(user, config) {
  const token = signToken({ sub: user.id, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS }, config.secret);
  return { token, cookie: sessionCookieHeader(token, { secure: config.protocol === 'https' }) };
}

/** Resolves the signed-in user from the request cookie. */
export function currentUser(store, config, req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const payload = verifyToken(token, config.secret);
  if (!payload) return null;
  return store.users.get(payload.sub);
}

export function hasOwner(store) {
  return store.users.all().some((user) => user.role === 'global:owner');
}

export function ownerExists(store) {
  return hasOwner(store);
}

export function createOwner(store, { email, firstName, lastName, password }) {
  return store.users.insert({
    id: randomBytes(8).toString('hex'),
    email: String(email).toLowerCase(),
    firstName: firstName ?? '',
    lastName: lastName ?? '',
    role: 'global:owner',
    password: hashPassword(password),
    isPending: false,
    createdAt: new Date().toISOString(),
    settings: {},
  });
}

/**
 * The editor reads a lot of user fields; anything missing shows up as a broken
 * avatar or a blank "personal project" label, so the full shape is returned.
 */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    role: user.role ?? 'global:owner',
    isPending: user.isPending ?? false,
    isOwner: user.role === 'global:owner',
    settings: user.settings ?? {},
    disabled: false,
    mfaEnabled: false,
    personalizationAnswers: null,
    createdAt: user.createdAt ?? new Date().toISOString(),
    updatedAt: user.updatedAt ?? user.createdAt ?? new Date().toISOString(),
    signInType: 'email',
  };
}

export function authenticate(store, email, password) {
  const normalized = String(email ?? '').trim().toLowerCase();
  const user = store.users.find((candidate) => candidate.email === normalized);
  if (!user) return null;
  if (!verifyPassword(password, user.password)) return null;
  return user;
}
