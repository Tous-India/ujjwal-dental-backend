import { Router } from "express";
import * as reportController from "./report.controller.js";
import { authProtect, anyAuth, patientSelfOrAdmin } from "../../middlewares/auth.middleware.js";
import { uploadSingle, uploadMultiple } from "../../middlewares/upload.middleware.js";

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

// Get all reports (with filters) - staff/admin (PHI: never public)
router.get("/", authProtect, reportController.getAllReports);

// Get report by report number - staff/admin (no per-record ownership check)
router.get("/number/:reportNumber", authProtect, reportController.getReportByNumber);

// Get single report by ID
router.get("/:id", anyAuth, reportController.getReportById);

// Upload new report (up to 10 files, each with its own description) - Admin
router.post("/", authProtect, uploadMultiple("files", 10), reportController.uploadReport);

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

// Get all reports for a patient - admin/staff or the patient themselves
router.get("/patient/:patientId", anyAuth, patientSelfOrAdmin, reportController.getPatientReports);

// Get patient reports by category - admin/staff or the patient themselves
router.get("/patient/:patientId/category/:category", anyAuth, patientSelfOrAdmin, reportController.getPatientReportsByCategory);

export default router;
