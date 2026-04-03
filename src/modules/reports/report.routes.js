import { Router } from "express";
import * as reportController from "./report.controller.js";
import { authProtect, anyAuth } from "../../middlewares/auth.middleware.js";
import { uploadSingle } from "../../middlewares/upload.middleware.js";

const router = Router();

/**
 * REPORT ROUTES
 * Base path: /api/reports
 *
 * Reports are PDF/image files uploaded for patients:
 * - X-ray images
 * - OPG scans
 * - CBCT scans
 * - Lab reports
 * - Treatment plans
 * - Prescriptions
 *
 * Files are stored in Cloudinary
 */

// ==================== REPORT CRUD ====================

// Get all reports (with filters) - Admin
router.get("/",reportController.getAllReports);// authProtect, 

// Get report by report number
router.get("/number/:reportNumber", anyAuth, reportController.getReportByNumber);

// Get single report by ID
router.get("/:id", anyAuth, reportController.getReportById);

// Upload new report (with file) - Admin
router.post("/", authProtect, uploadSingle("file"), reportController.uploadReport);

// Update report details - Admin
router.patch("/:id", authProtect, reportController.updateReport);

// Delete report (soft delete) - Admin
router.delete("/:id", authProtect, reportController.deleteReport);

// ==================== REPORT ACTIONS ====================

// Add tags to report - Admin
router.post("/:id/tags", authProtect, reportController.addTags);

// Toggle report visibility for patient - Admin
router.patch("/:id/visibility", authProtect, reportController.toggleVisibility);

// Replace report file - Admin
router.put("/:id/file", authProtect, uploadSingle("file"), reportController.replaceReportFile);

// Download report (get secure URL)
router.get("/:id/download", anyAuth, reportController.downloadReport);

// ==================== PATIENT REPORTS ====================

// Get all reports for a patient (both admin and patient can access)
router.get("/patient/:patientId", anyAuth, reportController.getPatientReports);

// Get patient reports by category (both admin and patient can access)
router.get("/patient/:patientId/category/:category", anyAuth, reportController.getPatientReportsByCategory);

export default router;
