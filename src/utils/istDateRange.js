// The clinic operates in IST (UTC+5:30). Every date-range filter across the
// app (Billing, Payments, Lab, Follow-ups, Notifications) receives bare
// "yyyy-mm-dd" strings from the frontend's QuickDateRangeFilter, which
// computes them via local-timezone-correct methods (never toISOString()).
//
// `new Date("yyyy-mm-dd")` parses as UTC MIDNIGHT, not IST midnight -- in
// IST that's 5:30 AM local, not the start of the local day. Worse, using
// this for BOTH `from` and `to` with no time-of-day added to `to` collapses
// a same-day ("Today") range to a single UTC instant, matching nothing.
// Confirmed root cause of Billing's Today/Yesterday filter showing zero
// results despite real payments existing that day.
//
// These helpers explicitly anchor to IST calendar-day boundaries, converting
// to the correct UTC instant regardless of what timezone the server process
// itself runs in.
const IST_OFFSET = "+05:30";

// Accepts either a bare "yyyy-mm-dd" (the frontend convention) or a full ISO
// datetime string (some callers/tests pass `someDate.toISOString()`) -- only
// the first 10 chars (the calendar-date portion) are ever used, so both
// shapes work identically and neither produces a garbled/invalid string.
const dateOnly = (input) => String(input).slice(0, 10);

export const istStartOfDay = (input) => new Date(`${dateOnly(input)}T00:00:00.000${IST_OFFSET}`);
export const istEndOfDay = (input) => new Date(`${dateOnly(input)}T23:59:59.999${IST_OFFSET}`);

/**
 * Build a Mongo-ready { $gte, $lte } range from "yyyy-mm-dd" from/to query
 * params, anchored to IST calendar-day boundaries. Returns {} for any side
 * that's omitted (open-ended range), and {} entirely if both are omitted.
 */
export const parseIstDateRange = (from, to) => {
  const range = {};
  if (from) range.$gte = istStartOfDay(from);
  if (to) range.$lte = istEndOfDay(to);
  return range;
};
