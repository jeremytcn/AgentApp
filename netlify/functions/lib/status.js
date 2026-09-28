// netlify/functions/lib/status.js
//
// Status-resolution and lease-date helpers. Carried over from the main Room
// Availability Dashboard's netlify/functions/availability.js (resolveRoomStatus
// and friends) essentially verbatim, specifically so the status precedence rules
// (Pencil -> Unconfirmed, Under Maintenance/Out of Order -> Unavailable
// regardless of any reservation, etc.) stay identical between the two projects
// instead of quietly drifting apart. If that logic changes in the main
// dashboard, mirror the change here too.

function normalizeStatus(raw) {
  if (raw == null || raw === '') return null;
  return String(raw).trim();
}

function statusKey(raw) {
  const s = normalizeStatus(raw);
  return s ? s.toLowerCase() : null;
}

// Final statuses: Confirmed | Arrived | Unconfirmed | Available | Unavailable.
function resolveRoomStatus(r) {
  const roomKey = statusKey(r.status);
  const resKey = statusKey(r.reservation && r.reservation.status);

  if (
    roomKey === 'under maintenance' ||
    roomKey === 'out of order' ||
    roomKey === 'unavailable'
  ) {
    return 'Unavailable';
  }

  const candidates = [resKey, roomKey].filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i];
    if (key === 'confirmed') return 'Confirmed';
    if (key === 'arrived') return 'Arrived';
    if (key === 'unconfirmed' || key === 'pencil') return 'Unconfirmed';
  }

  // Legacy room-level "Occupied" with a reservation but no booking status.
  if (roomKey === 'occupied' && r.reservation && r.reservation.id != null) {
    return r.occupied ? 'Arrived' : 'Confirmed';
  }

  return 'Available';
}

function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(str, days) {
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

function todayYmd() {
  return formatYmd(new Date());
}

// Available until = 1 day before the next reservation's arrival, only when
// that date is in the future.
function computeAvailableUntil(nextArrival) {
  if (!nextArrival) return null;
  const until = addDaysYmd(nextArrival, -1);
  if (!until || until <= todayYmd()) return null;
  return until;
}

// Unavailable until = 7 days after lease end. Used for booked rooms; a room
// that's Unavailable for maintenance/OOO reasons uses the RMS's own
// unavailableUntil value instead (no lease to derive from).
function computeUnavailableUntil(leaseEnd) {
  if (!leaseEnd) return null;
  return addDaysYmd(leaseEnd, 7);
}

function guestFullName(reservation) {
  if (!reservation) return null;
  const given = String(reservation.guestGiven || '').trim();
  const surname = String(reservation.guestSurname || '').trim();
  const full = [given, surname].filter(Boolean).join(' ');
  return full || null;
}

function nightsBetween(arrival, departure) {
  if (!arrival || !departure) return null;
  const a = new Date(String(arrival).replace(' ', 'T'));
  const b = new Date(String(departure).replace(' ', 'T'));
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

module.exports = {
  normalizeStatus,
  statusKey,
  resolveRoomStatus,
  formatYmd,
  addDaysYmd,
  todayYmd,
  computeAvailableUntil,
  computeUnavailableUntil,
  guestFullName,
  nightsBetween
};
