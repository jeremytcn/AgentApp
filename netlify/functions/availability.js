// netlify/functions/availability.js
//
// Single-property version of the Room Availability Dashboard's sync
// function, trimmed down for this standalone simulator - no multi-property
// switching, no admin/view-only session model. It's meant for Jeremy's own
// use, so there's no login of any kind here; if this ever needs to be
// shared more broadly, put it behind Netlify's site-wide password
// protection or a proper auth layer before that happens.
//
// GET  /api/availability
//   Returns the last-synced rooms from Blobs (no live API call), plus
//   syncedAt and nextSyncAllowedAt so the frontend's cooldown countdown is
//   correct even on a fresh page load.
//
// POST /api/availability
//   Calls YSuite's real check-room-occupancy endpoint, maps the response,
//   saves it to Blobs, and returns it. Rejected with 429 if synced less
//   than SYNC_COOLDOWN_MS ago.
//
// POST {YSUITE_API_BASE_URL}/room-types/check-room-occupancy
// Authorization: Bearer <YSUITE_JWT>
// Body: { "propertyId": "<YSUITE_PROPERTY_ID>" }
//
// All three of YSUITE_API_BASE_URL, YSUITE_JWT, and YSUITE_PROPERTY_ID are
// Netlify environment variables (see .env.example) - never stored in Blobs,
// never sent to the browser.

const { getStore } = require('@netlify/blobs');
const { mapRoom } = require('./lib/room-mapper');

const DEFAULT_API_BASE = 'https://middleware.ysuites.co';
const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

function store() {
  return getStore({
    name: 'simulator-settings',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

function apiBaseUrl() {
  const raw = (process.env.YSUITE_API_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/$/, '');
  return raw || DEFAULT_API_BASE;
}

// Non-secret connection info the frontend can safely display: the base URL
// and property ID aren't sensitive, and this only ever reports WHETHER the
// JWT is set - never its value.
function connectionInfo() {
  return {
    baseUrl: apiBaseUrl(),
    propertyId: (process.env.YSUITE_PROPERTY_ID || '').trim(),
    jwtConfigured: Boolean((process.env.YSUITE_JWT || '').trim())
  };
}

async function getSyncedRooms() {
  const saved = await store().get('synced-rooms', { type: 'json' });
  if (!saved) return { rooms: [], syncedAt: null };
  return {
    rooms: Array.isArray(saved.rooms) ? saved.rooms : [],
    syncedAt: saved.syncedAt || null
  };
}

async function saveSyncedRooms(rooms) {
  const syncedAt = new Date().toISOString();
  await store().setJSON('synced-rooms', { rooms, syncedAt });
  return syncedAt;
}

async function getSyncCooldown() {
  const saved = await store().get('sync-cooldown', { type: 'json' });
  return saved || { lastSyncAt: null };
}

async function recordSyncNow() {
  const lastSyncAt = Date.now();
  await store().setJSON('sync-cooldown', { lastSyncAt });
  return lastSyncAt + SYNC_COOLDOWN_MS;
}

// Logs the base URL and property ID being used (never the JWT itself)
// before every attempt, and logs YSuite's actual response body on any
// non-OK response - carried over from the main dashboard's availability.js,
// where this was added specifically because a bare failed status code
// alone couldn't distinguish a wrong JWT from a wrong property ID from a
// wrong base URL. Worth keeping (or extending, not removing) in any future
// changes here.
async function syncFromYSuite() {
  const jwt = (process.env.YSUITE_JWT || '').trim();
  const propertyId = (process.env.YSUITE_PROPERTY_ID || '').trim();
  const base = apiBaseUrl();
  console.log(`availability sync: base=${base} propertyId=${propertyId || '(none)'} jwtSet=${Boolean(jwt)}`);

  if (!jwt) throw new Error('No YSUITE_JWT configured in environment');
  if (!propertyId) throw new Error('No YSUITE_PROPERTY_ID configured in environment');

  const res = await fetch(`${base}/room-types/check-room-occupancy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ propertyId })
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 500); } catch (err) { /* ignore - detail stays blank */ }
    console.error(`availability sync: YSuite request failed - status=${res.status} body=${detail}`);
    throw new Error(`YSuite occupancy request failed: ${res.status}${detail ? ' - ' + detail : ''}`);
  }

  const raw = await res.json();
  console.log(`availability sync: succeeded, ${(raw.rooms || []).length} rooms returned`);
  return (raw.rooms || []).map(mapRoom);
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';

  try {
    if (method === 'GET') {
      const { rooms, syncedAt } = await getSyncedRooms();
      const cooldown = await getSyncCooldown();
      const nextSyncAllowedAt = cooldown.lastSyncAt ? cooldown.lastSyncAt + SYNC_COOLDOWN_MS : 0;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms, syncedAt, nextSyncAllowedAt, connection: connectionInfo() })
      };
    }

    if (method === 'POST') {
      const cooldown = await getSyncCooldown();
      const now = Date.now();
      if (cooldown.lastSyncAt && (now - cooldown.lastSyncAt) < SYNC_COOLDOWN_MS) {
        return {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Synced too recently - try again shortly.',
            nextSyncAllowedAt: cooldown.lastSyncAt + SYNC_COOLDOWN_MS
          })
        };
      }

      const rooms = await syncFromYSuite();
      const syncedAt = await saveSyncedRooms(rooms);
      const nextSyncAllowedAt = await recordSyncNow();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms, syncedAt, nextSyncAllowedAt, connection: connectionInfo() })
      };
    }

    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (err) {
    console.error(`availability [${method}]: ${err.message}`);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch availability: ' + err.message })
    };
  }
};
