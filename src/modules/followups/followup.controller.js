import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { notify } from "../../utils/notifyHelper.js";
import FollowUpReminder from "./followup.model.js";
import Patient from "../patients/patient.model.js";
import mongoose from "mongoose";
import { parseIstDateRange } from "../../utils/istDateRange.js";

/**
 * FOLLOW-UP REMINDER CONTROLLER (admin-only CRUD + patient read)
 * Reminder only — no invoice/payment is created here.
 */

// Format a follow-up date for human-readable messages, in IST.
const formatIst = (date, time) => {
  const d = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
  return time ? `${d} at ${time}` : d;
};

/**
 * @desc    Create a follow-up reminder
 * @route   POST /api/followups
 * @access  Admin
 */
export const createFollowUp = asyncHandler(async (req, res) => {
  const { patient, clinic, followUpDate, time, reason } = req.body;

  if (!patient || !mongoose.Types.ObjectId.isValid(patient)) {
    return ApiResponse.error(res, "A valid patient is required", 400);
  }
  if (!followUpDate) {
    return ApiResponse.error(res, "Follow-up date is required", 400);
  }

  const patientDoc = await Patient.findById(patient);
  if (!patientDoc) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  const reminder = await FollowUpReminder.create({
    patient,
    clinic: clinic || patientDoc.preferredClinic || undefined,
    followUpDate,
    time: time || undefined,
    reason: reason || undefined,
    createdBy: req.user?._id,
  });

  // Immediate in-app confirmation entries (no email here — the email goes out at
  // lead time). Reuses the existing notification system.
  const whenStr = formatIst(followUpDate, time);
  const note = reason ? ` — ${reason}` : "";

  // Patient: in-app entry that a follow-up is scheduled.
  notify({
    recipientId: patient,
    recipientModel: "Patient",
    type: "appointment_reminder",
    title: "Follow-up scheduled",
    message: `A follow-up visit has been scheduled for ${whenStr}${note}. No payment is required to be reminded — fees apply only when you visit.`,
    createdBy: req.user?._id,
  });

  // Admin (creator): in-app confirmation.
  if (req.user?._id) {
    notify({
      recipientId: req.user._id,
      recipientModel: "User",
      type: "appointment_reminder",
      title: "Follow-up reminder created",
      message: `Follow-up for ${patientDoc.name} scheduled on ${whenStr}${note}.`,
      createdBy: req.user._id,
    });
  }

  const populated = await FollowUpReminder.findById(reminder._id)
    .populate("patient", "name phone email")
    .populate("clinic", "name");

  ApiResponse.created(res, { reminder: populated }, "Follow-up reminder created");
});

/**
 * @desc    List follow-up reminders (filters: patient, upcoming, from, to, status)
 * @route   GET /api/followups
 * @access  Admin
 */
export const getFollowUps = asyncHandler(async (req, res) => {
  const { patient, status, upcoming, from, to, page = 1, limit = 20 } = req.query;

  const query = {};
  if (patient && mongoose.Types.ObjectId.isValid(patient)) query.patient = patient;
  if (status) query.status = status;

  if (from || to || upcoming === "true") {
    query.followUpDate = {};
    if (upcoming === "true") query.followUpDate.$gte = new Date();
    Object.assign(query.followUpDate, parseIstDateRange(from, to));
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [reminders, total] = await Promise.all([
    FollowUpReminder.find(query)
      .populate("patient", "name phone email")
      .populate("clinic", "name")
      .sort({ followUpDate: 1 })
      .skip(skip)
      .limit(parseInt(limit)),
    FollowUpReminder.countDocuments(query),
  ]);

  ApiResponse.paginated(res, reminders, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    The logged-in patient's own upcoming follow-up reminders
 * @route   GET /api/followups/my
 * @access  Patient
 */
export const getMyFollowUps = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id;
  if (!patientId) return ApiResponse.error(res, "Not authorized", 401);

  const reminders = await FollowUpReminder.find({
    patient: patientId,
    status: { $in: ["scheduled", "sent"] },
    followUpDate: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  })
    .populate("clinic", "name")
    .sort({ followUpDate: 1 });

  ApiResponse.success(res, { reminders }, "Follow-ups fetched");
});

/**
 * @desc    Update a follow-up reminder (date/time/reason/clinic)
 * @route   PATCH /api/followups/:id
 * @access  Admin
 */
export const updateFollowUp = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid reminder ID", 400);
  }
  const reminder = await FollowUpReminder.findById(id);
  if (!reminder) return ApiResponse.error(res, "Reminder not found", 404);

  ["followUpDate", "time", "reason", "clinic"].forEach((f) => {
    if (req.body[f] !== undefined) reminder[f] = req.body[f];
  });
  await reminder.save();

  const populated = await FollowUpReminder.findById(reminder._id)
    .populate("patient", "name phone email")
    .populate("clinic", "name");
  ApiResponse.success(res, { reminder: populated }, "Reminder updated");
});

/**
 * @desc    Mark a follow-up reminder as done
 * @route   PATCH /api/followups/:id/done
 * @access  Admin
 */
export const markFollowUpDone = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reminder = await FollowUpReminder.findById(id);
  if (!reminder) return ApiResponse.error(res, "Reminder not found", 404);
  reminder.status = "done";
  await reminder.save();
  ApiResponse.success(res, { reminder }, "Marked as done");
});

/**
 * @desc    Cancel a follow-up reminder
 * @route   PATCH /api/followups/:id/cancel
 * @access  Admin
 */
export const cancelFollowUp = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reminder = await FollowUpReminder.findById(id);
  if (!reminder) return ApiResponse.error(res, "Reminder not found", 404);
  reminder.status = "cancelled";
  await reminder.save();
  ApiResponse.success(res, { reminder }, "Reminder cancelled");
});

export { formatIst };
