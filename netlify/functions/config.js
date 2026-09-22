// netlify/functions/config.js
//
// GET  /api/config  -> { propertyName }
// POST /api/config  body: { propertyName } -> saves it, returns { propertyName }
//
// Property ID, the YSuite API base URL, and the JWT are NOT handled here -
// they live only in Netlify environment variables (see availability.js),
// since they're sensitive / secret. Property name is the one field that's
// safe to store and edit at runtime, so it's kept in a small Blobs record
// rather than requiring a redeploy to change.

const { getStore } = require('@netlify/blobs');

function store() {
  return getStore({
    name: 'simulator-settings',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';

  try {
    if (method === 'GET') {
      const saved = (await store().get('config', { type: 'json' })) || {};
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyName: saved.propertyName || '' })
      };
    }

    if (method === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (err) { body = {}; }
      const propertyName = String(body.propertyName || '').trim();
      await store().setJSON('config', { propertyName });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyName })
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
