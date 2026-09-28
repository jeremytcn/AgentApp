// netlify/functions/lib/auth.js
//
// Shared authentication/authorization helpers used by every function.
// Three roles:
//   admin    - full access, the only role allowed to write/modify anything
//   internal - view-only, every frontend tab, no Setup Console
//   agent    - view-only, Availability + Rates tabs only, no Setup Console
//
// Admin and Internal log in with a username + password. Agent logs in
// with a username only (no password check at all) - a deliberately
// weaker login for a deliberately narrow, view-only role.
//
// Passwords are never stored in plain text - salted and hashed with
// Node's built-in crypto.scrypt, no external dependency needed for this.
//
// Sessions are opaque random tokens, stored server-side (in the same
// Blobs store everything else here uses) mapped to { username, role,
// expiresAt }. The client sends the token back on every request via an
// Authorization: Bearer <token> header; requireSession() below is what
// every other function calls to check it.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'simulator-settings';
function store() { return getStore(STORE_NAME); }

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ROLES = ['admin', 'internal', 'agent'];

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  // Constant-time compare - a plain === here would leak timing
  // information about how many leading characters matched.
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getUsers() {
  return (await store().get('users', { type: 'json' })) || [];
}

async function saveUsers(users) {
  await store().setJSON('users', users);
}

async function getSessions() {
  return (await store().get('sessions', { type: 'json' })) || {};
}

async function saveSessions(sessions) {
  await store().setJSON('sessions', sessions);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(username, role) {
  const sessions = await getSessions();
  // Opportunistic cleanup of anything already expired, so this store
  // doesn't grow unbounded over time.
  const now = Date.now();
  Object.keys(sessions).forEach((t) => { if (sessions[t].expiresAt < now) delete sessions[t]; });
  const token = newToken();
  sessions[token] = { username, role, expiresAt: now + SESSION_TTL_MS };
  await saveSessions(sessions);
  return { token, expiresAt: sessions[token].expiresAt };
}

async function destroySession(token) {
  if (!token) return;
  const sessions = await getSessions();
  delete sessions[token];
  await saveSessions(sessions);
}

function extractToken(event) {
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

// Validates the request's bearer token against stored sessions. Returns
// { username, role } on success, or null if missing/invalid/expired -
// every function should treat null as "reject with 401", never as
// "proceed anyway".
async function requireSession(event) {
  const token = extractToken(event);
  if (!token) return null;
  const sessions = await getSessions();
  const session = sessions[token];
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    delete sessions[token];
    await saveSessions(sessions);
    return null;
  }
  return { username: session.username, role: session.role };
}

// True if session.role is one of the allowed roles - use this to gate
// write/modify actions to admin-only, e.g.
// if (!hasRole(session, ['admin'])) return { statusCode: 403, ... }
function hasRole(session, allowedRoles) {
  return !!(session && allowedRoles.indexOf(session.role) !== -1);
}

module.exports = {
  ROLES,
  hashPassword,
  verifyPassword,
  getUsers,
  saveUsers,
  createSession,
  destroySession,
  requireSession,
  hasRole,
  store
};
