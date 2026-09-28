// netlify/functions/floorplan-image.js
//
// Serves and stores floor plan images directly in Netlify Blobs - the
// only image source for this project (unlike the main Room Availability
// Dashboard, which primarily uses static files committed to the repo and
// only has this Blobs path as a rarely-used fallback). That static-asset/
// manifest.json system was deliberately skipped here as unnecessary
// complexity for a single-property tool - see the handover notes this
// was built from for the reasoning. No login here, same as every other
// function in this project - see availability.js.
//
// GET  /api/floorplan-image?floor=5   -> raw image bytes for that floor
// POST /api/floorplan-image
//   body: { floors: ["5","6"], imageBase64, contentType }
//   Accepts an array of floor numbers (as strings) rather than just one,
//   since one floor plan image commonly covers several floors (e.g. a
//   single image for floors 9-15) - saving it once per floor number keeps
//   GET simple (one floor number in, one image out) rather than needing
//   every reader to resolve which floors share which image.
//   When more than one floor is given, also records that grouping (Blobs
//   key 'floorplan-floor-groups') so floorplan.js can auto-propagate a
//   hotspot traced on one of these floors to all the others sharing it.

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

// Compares the JUST-UPLOADED image's bytes against every OTHER currently-
// stored floor image (in parallel, not sequentially) and folds any exact
// byte-for-byte match into the same group - not just the floors given in
// this one upload call, so the same file uploaded to each floor
// separately (one at a time) still ends up correctly grouped once every
// floor sharing it has been uploaded at least once. Deliberately does NOT
// re-compare every existing floor against every OTHER existing floor (an
// O(n^2) full rescan) on every single upload - that used to run here and
// was slow enough, as a property accumulates more floors, to occasionally
// make a routine upload look like a failed request even though the image
// itself had already saved successfully. Comparing the new upload against
// what already exists is sufficient: any floor that ever gets uploaded
// will get correctly grouped against everything already there at that
// point, and by transitivity the group stays correct as more floors are
// added over time.
async function detectSharedGroup(floors, buffer) {
  const { blobs } = await store().list({ prefix: 'floor-image-' });
  const otherKeys = (blobs || [])
    .map((b) => b.key.slice('floor-image-'.length))
    .filter((f) => !floors.includes(f));

  const matches = await Promise.all(otherKeys.map(async (f) => {
    const data = await store().get(`floor-image-${f}`, { type: 'arrayBuffer' });
    return (data && Buffer.from(data).equals(buffer)) ? f : null;
  }));

  const matchedFloors = new Set(floors);
  matches.forEach((f) => { if (f) matchedFloors.add(f); });

  if (matchedFloors.size > 1) {
    const groups = (await store().get('floorplan-floor-groups', { type: 'json' })) || {};
    const groupArray = Array.from(matchedFloors);
    groupArray.forEach((f) => { groups[f] = groupArray.slice(); });
    await store().setJSON('floorplan-floor-groups', groups);
  }
  return Array.from(matchedFloors);
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';
  const floor = (event.queryStringParameters && event.queryStringParameters.floor) || '';

  // GET is loaded directly as an <img src="..."> in the frontend, which
  // can't attach an Authorization header - left unauthenticated
  // deliberately (a floor plan photo isn't sensitive the way pricing or
  // credentials are), while every write below still requires an admin
  // session.
  if (method === 'GET') {
    if (!floor) {
      return { statusCode: 400, body: 'Missing floor parameter' };
    }
    try {
      const result = await store().getWithMetadata(`floor-image-${floor}`, { type: 'arrayBuffer' });
      if (!result || !result.data) {
        return { statusCode: 404, body: 'No image set for this floor' };
      }
      const contentType = (result.metadata && result.metadata.contentType) || 'image/png';
      return {
        statusCode: 200,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300' },
        body: Buffer.from(result.data).toString('base64'),
        isBase64Encoded: true
      };
    } catch (err) {
      // Logged, not just swallowed, so a real config/connection problem is
      // visible in the terminal (netlify dev) or function logs (deployed) -
      // the response itself stays a clean 404 for the <img> tag either way.
      console.error('floorplan-image GET error:', err);
      return { statusCode: 404, body: 'No image set for this floor' };
    }
  }

  if (method === 'POST') {
    const session = await requireSession(event);
    if (!hasRole(session, ['admin'])) {
      return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin access required.' }) };
    }
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    if (body.action === 'resetAll') {
      // Full wipe, no backup - deletes every stored floor plan image
      // outright (not just clearing references to them), since a new
      // property's floors don't correspond to any of these images at all.
      try {
        const { blobs } = await store().list({ prefix: 'floor-image-' });
        await Promise.all((blobs || []).map((b) => store().delete(b.key)));
        await store().setJSON('floorplan-floor-groups', {});
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      } catch (err) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
      }
    }

    const floors = Array.isArray(body.floors) ? body.floors.map((f) => String(f).trim()).filter(Boolean) : [];
    if (!floors.length || !body.imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'floors (array) and imageBase64 are required' }) };
    }

    try {
      const buffer = Buffer.from(body.imageBase64, 'base64');
      const metadata = { contentType: body.contentType || 'image/png' };
      await Promise.all(floors.map((f) => store().set(`floor-image-${f}`, buffer, { metadata })));

      // Fully automatic, no separate "detect" step for anyone to remember
      // to click - see detectSharedGroup above for why this compares only
      // against what's already stored rather than re-checking everything
      // against everything else.
      const groupedWith = await detectSharedGroup(floors, buffer);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, floors, groupedWith })
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server error: ' + err.message })
      };
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
