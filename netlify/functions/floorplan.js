// netlify/functions/floorplan.js
//
// Single-property version of the main Room Availability Dashboard's
// floorplan-hotspots.js + floorplan-facilities.js, combined into one file
// since there's no per-property scoping to keep them apart here - both are
// small, related, and usually needed together (see PROJECT_HANDOFF.md /
// this project's own README for why the main dashboard split them: purely
// to keep each property's data independent, which doesn't apply here).
//
// No login of any kind here, same as availability.js and config.js - if
// this ever needs to be shared more broadly, put it behind a real auth
// layer first. The main dashboard's equivalent endpoints gate writes with
// requireAdmin(event, property, ['floorplan']) - when auth exists here,
// mirror that same call shape on the POST branch below rather than
// inventing a different pattern.
//
// GET /api/floorplan
//   -> { hotspots: { "<floor>": { "<room or facility:id>": {points:[{x,y}]} } },
//        facilities: [ {id, name, scope, deleted?}, ... ],
//        floorGroups: { "<floor>": ["<floor>", ...] } }
//
// POST /api/floorplan   body: { action, ... }
//   action: "saveHotspots"
//     Single-floor form:  { floor, hotspots: {...}, changedKey? }
//     changedKey (optional) names the one room/facility key that was just
//     added or updated in `hotspots` - when given, and this floor shares a
//     layout with others (see floorplan-image.js, which records that
//     grouping whenever an image is uploaded to more than one floor), that
//     one shape is automatically copied - remapped to each sibling floor's
//     own room name - onto every sibling too. This is what makes tracing a
//     room once on any floor in a shared-layout group apply to the whole
//     group without re-tracing each floor by hand.
//     Batch form (floors sharing one image, written together so they can't
//     race each other): { floors: { "5": {...}, "6": {...} } }
//     Either form replaces the given floor(s) wholesale. An empty/omitted
//     hotspots object for a floor clears its boxes. The batch form does
//     NOT auto-propagate to siblings - it's meant for writing several
//     floors' already-final data at once, not for the single-shape editing
//     flow.
//   action: "saveFacility"   { id?, name, scope }
//     No id -> creates a new facility (id generated from name, de-duped
//     against every existing id including tombstoned ones). id given and
//     already exists -> renames that facility in place. id given but
//     doesn't exist yet -> creates a new facility using that exact id
//     rather than generating one - lets a seed/import script preserve
//     original ids from extracted data, so hotspot entries elsewhere
//     referencing "facility:<that id>" stay correctly linked.
//   action: "deleteFacility" { id, name?, scope? }
//     Soft-delete (tombstone) so the id can't silently get reused - same
//     reasoning as the main dashboard. If the id was never actually
//     stored (true for the built-in "Lift" default until it's been
//     touched), this records a tombstone entry instead of erroring.
//
// Each room's hotspot shape is an arbitrary polygon (not just a
// rectangle) - a list of points, x/y as percentages (0-100) of the floor
// plan image's rendered box, not raw pixels. Requires at least 3 valid
// points per shape; anything with fewer is dropped rather than stored
// malformed.

const { getStore } = require('@netlify/blobs');
const { requireSession, hasRole } = require('./lib/auth');

// Same store-access pattern as availability.js/config.js in this project -
// see those files for why the siteID/token fallback exists.
function store() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'simulator-settings', siteID, token });
  }
  return getStore('simulator-settings');
}

function slugify(name) {
  const base = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  return base || 'facility';
}

function cleanHotspotsForFloor(rawObj) {
  const cleaned = {};
  const incoming = (rawObj && typeof rawObj === 'object') ? rawObj : {};
  for (const key in incoming) {
    const box = incoming[key];
    if (box && Array.isArray(box.points)) {
      const points = box.points
        .filter((p) => p && isFinite(p.x) && isFinite(p.y))
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      if (points.length >= 3) cleaned[key] = { points };
    }
  }
  return cleaned;
}

async function getHotspots() {
  return (await store().get('floorplan-hotspots', { type: 'json' })) || {};
}

async function getFacilities() {
  return (await store().get('floorplan-facilities', { type: 'json' })) || [];
}

async function getFloorGroups() {
  return (await store().get('floorplan-floor-groups', { type: 'json' })) || {};
}

// The sibling floors (as strings, excluding the floor itself) that share
// the exact same physical layout as this one - i.e. whichever floors were
// uploaded together as one image in floorplan-image.js.
function siblingsOf(floor, groups) {
  const group = groups[String(floor)];
  if (!Array.isArray(group)) return [];
  return group.map(String).filter((f) => f !== String(floor));
}

// A room's hotspot key is its exact name (e.g. "09.01 YSMG" or "17.12.1"),
// which embeds the floor number as its leading segment - remapping it to
// another floor means swapping just that segment, 0-padded to 2 digits to
// match the convention seen in every real room name so far. A facility key
// ("facility:<id>") isn't floor-specific, so it's returned unchanged.
function remapKeyToFloor(key, targetFloor) {
  if (key.indexOf('facility:') === 0) return key;
  const dotIdx = key.indexOf('.');
  if (dotIdx === -1) return key;
  const pad = String(targetFloor).length < 2 ? '0' + targetFloor : String(targetFloor);
  return pad + key.slice(dotIdx);
}

