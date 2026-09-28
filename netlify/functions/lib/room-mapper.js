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

// Gender and Title come from the CURRENT reservation on a room (the
// guest's own attributes), confirmed against a real sample of the main
// Room Availability Dashboard's availability.js - both are null whenever
// there's no active reservation (Available/Unavailable rooms), which is
// exactly what "leave gender blank when a shared unit is fully vacant"
// already assumed. Output stays lowercase ('male'/'female') to match
// every existing gender === 'male'/'female' check elsewhere in this app
// (Agent/Reservation gender-split, Floor Plan's per-unit consistency
// warning) - only display code capitalizes it for showing to a person.
function formatGender(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const key = s.toUpperCase();
  if (key === 'F' || key === 'FEMALE') return 'female';
  if (key === 'M' || key === 'MALE') return 'male';
  return s.toLowerCase();
}

function textOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

const { resolveRoomStatus, computeAvailableUntil, computeUnavailableUntil, guestFullName, nightsBetween } = require('./status');

function mapRoom(r) {
  const parsed = parseRoomName(r.room);
  const status = resolveRoomStatus(r).toLowerCase(); // confirmed | arrived | unconfirmed | available | unavailable
  const isBooked = status === 'confirmed' || status === 'arrived' || status === 'unconfirmed';
  // Different properties' YSuite data has turned out to structure a
  // Confirmed (not-yet-arrived) booking's details differently - one
  // property put them under r.nextReservation instead of r.reservation
  // (confirmed directly against a real example), but assuming that's
  // universal broke a second property where Confirmed rooms use
  // r.reservation normally after all. Rather than hard-code one specific
  // field for "confirmed", check whichever one actually has real
  // reservation data (an id, or an arrival/departure date) and use that -
  // works correctly regardless of which convention a given property's
  // YSuite instance happens to use. Arrived and Unconfirmed are
  // unaffected by this - they only ever read r.reservation.
  function hasRealReservationData(obj) {
    return !!(obj && (obj.id != null || obj.arrivalDate || obj.departureDate));
  }
  let reservation = null;
  if (isBooked) {
    if (status === 'confirmed') {
      reservation = hasRealReservationData(r.reservation)
        ? r.reservation
        : (hasRealReservationData(r.nextReservation) ? r.nextReservation : (r.reservation || r.nextReservation || null));
    } else {
      reservation = r.reservation || null;
    }
  }
  const upcomingReservation = status === 'available' ? (r.nextReservation || null) : null;

  const leaseStart = reservation ? (reservation.arrivalDate || null) : null;
  const leaseEnd = reservation ? (reservation.departureDate || null) : null;

  const bondPaidRaw = reservation
    ? (reservation.bondPaid != null ? reservation.bondPaid : (r.bondPaid != null ? r.bondPaid : null))
    : null;
  const adesRaw = reservation
    ? (reservation.adesCompleted != null ? reservation.adesCompleted : (r.adesCompleted != null ? r.adesCompleted : null))
    : null;

  // availableUntil: for a currently-available room, the last day it's still
  // free, derived from whatever YSuite reports as the next upcoming
  // booking. No known next booking -> open indefinitely as far as we can
  // tell. unavailableUntil: for a booked room, 7 days after lease end; for
  // a maintenance/OOO room, whatever raw value YSuite itself reports (no
  // lease to derive it from).
  let availableUntil = null;
  let unavailableUntil = null;
  if (status === 'unavailable') {
    unavailableUntil = r.unavailableUntil || null;
  } else if (isBooked) {
    unavailableUntil = computeUnavailableUntil(leaseEnd);
  } else {
    const nextStart = (upcomingReservation && upcomingReservation.arrivalDate) || r.nextBookingDate || null;
    availableUntil = computeAvailableUntil(nextStart);
  }

  return {
    name: r.room || null,
    floor: parsed.floor,
    unitKey: parsed.unitKey,
    bedroomIndex: parsed.bedroomIndex,
    shared: parsed.shared,
    // roomTypeName is expected to match one of the real base types
    // (Studio Premium, Studio Deluxe, Ensuite Premium, 2 Bedroom Apartment)
    // confirmed from a real sync - High/Low is applied separately, from
    // floor, in the frontend. Anything that doesn't match falls through as
    // its raw value rather than being silently dropped, so a real mismatch
    // is visible instead of hidden.
    roomType: r.roomTypeName || (r.categoryId != null ? String(r.categoryId) : null),
    status: status,
    gender: formatGender(reservation ? reservation.gender : null),
    title: reservation ? textOrNull(reservation.title) : null,
    leaseStart: leaseStart,
    leaseEnd: leaseEnd,
    availableUntil: availableUntil,
    unavailableUntil: unavailableUntil,
    // Reservation detail, for Reservation view's expandable rows. Only
    // meaningful when isBooked - null otherwise, same as the main
    // dashboard's mapOccupancyRoom.
    resNo: reservation && reservation.id != null ? reservation.id : null,
    guestName: guestFullName(reservation),
    nights: reservation ? nightsBetween(reservation.arrivalDate, reservation.departureDate) : null,
    bondPaid: bondPaidRaw == null ? null : Boolean(bondPaidRaw),
    ades: adesRaw == null ? null : Boolean(adesRaw)
  };
}

module.exports = { parseRoomName, formatGender, mapRoom };
