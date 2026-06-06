import FollowUpReminder from "./followup.model.js";
import Patient from "../patients/patient.model.js";
import { notify } from "../../utils/notifyHelper.js";
import { formatIst } from "./followup.controller.js";

/**
 * FOLLOW-UP REMINDER SCHEDULER
 *
 * Lightweight in-process scheduler (no new infra / no cron dependency):
 * runs once on boot and then every 24h. It finds "scheduled" reminders whose
 * follow-up date falls within the next REMINDER_LEAD_DAYS (IST) and sends the
 * email + in-app reminder to BOTH the patient and the creating admin, then flips
 * status -> "sent" (so it can never double-send).
 */

// How many days before the follow-up date to send the reminder.
export const REMINDER_LEAD_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// UTC instant of "today 00:00" in IST.
const istDayStart = (d = new Date()) => {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
};

/**
 * Process all reminders due within the lead window. Idempotent: only "scheduled"
 * reminders are picked up; each is set to "sent" after delivery.
 */
export const processDueReminders = async () => {
  const start = istDayStart(); // start of today (IST)
  // End of the lead day (inclusive): today + LEAD days, end-of-day IST.
  const windowEnd = new Date(start.getTime() + (REMINDER_LEAD_DAYS + 1) * DAY_MS - 1);

  const due = await FollowUpReminder.find({
    status: "scheduled",
    followUpDate: { $gte: start, $lte: windowEnd },
  }).populate("patient", "name email");

  let sent = 0;
  for (const reminder of due) {
    try {
      const patientName = reminder.patient?.name || "Patient";
      const whenStr = formatIst(reminder.followUpDate, reminder.time);
      const note = reminder.reason ? ` — ${reminder.reason}` : "";

      // Patient: email + in-app. (Email is the primary patient channel.)
      if (reminder.patient?._id) {
        await notify({
          recipientId: reminder.patient._id,
          recipientModel: "Patient",
          type: "appointment_reminder",
          title: "Follow-up visit reminder",
          message: `This is a reminder for your upcoming follow-up visit on ${whenStr}${note}. No payment is needed for this reminder — fees apply only when you visit.`,
          sendEmail: true,
          createdBy: reminder.createdBy,
        });
      }

      // Admin/clinic (creator): in-app + email.
      if (reminder.createdBy) {
        await notify({
          recipientId: reminder.createdBy,
          recipientModel: "User",
          type: "appointment_reminder",
          title: "Follow-up due reminder",
          message: `Follow-up for ${patientName} is due on ${whenStr}${note}.`,
          sendEmail: true,
          createdBy: reminder.createdBy,
        });
      }

      reminder.status = "sent";
      reminder.reminderSentAt = new Date();
      await reminder.save();
      sent += 1;
    } catch (err) {
      // Don't let one failure stop the batch; it stays "scheduled" and retries
      // on the next run (never silently swallowed — logged here).
      console.error(
        `[FollowUpScheduler] Failed to send reminder ${reminder._id}:`,
        err.message,
      );
    }
  }

  if (due.length) {
    console.log(
      `[FollowUpScheduler] processed ${due.length} due reminder(s), sent ${sent}.`,
    );
  }
  return { processed: due.length, sent };
};

/**
 * Start the scheduler: run shortly after boot, then daily.
 */
export const startFollowUpReminderScheduler = () => {
  // Run a few seconds after boot so the DB connection is ready.
  setTimeout(() => {
    processDueReminders().catch((e) =>
      console.error("[FollowUpScheduler] initial run error:", e.message),
    );
  }, 10 * 1000);

  // Then once per day.
  setInterval(() => {
    processDueReminders().catch((e) =>
      console.error("[FollowUpScheduler] daily run error:", e.message),
    );
  }, DAY_MS);

  console.log(
    `[FollowUpScheduler] started (lead ${REMINDER_LEAD_DAYS} day, daily check).`,
  );
};

export default startFollowUpReminderScheduler;
