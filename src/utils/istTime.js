// The clinic operates in IST (UTC+5:30, no DST). Vercel's Node runtime
// defaults to UTC with no TZ env var set (confirmed: no TZ configured
// anywhere in this repo), so `new Date()` and its local accessor methods
// (.getHours(), .getMinutes(), .getFullYear(), .getMonth(), .getDate())
// reflect UTC in production, NOT IST -- even though they happen to reflect
// IST on a dev machine whose OS regional settings are IST. This is the
// confirmed root cause of appointment numbers showing a time ~5.5 hours
// earlier than the real IST booking moment.
//
// nowIST() returns a Date object shifted so that its UTC accessors
// (.getUTCHours(), .getUTCMinutes(), .getUTCFullYear(), .getUTCMonth(),
// .getUTCDate(), .toISOString()) report the correct IST wall-clock values.
//
// IMPORTANT: callers MUST read this value via the UTC-prefixed accessors
// (or toISOString()), NEVER the local accessors (.getHours() etc). The
// local accessors depend on the SERVER's own configured timezone -- on
// Vercel (UTC) they'd coincidentally work, but on a dev machine already
// configured to IST they'd double-shift and be WRONG. Using the UTC
// accessors on this shifted value is correct on every server regardless of
// its local timezone configuration -- this is what makes nowIST() reliable
// to verify locally AND trust in production.
//
// Never trust raw `new Date()` for "what time is it right now for the
// clinic" -- use nowIST() instead. (Mongoose's own createdAt/updatedAt via
// timestamps:true should NOT use this -- those correctly stay real UTC
// instants for storage; this utility is for business-logic computation
// only: appointment numbers, "today" boundaries, "already passed" checks.)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

// yyyy-mm-dd representing the current IST calendar date.
export function istDateString() {
  return nowIST().toISOString().split("T")[0];
}

// HH:MM representing the current IST time-of-day.
export function istTimeString() {
  return nowIST().toISOString().split("T")[1].substring(0, 5);
}

// HH and MM (as numbers) for a given instant (defaults to now), in IST.
// Uses Intl.DateTimeFormat with an explicit timeZone -- the same
// already-proven pattern appointmentToken.js's istDateKey() uses for the
// daily token counter -- correct regardless of server timezone, no manual
// offset math needed for this one.
export function istHourMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  return { hour, minute };
}
