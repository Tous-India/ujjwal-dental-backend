import mongoose from "mongoose";

/**
 * FOLLOW-UP REMINDER MODEL
 *
 * An admin-created reminder that a patient should come back for a follow-up
 * visit. This is a REMINDER ONLY — no money/invoice is attached. The invoice is
 * created/collected when the patient actually visits (existing flow).
 */
const followUpReminderSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient is required"],
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },
    followUpDate: {
      type: Date,
      required: [true, "Follow-up date is required"],
    },
    time: { type: String }, // optional "HH:MM"
    reason: { type: String }, // e.g. "Monthly check-up", "Review after cleaning"
    status: {
      type: String,
      enum: ["scheduled", "sent", "done", "cancelled"],
      default: "scheduled",
    },
    // Set when the lead-time reminder email/in-app has been delivered, so it is
    // never sent twice (idempotency guard).
    reminderSentAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

followUpReminderSchema.index({ patient: 1, followUpDate: 1 });
followUpReminderSchema.index({ status: 1, followUpDate: 1 });

const FollowUpReminder = mongoose.model(
  "FollowUpReminder",
  followUpReminderSchema,
);

export default FollowUpReminder;
