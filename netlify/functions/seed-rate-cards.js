// seed-rate-cards.js
//
// One-time import script - loads a real localStorage export from the
// Lease Rate Simulator prototype (key 'leaseSim.rateCards.v1') into this
// project's real backend (/api/rates and /api/rates-media), converting
// every embedded base64 image/video into a real Blobs asset instead of
// leaving it inline in the config.
//
// USAGE:
//   node seed-rate-cards.js <site-url> <path-to-exported-json>
//   e.g. node seed-rate-cards.js http://localhost:8888 ./leaseSim_rateCards_v1.txt
//
// To get the exported JSON in the first place, from the OLD Lease Rate
// Simulator artifact's browser console:
//   copy(localStorage.getItem('leaseSim.rateCards.v1'))
// then paste the clipboard contents into a .txt/.json file.
//
// Safe to run more than once for the same file - every image/video gets a
// freshly generated asset id each time, though, so re-running will
// duplicate media assets in Blobs storage (harmless but wasteful) rather
// than overwrite the previous run's. Meant to be run once.

const fs = require('fs');

const siteUrl = process.argv[2];
const dataPath = process.argv[3];
if (!siteUrl || !dataPath) {
  console.error('Usage: node seed-rate-cards.js <site-url> <path-to-exported-json>');
  console.error('e.g.   node seed-rate-cards.js http://localhost:8888 ./leaseSim_rateCards_v1.txt');
  process.exit(1);
}
const baseUrl = siteUrl.replace(/\/$/, '');

function detectContentType(buffer, hint) {
  if (hint) return hint;
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  return 'application/octet-stream';
}

// A data URI looks like "data:image/png;base64,iVBORw0..." - split off the
// declared content type and the actual base64 payload.
function parseDataUri(uri) {
  const m = String(uri || '').match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return null;
  return { contentType: m[1], base64: m[2] };
}

async function uploadAsset(base64, contentType) {
  const res = await fetch(`${baseUrl}/api/rates-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, contentType })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
  return body.id;
}

async function migrateRoomMedia(roomMedia) {
  const out = {};
  for (const roomName in roomMedia) {
    const entry = roomMedia[roomName] || {};
    const images = Array.isArray(entry.images) ? entry.images : [];
    const videos = Array.isArray(entry.videos) ? entry.videos : [];

    const newImages = [];
    for (const dataUri of images) {
      const parsed = parseDataUri(dataUri);
      if (!parsed) { console.log(`    skipping an image for "${roomName}" - not a data URI`); continue; }
      const buffer = Buffer.from(parsed.base64, 'base64');
      const id = await uploadAsset(parsed.base64, detectContentType(buffer, parsed.contentType));
      newImages.push(id);
    }

    const newVideos = [];
    for (const v of videos) {
      if (v && v.type === 'link') {
        newVideos.push({ type: 'link', url: v.url || '', caption: v.caption || '' });
        continue;
      }
      if (v && v.type === 'file' && v.dataUrl) {
        const parsed = parseDataUri(v.dataUrl);
        if (!parsed) { console.log(`    skipping a video file for "${roomName}" - not a data URI`); continue; }
        const buffer = Buffer.from(parsed.base64, 'base64');
        const id = await uploadAsset(parsed.base64, detectContentType(buffer, parsed.contentType));
        let thumbnailId = null;
        if (v.thumbnail) {
          const tParsed = parseDataUri(v.thumbnail);
          if (tParsed) thumbnailId = await uploadAsset(tParsed.base64, detectContentType(Buffer.from(tParsed.base64, 'base64'), tParsed.contentType));
        }
        newVideos.push({ type: 'file', assetId: id, thumbnailId: thumbnailId, caption: v.caption || '', name: v.name || '', size: v.size || 0 });
        continue;
      }
      console.log(`    skipping an unrecognized video entry for "${roomName}"`);
    }

    out[roomName] = { images: newImages, videos: newVideos };
    console.log(`  ${roomName}: ${newImages.length} image(s), ${newVideos.length} video(s) migrated`);
  }
  return out;
}

async function main() {
  console.log(`Reading ${dataPath} ...`);
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  if (!raw || !Array.isArray(raw.list) || !raw.property) {
    console.error('This doesn\'t look like a leaseSim.rateCards.v1 export (expected { list, property, activeIndex }).');
    process.exit(1);
  }

  console.log(`Found ${raw.list.length} rate card(s). Migrating room media (images/videos) to real assets...\n`);
  const roomMedia = await migrateRoomMedia(raw.property.roomMedia || {});

  const config = {
    property: {
      propertyName: raw.property.propertyName || '',
      propertyId: raw.property.propertyId || '',
      lowFloorMin: raw.property.lowFloorMin || 0,
      lowFloorMax: raw.property.lowFloorMax || 0,
      highFloorMin: raw.property.highFloorMin || 0,
      highFloorMax: raw.property.highFloorMax || 0,
      securityDeposit: raw.property.securityDeposit || 0,
      advanceRent: raw.property.advanceRent || 0,
      bond: raw.property.bond || 0,
      currency: raw.property.currency || 'SGD',
      rateType: raw.property.rateType || 'Monthly',
      roomShortNames: raw.property.roomShortNames || {},
      roomMedia: roomMedia
    },
    // Rows already carry their own (empty, in the real export) images/videos
    // arrays - those were a per-card-row leftover the prototype never
    // actually used (real media lives in property.roomMedia instead), kept
    // here as-is for shape compatibility.
    list: raw.list,
    activeIndex: raw.activeIndex || 0
  };

  console.log('\nChecking current config version before saving (rates.js now version-checks every save)...');
  const currentRes = await fetch(`${baseUrl}/api/rates`);
  const current = await currentRes.json().catch(() => ({ _version: 0 }));
  console.log(`  current version: ${current._version || 0}`);

  console.log('Saving config to /api/rates ...');
  const res = await fetch(`${baseUrl}/api/rates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', config, expectedVersion: current._version || 0, sessionId: 'seed-script', holderLabel: 'Seed script' })
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.ok ? `Done - config saved (now version ${body._version}).` : `FAILED - ${body.error || res.status}`);
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
