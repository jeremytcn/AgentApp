// netlify/functions/lib/room-mapper.js
//
// Turns one raw room record from YSuite's check-room-occupancy response into
// the shape this simulator displays and computes against.
//
// Room name -> floor / shared-unit parsing, per Jeremy's examples:
//   "02.02 YSMG"  -> single-occupant room. Floor = 2 (first 2 digits before
//                    the first "."). The whole string is the room's own
//                    identity - not part of a shared unit.
//   "17.12.1" /
//   "17.12.2"     -> two bedrooms of the SAME unit "17.12" on floor 17.
//                    YSuite already returns each bedroom as its own room
//                    record; we just need to recognise they share a unit.
//
// IMPORTANT: this parsing is built from exactly two real examples. Before
// trusting it in production, check it against a full real payload -
// especially whether every single-occupant room name reliably has a space
// before its trailing label (so it never collides with the 3-segment shared
// pattern), and whether a 3-bedroom unit's bedroom index always renders the
// same way ("17.12.3") as the 2-bedroom case.
function parseRoomName(raw) {
  const name = String(raw || '').trim();
  const parts = name.split('.');
  const floor = parseInt(parts[0], 10);

  if (parts.length >= 3) {
    const last = parts[parts.length - 1].trim();
    const bedroomMatch = last.match(/^(\d+)(?:\s+.*)?$/);
    if (bedroomMatch) {
      return {
        floor: isNaN(floor) ? null : floor,
        unitKey: parts.slice(0, parts.length - 1).join('.'),
        bedroomIndex: bedroomMatch[1],
        shared: true
      };
    }
  }

  return {
    floor: isNaN(floor) ? null : floor,
    unitKey: name,
    bedroomIndex: null,
    shared: false
  };
}

// Gender isn't in the current YSuite payload yet (the JWT's scope doesn't
// include it) - this is here so nothing else needs to change once it is.
// Accepts a handful of likely raw shapes and normalizes to 'male' / 'female' /
// null; unrecognized values fall back to null rather than guessing.
function normalizeGender(raw) {
  if (raw == null) return null;
  const g = String(raw).trim().toLowerCase();
  if (g === 'm' || g === 'male') return 'male';
  if (g === 'f' || g === 'female') return 'female';
  return null;
}

const { resolveRoomStatus, computeAvailableUntil } = require('./status');

function mapRoom(r) {
  const parsed = parseRoomName(r.room);
  const status = resolveRoomStatus(r).toLowerCase(); // confirmed | arrived | unconfirmed | available | unavailable
  const isBooked = status === 'confirmed' || status === 'arrived' || status === 'unconfirmed';
  const reservation = isBooked ? (r.reservation || null) : null;

  const leaseStart = reservation ? (reservation.arrivalDate || null) : null;
  const leaseEnd = reservation ? (reservation.departureDate || null) : null;

  // For a currently-available room, this is the last day it's still free -
  // derived from whatever YSuite reports as the next upcoming booking. If
  // there's no known next booking, the room is open indefinitely as far as
  // we can tell.
  let availableUntil = null;
  if (status === 'available') {
    const nextStart = (r.nextReservation && r.nextReservation.arrivalDate) || r.nextBookingDate || null;
    availableUntil = computeAvailableUntil(nextStart);
  }

  return {
    name: r.room || null,
    floor: parsed.floor,
    unitKey: parsed.unitKey,
    bedroomIndex: parsed.bedroomIndex,
    shared: parsed.shared,
    // roomTypeName is expected to already match one of the 7 configured type
    // names (Studio Premium (High)/(Low), 3 Bedroom (High)/(Low), Ensuite
    // Premium, 2 Bedroom (High)/(Low)) - same names used elsewhere (e.g. the
    // Lease Rate Simulator). Anything that doesn't match falls through as
    // its raw value rather than being silently dropped, so a real mismatch
    // is visible instead of hidden.
    roomType: r.roomTypeName || (r.categoryId != null ? String(r.categoryId) : null),
    status: status,
    gender: normalizeGender(r.gender),
    leaseStart: leaseStart,
    leaseEnd: leaseEnd,
    availableUntil: availableUntil
  };
}

module.exports = { parseRoomName, normalizeGender, mapRoom };
