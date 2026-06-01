import { Router } from "express";
import * as clinicController from "./clinic.controller.js";
import authProtect, { adminOnly } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * CLINIC ROUTES
 * Base path: /api/clinics
 * Access: Public (read - used by public booking + patient portal), Admin (write)
 */

// Get all clinics (public - for appointment booking)
router.get("/", clinicController.getAllClinics);

// Create new clinic (Admin only)
router.post("/", authProtect, adminOnly, clinicController.createClinic);

// Update clinic (Admin only)
router.patch("/:id", authProtect, adminOnly, clinicController.updateClinic);

// Soft delete (deactivate) clinic (Admin only)
router.delete("/:id", authProtect, adminOnly, clinicController.removeClinic);

// Hard delete (permanent) clinic (Admin only)
router.delete("/:id/permanent", authProtect, adminOnly, clinicController.permanentDeleteClinic);

// Get single clinic by ID
// router.get('/:id', clinicController.getClinicById);

// Get available slots for a clinic on a specific date
// router.get('/:id/slots', clinicController.getAvailableSlots);

// Update clinic operating hours (Admin only)
// router.patch('/:id/hours', clinicController.updateOperatingHours);

// Add holiday to clinic (Admin only)
// router.post('/:id/holidays', clinicController.addHoliday);

// Remove holiday from clinic (Admin only)
// router.delete('/:id/holidays/:holidayId', clinicController.removeHoliday);

export default router;
