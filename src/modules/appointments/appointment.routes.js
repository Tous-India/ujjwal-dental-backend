import { Router } from "express";
import mongoose from "mongoose";
import * as appointmentController from "./appointment.controller.js";
import authProtect, { anyAuth, optionalAuth, patientProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission, checkPermissionIfStaff } from "../../middlewares/permission.middleware.js";
import Appointment from "./appointment.model.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
const router = Router();

/**
 * APPOINTMENT ROUTES
 * Base path: /api/appointments
 * Access:
 *   - Public:                available-slots, initiate-booking, confirm-booking
 *   - Staff/admin only:      create (POST /), list / today / upcoming, update, status, check-in, complete
 *   - Admin only:            permanent delete
 *   - Patient-self or staff: cancel, reschedule, my-appointments-by-phone
 */

/**
 * Allow admin/staff, or the patient who owns the appointment (:id).
 * Runs after anyAuth (which sets req.userType + req.user/req.patient).
 */
const appointmentSelfOrAdmin = async (req, res, next) => {
  if (req.userType === "admin" && req.user) return next();
  if (req.userType === "patient" && req.patient) {
    const appt = await Appointment.findById(req.params.id).select("patient");
    if (!appt) return ApiResponse.error(res, "Appointment not found", 404);
    if (appt.patient?.toString() === req.patient._id.toString()) return next();
    return ApiResponse.error(res, "Not authorized to access this resource", 403);
  }
  return ApiResponse.error(res, "Not authorized", 401);
};

/**
 * Allow admin/staff, or a patient querying their own phone number.
 * Runs after anyAuth.
 */
const phoneSelfOrAdmin = (req, res, next) => {
  if (req.userType === "admin" && req.user) return next();
  if (req.userType === "patient" && req.patient) {
    if (req.params.phone === req.patient.phone) return next();
    return ApiResponse.error(res, "Not authorized to access this resource", 403);
  }
  return ApiResponse.error(res, "Not authorized", 401);
};

// Get all appointments (with filters) — staff/admin
router.get("/", authProtect, appointmentController.getAllAppointments);

// Get today's appointments — staff/admin
router.get("/today", authProtect, appointmentController.getTodayAppointments);

// Get upcoming appointments — staff/admin
router.get("/upcoming", authProtect, appointmentController.getUpcomingAppointments);

// Get stale (stalled) treatments — dashboard flag list — staff/admin
router.get("/stale-treatments", authProtect, appointmentController.getStaleTreatments);

// Chargeable appointments with NO invoice — billing-gap alert (see controller)
router.get("/unbilled", authProtect, appointmentController.getUnbilledAppointments);

// Get available slots (for booking) — public; optionalAuth lets admin/clinic_manager
// see slots for backdated dates (same allowance as createAppointment)
router.get("/available-slots", optionalAuth, appointmentController.getAvailableSlots);

// Step 1 of online booking: hold slot (PENDING) + create Razorpay order — public
router.post("/initiate-booking", appointmentController.initiateBooking);

// Step 2 of online booking: verify payment paid, confirm appointment, generate invoice — public
router.post("/confirm-booking", appointmentController.confirmBooking);

// Create new appointment (book) — staff/admin only (closes the unauthenticated hole)
router.post("/", authProtect, checkPermission("appointments", "create"), appointmentController.createAppointment);

// Book appointment after payment (legacy — kept for backward compatibility)
router.post("/book-with-payment", appointmentController.bookAppointmentWithPayment);

// Book free OPD appointment for logged-in patients with active membership
router.post("/book-free", patientProtect, appointmentController.bookAppointmentFree);

// Update appointment details — staff/admin
router.patch("/:id", authProtect, checkPermission("appointments", "edit"), appointmentController.updateAppointment);

// Update appointment status — staff/admin
router.patch("/:id/status", authProtect, checkPermission("appointments", "edit"), appointmentController.updateStatus);

// Check-in patient — staff/admin
router.post("/:id/check-in", authProtect, checkPermission("appointments", "edit"), appointmentController.checkIn);

// Complete appointment — staff/admin
router.post("/:id/complete", authProtect, checkPermission("appointments", "edit"), appointmentController.completeAppointment);

// Cancel appointment — patient-self or staff/admin
router.post("/:id/cancel", anyAuth, appointmentSelfOrAdmin, checkPermissionIfStaff("appointments", "edit"), appointmentController.cancelAppointment);

// Reschedule appointment — admin/staff only
router.post("/:id/reschedule", authProtect, checkPermission("appointments", "edit"), appointmentController.rescheduleAppointment);

// Close treatment plan (cancel remaining sessions + reconcile invoice) — admin / clinic manager
router.post("/:id/close-treatment", authProtect, checkPermission("appointments", "edit"), appointmentController.closeTreatmentPlan);

// Reopen a closed treatment (mandatory reason, full audit trail) — admin / clinic manager
router.post("/:id/reopen-treatment", authProtect, checkPermission("appointments", "edit"), appointmentController.reopenTreatment);

// Edit a treatment plan's name/line items/discount — available throughout the
// active lifecycle (any number of sessions delivered), locked once closed —
// admin / clinic manager
router.patch(
  "/:id/treatment-items",
  authProtect,
  checkPermission("appointments", "edit"),
  appointmentController.updateTreatmentItems
);

// Delete appointment permanently — admin / clinic manager
router.delete("/:id", authProtect, checkPermission("appointments", "delete"), appointmentController.deleteAppointment);

// Get single appointment by ID — patient-self or staff/admin. Registered
// BEFORE the phone-lookup route below: since both are single-segment GET
// params at the same path depth, whichever is registered first wins for
// every request. Falls through to the phone route (`next("route")`) when the
// param isn't a valid Mongo ObjectId, so real phone-number lookups are
// unaffected. Previously `getAppointmentById` existed in the controller but
// was NEVER wired to any route -- every GET /appointments/<id> silently fell
// through to getAppointmentsByPhone, which did `Patient.findOne({ phone: id
// })`, found nothing, and returned "Patient not found" -- the exact bug
// reported on the Treatment #/Linked OPD Visit and Appointment # click
// handlers (Patient Detail modal's Treatments/Appointments tabs).
router.get(
  "/:id",
  anyAuth,
  (req, res, next) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next("route");
    }
    return next();
  },
  appointmentSelfOrAdmin,
  appointmentController.getAppointmentById
);

// Get a patient's appointments by phone — patient-self or staff/admin
router.get("/:phone", anyAuth, phoneSelfOrAdmin, appointmentController.getAppointmentsByPhone);
export default router;
