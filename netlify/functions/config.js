// netlify/functions/config.js
//
// GET  /api/config  -> { propertyName, highFloorMin, highFloorMax, lowFloorMin, lowFloorMax }
// POST /api/config  body: same shape -> saves it, returns it
//
// Property ID, the YSuite API base URL, and the JWT are NOT handled here -
// they live only in Netlify environment variables (see availability.js),
// since they're sensitive / secret. Everything here is non-sensitive and
// editable at runtime without a redeploy.
//
// High/Low isn't something YSuite's occupancy API reports - it's a pricing
// tier from the Lease Rate Simulator side, applied here purely by floor
// number. highFloorMin/lowFloorMin are required for a range to apply; the
// matching Max is optional - leave it blank for "and above" (High) or
// "and below" (Low). E.g. High Floor 11 to (blank), Low Floor 0 to 10 means
// floors 0-10 are Low and floor 11+ is High.

const { getStore } = require('@netlify/blobs');

// No siteID/token by default: inside a normal Netlify Function (production,
// or `netlify dev` in most setups), Blobs context is auto-injected and
// getStore(name) alone is correct. Some local `netlify dev` runs load
// functions in an older "Lambda compatibility mode" where that
// auto-injection doesn't reach the function, even though netlify dev DOES
// still inject NETLIFY_SITE_ID/NETLIFY_BLOBS_TOKEN as plain env vars in
// that case (from the linked site's project settings) - so use those
// explicitly when present, and only then.
function store() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'simulator-settings', siteID, token });
  }
  return getStore('simulator-settings');
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function shapeConfig(saved) {
  return {
    propertyName: saved.propertyName || '',
    highFloorMin: toIntOrNull(saved.highFloorMin),
    highFloorMax: toIntOrNull(saved.highFloorMax),
    lowFloorMin: toIntOrNull(saved.lowFloorMin),
    lowFloorMax: toIntOrNull(saved.lowFloorMax)
  };
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';

  try {
    if (method === 'GET') {
      const saved = (await store().get('config', { type: 'json' })) || {};
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shapeConfig(saved))
      };
    }

    if (method === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (err) { body = {}; }
      const shaped = shapeConfig({ ...body, propertyName: String(body.propertyName || '').trim() });
      await store().setJSON('config', shaped);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shaped)
      };
    }

    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (err) {
    console.error(`config [${method}]: ${err.message}`);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to load/save config: ' + err.message })
    };
  }
};
