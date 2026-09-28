// netlify/functions/rates-media.js
//
// GET  /api/rates-media?id=<assetId>   -> raw bytes for that asset
// POST /api/rates-media
//   body: { imageBase64 or fileBase64, contentType, fileName?, fileSize? }
//   Stores one image or one video file as a Blobs asset and returns
//   { id }. The caller (Setup > Room Information) is responsible for
//   putting that id into rates.js's property.roomMedia entry - this
//   endpoint only knows about the bytes, not which room they belong to.
//
// A video can also be a plain link ({ type: 'link', url, caption }) with
// no file at all - that never touches this endpoint, it's stored directly
// in rates.js's roomMedia as a URL string.
//
// This replaces the prototype's approach of storing every image/video as
// a base64 data URI directly inside the localStorage-persisted state
// (flagged in HANDOVER.md §5 as needing real asset storage). Same Blobs
// store as everything else in this project ('simulator-settings'), same
// no-auth posture as every other function here.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { requireSession, hasRole } = require('./lib/auth');

function store() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'simulator-settings', siteID, token });
  }
  return getStore('simulator-settings');
}

function newAssetId() {
  return 'asset_' + crypto.randomBytes(8).toString('hex');
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';

  // Loaded directly as <img>/<video> src in the frontend, which can't
  // attach an Authorization header - left unauthenticated deliberately,
  // same reasoning as floorplan-image.js's GET.
  if (method === 'GET') {
    const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
    if (!id) return { statusCode: 400, body: 'Missing id parameter' };
    try {
      const result = await store().getWithMetadata(`rate-media-${id}`, { type: 'arrayBuffer' });
      if (!result || !result.data) return { statusCode: 404, body: 'No asset with this id' };
      const contentType = (result.metadata && result.metadata.contentType) || 'application/octet-stream';
      return {
        statusCode: 200,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
        body: Buffer.from(result.data).toString('base64'),
        isBase64Encoded: true
      };
    } catch (err) {
      console.error('rates-media GET error:', err);
      return { statusCode: 404, body: 'No asset with this id' };
    }
  }

  if (method === 'POST') {
    const session = await requireSession(event);
    if (!hasRole(session, ['admin'])) {
      return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin access required.' }) };
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (err) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    if (body.action === 'resetAll') {
      // Full wipe, no backup - deletes every stored room media asset
      // outright. Used when Property Information's Property ID changes:
      // once property.roomMedia itself gets cleared (rates.js), these
      // bytes are unreachable from anywhere anyway - this just makes sure
      // they're actually gone rather than sitting there unreferenced.
      try {
        const { blobs } = await store().list({ prefix: 'rate-media-' });
        await Promise.all((blobs || []).map((b) => store().delete(b.key)));
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    const base64 = body.imageBase64 || body.fileBase64;
    if (!base64) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'imageBase64 or fileBase64 is required' }) };
    }
    try {
      const buffer = Buffer.from(base64, 'base64');
      const id = newAssetId();
      const metadata = { contentType: body.contentType || 'application/octet-stream' };
      await store().set(`rate-media-${id}`, buffer, { metadata });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, size: buffer.length })
      };
    } catch (err) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
