// netlify/functions/rates.js
//
// GET  /api/rates  -> { property, list, activeIndex, _version, lock }
//   lock is null, or { sessionId, holderLabel, expiresAt } if someone is
//   actively editing (see below).
//
// POST /api/rates   body: { action, ... }
//   action: "save"   { config: {property, list, activeIndex}, expectedVersion, sessionId, holderLabel? }
//     Real conflict handling, not last-write-wins: expectedVersion must
//     match the config's current _version (the value your last GET or
//     save returned). If someone else saved in between, this is rejected
//     with 409 and the CURRENT config/version/lock, rather than silently
//     overwriting their change - the client re-reads that response and
//     decides how to reconcile (reload and redo the edit, most likely,
//     since there's no auto-merge here). On success, _version increments
//     by 1 and the lock is set/renewed to this session.
//   action: "heartbeat"   { sessionId, holderLabel? }
//     Renews the soft edit-lock for this session (used while the Setup
//     Console is open, every ~10s) if no OTHER session currently holds an
//     unexpired one. If another session does hold it, this does NOT steal
//     it - it just returns that lock's info so the caller can show a
//     "so-and-so is currently editing this" banner. This is advisory only
//     - it doesn't block a save, which is protected by expectedVersion
//     instead. Given only a handful of people ever have edit access here,
//     a hard mutex would be worse UX than a warning + a real version
//     check that can never silently lose someone's change.
//   action: "release"   { sessionId }
//     Clears the lock if this session currently holds it (best-effort,
//     called when leaving Setup). Locks also just expire on their own
//     (LOCK_TTL_MS) if a tab is closed without releasing, so this is a
//     courtesy, not the only way a lock goes away.
//
// This is the server-side replacement for the Lease Rate Simulator
// prototype's localStorage key 'leaseSim.rateCards.v1' - see HANDOVER.md
// for the full data model and calculation-engine spec this was built
// from. Two shape changes from the prototype, both deliberate:
//
// 1. property.propertyName is new - the merged Setup Console's Property
//    Information tab now also owns the display name.
// 2. property.roomMedia no longer holds inline base64 image/video data.
//    Each entry is now { images: [assetId, ...], videos: [{assetId, type,
//    caption, name?, size?} | {type:'link', url, caption}] } - the actual
//    bytes live in Blobs via rates-media.js, referenced by assetId.
//
// No login here, same as every other function in this project.

const { getStore } = require('@netlify/blobs');
const { requireSession, hasRole } = require('./lib/auth');

const LOCK_TTL_MS = 30 * 1000;

function store() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'simulator-settings', siteID, token });
  }
  return getStore('simulator-settings');
}

function defaultConfig() {
  return {
    property: {
      propertyName: '',
      propertyId: '',
      lowFloorMin: 0, lowFloorMax: 0,
      highFloorMin: 0, highFloorMax: 0,
      securityDeposit: 0, advanceRent: 0, bond: 0,
      currency: 'SGD',
      rateType: 'Monthly',
      roomShortNames: {},
      roomMedia: {}
    },
    list: [],
    activeIndex: 0,
    _version: 0
  };
}

async function getConfig() {
  const saved = await store().get('rate-config', { type: 'json' });
  return saved || defaultConfig();
}

async function getActiveLock() {
  const lock = await store().get('rate-config-lock', { type: 'json' });
  if (!lock || !lock.expiresAt || lock.expiresAt < Date.now()) return null;
  return lock;
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';

  const session = await requireSession(event);
  if (!session) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not logged in.' }) };
  }

  try {
    if (method === 'GET') {
      // Every role reads rate/promotion data - Rates is a tab all three
      // roles get, and Availability needs the property config too.
      const [config, lock] = await Promise.all([getConfig(), getActiveLock()]);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, config, { lock: lock }))
      };
    }

    if (method === 'POST') {
      // Every write here is a Setup Console operation (editing the
      // property, a rate card, or a promotion, or the presence-lock that
      // goes with editing them) - admin only.
      if (!hasRole(session, ['admin'])) {
        return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin access required.' }) };
      }

      let body;
      try { body = JSON.parse(event.body || '{}'); } catch (err) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
      }

      if (body.action === 'heartbeat') {
        const sessionId = String(body.sessionId || '');
        if (!sessionId) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'sessionId is required' }) };
        const current = await getActiveLock();
        var lock;
        if (!current || current.sessionId === sessionId) {
          lock = { sessionId: sessionId, holderLabel: body.holderLabel || 'Someone', expiresAt: Date.now() + LOCK_TTL_MS };
          await store().setJSON('rate-config-lock', lock);
        } else {
          lock = current; // someone else holds it - don't steal, just report it
        }
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lock: lock }) };
      }

      if (body.action === 'release') {
        const sessionId = String(body.sessionId || '');
        const current = await getActiveLock();
        if (current && current.sessionId === sessionId) {
          await store().setJSON('rate-config-lock', null);
        }
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lock: null }) };
      }

      if (body.action === 'save') {
        const incoming = body.config;
        if (!incoming || typeof incoming !== 'object' || !incoming.property || !Array.isArray(incoming.list)) {
          return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'config must be the full { property, list, activeIndex }' }) };
        }
        const sessionId = String(body.sessionId || '');
        const current = await getConfig();
        const expectedVersion = Number(body.expectedVersion);

        if (expectedVersion !== (current._version || 0)) {
          const lock = await getActiveLock();
          return {
            statusCode: 409,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ error: 'Someone else saved changes since you loaded this page. Reload to see the current version before saving again.' }, current, { lock: lock }))
          };
        }

        const saved = Object.assign({}, incoming, { _version: (current._version || 0) + 1 });
        await store().setJSON('rate-config', saved);
        let lock = null;
        if (sessionId) {
          lock = { sessionId: sessionId, holderLabel: body.holderLabel || 'Someone', expiresAt: Date.now() + LOCK_TTL_MS };
          await store().setJSON('rate-config-lock', lock);
        } else {
          lock = await getActiveLock();
        }
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, saved, { lock: lock }))
        };
      }

      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unknown or missing action' }) };
    }

    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error(`rates [${method}]: ${err.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server error: ' + err.message })
    };
  }
};
