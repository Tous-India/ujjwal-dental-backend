import { Router } from "express";
import * as appointmentController from "./appointment.controller.js";
import authProtect from "../../middlewares/auth.middleware.js";
const router = Router();

/**
 * APPOINTMENT ROUTES
 * Base path: /api/appointments
 * Access: Admin (full), Patient (own appointments)
 */

// Get all appointments (with filters)
router.get("/", appointmentController.getAllAppointments);

// Get today's appointments
router.get("/today", appointmentController.getTodayAppointments);

// Get upcoming appointments
router.get("/upcoming", appointmentController.getUpcomingAppointments);

// Get available slots (for booking)
router.get("/available-slots", appointmentController.getAvailableSlots);

// Create new appointment (book)
router.post("/", appointmentController.createAppointment);

// Book appointment after payment (public - for online booking)
router.post("/book-with-payment", appointmentController.bookAppointmentWithPayment);

// Update appointment details
router.patch("/:id", appointmentController.updateAppointment);

// Update appointment status
router.patch("/:id/status", authProtect, appointmentController.updateStatus);

// Check-in patient (appointmet id)
router.post("/:id/check-in", appointmentController.checkIn);

// Complete appointment
router.post("/:id/complete", appointmentController.completeAppointment);

// Cancel appointment
router.post("/:id/cancel", appointmentController.cancelAppointment  );

// Reschedule appointment
router.post("/:id/reschedule", appointmentController.rescheduleAppointment);

// Delete appointment permanently (admin only)
router.delete("/:id", authProtect, appointmentController.deleteAppointment);

// Get single appointment by ID
router.get("/:phone", appointmentController.getAppointmentsByPhone);
export default router;
