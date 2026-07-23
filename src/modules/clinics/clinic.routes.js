import { Router } from "express";
import * as clinicController from "./clinic.controller.js";
import authProtect from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

const router = Router();

/**
 * CLINIC ROUTES
 * Base path: /api/clinics
 * Access: Public (read - used by public booking + patient portal), Admin (write)
 */

// Get all clinics (public - for appointment booking)
router.get("/", clinicController.getAllClinics);

// Create new clinic (Admin / Clinic Manager)
router.post("/", authProtect, checkPermission("clinics", "create"), clinicController.createClinic);

// Update clinic (Admin / Clinic Manager)
router.patch("/:id", authProtect, checkPermission("clinics", "edit"), clinicController.updateClinic);

// Soft delete (deactivate) clinic (Admin / Clinic Manager)
router.delete("/:id", authProtect, checkPermission("clinics", "delete"), clinicController.removeClinic);

// Hard delete (permanent) clinic (Admin / Clinic Manager)
router.delete("/:id/permanent", authProtect, checkPermission("clinics", "delete"), clinicController.permanentDeleteClinic);

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
