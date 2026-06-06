import mongoose from "mongoose";

/**
 * DAILY TOKEN COUNTER (shared by website + admin booking paths)
 *
 * An atomic per-clinic, per-day counter. The document _id is the composite
 * `${clinicId}:${dateKey}` so the upsert is race-proof (upsert on _id can never
 * create two documents), and `findByIdAndUpdate(..., { $inc: { seq: 1 } })` is a
 * single atomic MongoDB operation — concurrent bookings can't collide.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String }, // `${clinicId}:${dateKey}`
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic" },
    dateKey: { type: String }, // YYYY-MM-DD in IST
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const Counter =
  mongoose.models.Counter || mongoose.model("Counter", counterSchema);

/**
 * Created-date key in India Standard Time (Asia/Kolkata), formatted YYYY-MM-DD.
 * Computed from the absolute instant, so the key flips at IST midnight no matter
 * what timezone the server runs in — no cron needed for the daily reset.
 */
export const istDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // en-CA → "YYYY-MM-DD"

/**
 * Atomically get the next token number for a clinic on a given IST date key.
 * Tokens start at 1 each day per clinic and increment 1, 2, 3, ...
 *
 * @returns {Promise<number>} the unique token number
 */
export const nextDailyToken = async (clinicId, dateKey) => {
  const _id = `${clinicId}:${dateKey}`;
  const counter = await Counter.findByIdAndUpdate(
    _id,
    { $inc: { seq: 1 }, $setOnInsert: { clinicId, dateKey } },
    { upsert: true, new: true },
  );
  return counter.seq;
};

export default Counter;
