import { Router } from "express";
import * as appointmentController from "./appointment.controller.js";
import authProtect, { anyAuth, optionalAuth, patientProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
import Appointment from "./appointment.model.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
const router = Router();

/**
 * APPOINTMENT ROUTES
 * Base path: /api/appointments
 * Access:
 *   - Public:                available-slots, create (book), book-with-payment
 *   - Staff/admin:           list / today / upcoming, update, status, check-in, complete
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

// Get available slots (for booking) — public
router.get("/available-slots", appointmentController.getAvailableSlots);

// Create new appointment (book) — public; optionalAuth records staff id when present
router.post("/", optionalAuth, appointmentController.createAppointment);

// Book appointment after payment (public - for online booking)
router.post("/book-with-payment", appointmentController.bookAppointmentWithPayment);

// Book free OPD appointment for logged-in patients with active membership
router.post("/book-free", patientProtect, appointmentController.bookAppointmentFree);

// Update appointment details — staff/admin
router.patch("/:id", authProtect, appointmentController.updateAppointment);

// Update appointment status — staff/admin
router.patch("/:id/status", authProtect, appointmentController.updateStatus);

// Check-in patient — staff/admin
router.post("/:id/check-in", authProtect, appointmentController.checkIn);

// Complete appointment — staff/admin
router.post("/:id/complete", authProtect, appointmentController.completeAppointment);

// Cancel appointment — patient-self or staff/admin
router.post("/:id/cancel", anyAuth, appointmentSelfOrAdmin, appointmentController.cancelAppointment);

// Reschedule appointment — admin/staff only
router.post("/:id/reschedule", authProtect, appointmentController.rescheduleAppointment);

// Close treatment plan (cancel remaining sessions + reconcile invoice) — admin / clinic manager
router.post("/:id/close-treatment", authProtect, checkPermission("appointments", "edit"), appointmentController.closeTreatmentPlan);

// Delete appointment permanently — admin / clinic manager
router.delete("/:id", authProtect, checkPermission("appointments", "delete"), appointmentController.deleteAppointment);

// Get a patient's appointments by phone — patient-self or staff/admin
router.get("/:phone", anyAuth, phoneSelfOrAdmin, appointmentController.getAppointmentsByPhone);
export default router;