async function saveHotspots(body) {
  const allFloors = await getHotspots();
  const isBatch = body.floors && typeof body.floors === 'object';
  const singleFloor = body.floor != null ? String(body.floor).trim() : '';

  if (!isBatch && !singleFloor) {
    throw Object.assign(new Error('floor (or floors) is required'), { statusCode: 400 });
  }

  if (isBatch) {
    for (const floorKey in body.floors) {
      const floor = String(floorKey).trim();
      if (!floor) continue;
      const cleaned = cleanHotspotsForFloor(body.floors[floorKey]);
      if (Object.keys(cleaned).length) allFloors[floor] = cleaned;
      else delete allFloors[floor];
    }
  } else {
    const cleaned = cleanHotspotsForFloor(body.hotspots);
    if (Object.keys(cleaned).length) allFloors[singleFloor] = cleaned;
    else delete allFloors[singleFloor];

    // Auto-propagate: if this save is for one specific just-finished shape
    // (the click-to-place editor always sends this) and the floor it's on
    // shares a layout with other floors, copy that one shape - remapped to
    // each sibling's own room name - into every sibling floor's hotspot
    // map. Only the one changed key is touched on each sibling; anything
    // else already traced there is left alone. This only fires on a save
    // that actually produced a stored shape - a cleared/invalid shape
    // (fewer than 3 points) doesn't propagate a deletion to siblings.
    if (body.changedKey) {
      const changedKey = String(body.changedKey);
      const savedShape = allFloors[singleFloor] && allFloors[singleFloor][changedKey];
      if (savedShape) {
        const groups = await getFloorGroups();
        siblingsOf(singleFloor, groups).forEach((sibling) => {
          const remappedKey = remapKeyToFloor(changedKey, sibling);
          if (!allFloors[sibling]) allFloors[sibling] = {};
          allFloors[sibling][remappedKey] = { points: savedShape.points.slice() };
        });
      }
    }
  }

  await store().setJSON('floorplan-hotspots', allFloors);
  return allFloors;
}

async function saveFacility(body) {
  const name = (body.name || '').trim();
  const scope = (body.scope || '').trim() || 'global';
  if (!name) throw Object.assign(new Error('name is required'), { statusCode: 400 });

  const facilities = await getFacilities();
  const givenId = (body.id || '').trim();

  if (givenId) {
    const idx = facilities.findIndex((f) => f.id === givenId);
    if (idx !== -1) {
      // Existing id -> rename in place.
      facilities[idx] = Object.assign({}, facilities[idx], { name });
    } else {
      // id given but doesn't exist yet -> create with this exact id,
      // rather than treating it as an error. This is what lets a seed/
      // import script preserve original facility ids from extracted
      // data (so hotspot entries referencing "facility:<that id>" stay
      // correctly linked), rather than every import generating a fresh,
      // different id.
      facilities.push({ id: givenId, name, scope });
    }
  } else {
    // No id at all -> auto-generate (the normal "add facility" flow).
    let id = slugify(name);
    const existingIds = facilities.map((f) => f.id);
    if (existingIds.indexOf(id) !== -1) id = id + '-' + Date.now();
    facilities.push({ id, name, scope });
  }

  await store().setJSON('floorplan-facilities', facilities);
  return facilities;
}

async function deleteFacility(body) {
  const id = (body.id || '').trim();
  if (!id) throw Object.assign(new Error('id is required'), { statusCode: 400 });

  const facilities = await getFacilities();
  const idx = facilities.findIndex((f) => f.id === id);
  if (idx !== -1) {
    facilities[idx] = Object.assign({}, facilities[idx], { deleted: true });
  } else {
    facilities.push({ id, name: body.name || id, scope: body.scope || 'global', deleted: true });
  }

  await store().setJSON('floorplan-facilities', facilities);
  return facilities;
}

exports.handler = async function handler(event) {
  const method = event.httpMethod || 'GET';

  const session = await requireSession(event);
  if (!session) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not logged in.' }) };
  }

  try {
    if (method === 'GET') {
      // Internal and Agent don't get the Floor Plan tab in the UI, but
      // Admin does, and reading hotspot/facility data isn't itself a
      // write - any valid session can read this.
      const [hotspots, facilities, floorGroups] = await Promise.all([getHotspots(), getFacilities(), getFloorGroups()]);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotspots, facilities, floorGroups })
      };
    }

    if (method === 'POST') {
      // Every POST action here edits the floor plan mapping - admin only.
      if (!hasRole(session, ['admin'])) {
        return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin access required.' }) };
      }

      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (err) { body = {}; }

      if (body.action === 'saveHotspots') {
        const hotspots = await saveHotspots(body);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, hotspots }) };
      }
      if (body.action === 'saveFacility') {
        const facilities = await saveFacility(body);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, facilities }) };
      }
      if (body.action === 'deleteFacility') {
        const facilities = await deleteFacility(body);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, facilities }) };
      }
      if (body.action === 'resetAll') {
        // Full wipe, no backup - used when Property Information's
        // Property ID changes (see rates.js and the frontend's confirm
        // flow), since a different property has an entirely different
        // physical layout and every existing hotspot/facility/grouping
        // here is meaningless for it.
        await Promise.all([
          store().setJSON('floorplan-hotspots', {}),
          store().setJSON('floorplan-facilities', []),
          store().setJSON('floorplan-floor-groups', {})
        ]);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, hotspots: {}, facilities: [], floorGroups: {} }) };
      }

      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unknown or missing action' }) };
    }

    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error(`floorplan [${method}]: ${err.message}`);
    return {
      statusCode: err.statusCode || 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
