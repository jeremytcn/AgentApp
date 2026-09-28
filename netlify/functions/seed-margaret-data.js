// seed-margaret-data.js
//
// One-time import script - loads the already-extracted Margaret floor
// plan data (hotspot coordinates, facility types, floor images) into a
// deployed Availability Simulator instance, via its own /api/floorplan
// and /api/floorplan-image endpoints. Run this once after deploying the
// Floor Plan feature, so hotspots don't need to be re-traced by hand.
//
// USAGE:
//   node seed-margaret-data.js <site-url>
//   e.g. node seed-margaret-data.js https://your-simulator.netlify.app
//
// Expects three things sitting next to this script (or edit the paths
// below to point elsewhere):
//   ./margaret-hotspots.json       - the Margaret_Hotspot_Blob file you extracted
//   ./margaret-facilities.json     - the Facilities_Hotspot file you extracted
//   ./margaret-images/             - a folder containing the 17 extracted floor
//                                     image files, named exactly
//                                     "y-suites-on-margaret_floor-<N>"
//                                     (the same names they came out of Blobs
//                                     with - no extension needed, this script
//                                     detects PNG/JPEG from the file's own
//                                     bytes rather than relying on a filename
//                                     extension)
//
// This talks to your deployed site's real API - it's not local-only. Run
// it once; running it again is safe (every write here overwrites by key,
// nothing accumulates or duplicates), but there's no reason to run it
// more than once for the same data.

const fs = require('fs');
const path = require('path');

const siteUrl = process.argv[2];
if (!siteUrl) {
  console.error('Usage: node seed-margaret-data.js <site-url>');
  console.error('e.g.   node seed-margaret-data.js https://your-simulator.netlify.app');
  process.exit(1);
}
const baseUrl = siteUrl.replace(/\/$/, '');

const HOTSPOTS_FILE = path.join(__dirname, 'margaret-hotspots.json');
const FACILITIES_FILE = path.join(__dirname, 'margaret-facilities.json');
const IMAGES_DIR = path.join(__dirname, 'margaret-images');

function detectContentType(buffer) {
  // PNG signature: 89 50 4E 47. Fall back to JPEG otherwise, since every
  // image actually extracted this session was one or the other.
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  return 'image/jpeg';
}

async function seedImages() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.log(`Skipping images - ${IMAGES_DIR} not found.`);
    return;
  }
  const files = fs.readdirSync(IMAGES_DIR).filter((f) => /_floor-\d+$/.test(f));
  console.log(`Found ${files.length} floor image file(s) to upload.`);

  for (const file of files) {
    const m = file.match(/_floor-(\d+)$/);
    if (!m) continue;
    const floor = m[1];
    const buffer = fs.readFileSync(path.join(IMAGES_DIR, file));
    const contentType = detectContentType(buffer);
    const res = await fetch(`${baseUrl}/api/floorplan-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ floors: [floor], imageBase64: buffer.toString('base64'), contentType })
    });
    const body = await res.json().catch(() => ({}));
    console.log(`  floor ${floor}: ${res.ok ? 'ok' : 'FAILED - ' + (body.error || res.status)}`);
  }
}

async function seedFacilities() {
  if (!fs.existsSync(FACILITIES_FILE)) {
    console.log(`Skipping facilities - ${FACILITIES_FILE} not found.`);
    return;
  }
  const facilities = JSON.parse(fs.readFileSync(FACILITIES_FILE, 'utf8'));
  console.log(`Found ${facilities.length} facility entrie(s) to import.`);

  for (const f of facilities) {
    // A tombstoned (deleted) entry needs to go through deleteFacility, not
    // saveFacility, so it lands correctly marked as deleted rather than
    // being recreated as if it were still active.
    const action = f.deleted ? 'deleteFacility' : 'saveFacility';
    const res = await fetch(`${baseUrl}/api/floorplan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Passing the exact original id (not omitting it) is what makes
      // floorplan.js's saveFacility create-with-that-exact-id rather than
      // generating a new, different one - this keeps facility ids in
      // sync with the "facility:<id>" keys already baked into the
      // hotspot data being imported alongside this.
      body: JSON.stringify({ action, id: f.id, name: f.name, scope: f.scope })
    });
    const body = await res.json().catch(() => ({}));
    console.log(`  ${f.id} (${f.deleted ? 'tombstone' : 'active'}): ${res.ok ? 'ok' : 'FAILED - ' + (body.error || res.status)}`);
  }
}

async function seedHotspots() {
  if (!fs.existsSync(HOTSPOTS_FILE)) {
    console.log(`Skipping hotspots - ${HOTSPOTS_FILE} not found.`);
    return;
  }
  const hotspots = JSON.parse(fs.readFileSync(HOTSPOTS_FILE, 'utf8'));
  const floors = Object.keys(hotspots);
  console.log(`Found hotspot data for ${floors.length} floor(s) - saving as one batch.`);

  const res = await fetch(`${baseUrl}/api/floorplan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'saveHotspots', floors: hotspots })
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.ok ? '  ok - all floors saved.' : `  FAILED - ${body.error || res.status}`);
}

async function main() {
  console.log(`Seeding Margaret data into ${baseUrl} ...\n`);

  console.log('--- Facilities (must run before hotspots, so referenced ids already exist) ---');
  await seedFacilities();

  console.log('\n--- Hotspots ---');
  await seedHotspots();

  console.log('\n--- Floor images ---');
  await seedImages();

  console.log('\nDone. Open the deployed site\'s Floor Plan page to check it.');
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
