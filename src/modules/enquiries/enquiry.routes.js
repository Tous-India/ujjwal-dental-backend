import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as enquiryController from "./enquiry.controller.js";
import authProtect from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * ENQUIRY ROUTES
 * Base path: /api/enquiries
 *
 * ═══════════════════════════════════════════════════════════════
 * ROUTE SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * PUBLIC ROUTES (No auth required):
 * ---------------------------------
 * POST   /                     - Submit new enquiry (from treatment page form)
 *
 * ADMIN ROUTES (Auth required):
 * -----------------------------
 * GET    /                     - List all enquiries (with filters)
 * GET    /stats                - Get enquiry statistics
 * GET    /today                - Get today's enquiries
 * GET    /pending-follow-ups   - Get pending follow-ups
 * GET    /treatment/:treatmentId - Get enquiries by treatment
 * GET    /:id                  - Get single enquiry
 * PATCH  /:id                  - Update enquiry
 * PATCH  /:id/status           - Update enquiry status
 * PATCH  /:id/assign           - Assign to staff
 * PATCH  /:id/follow-up        - Schedule follow-up
 * PATCH  /:id/spam             - Mark as spam
 * PATCH  /:id/convert          - Mark as converted to patient
 * POST   /:id/notes            - Add note
 * DELETE /:id                  - Delete enquiry
 *
 * ═══════════════════════════════════════════════════════════════
 */

// ========== PUBLIC ROUTES ==========

// Submit enquiry (no auth required - from public treatment page form)
router.post("/", enquiryController.submitEnquiry);

// ========== PROTECTED ROUTES (Admin) ==========

// Apply auth middleware for all routes below
router.use(authProtect);

// Special routes (must be before /:id to avoid conflicts)
router.get("/stats", enquiryController.getEnquiryStats);
router.get("/today", enquiryController.getTodayEnquiries);
router.get("/pending-follow-ups", enquiryController.getPendingFollowUps);
router.get("/treatment/:treatmentId", enquiryController.getEnquiriesByTreatment);

// CRUD routes
router.get("/", enquiryController.getAllEnquiries);
router.get("/:id", enquiryController.getEnquiryById);
router.patch("/:id", checkPermission("enquiries", "edit"), enquiryController.updateEnquiry);
router.delete("/:id", checkPermission("enquiries", "delete"), enquiryController.deleteEnquiry);

// Status and assignment routes
router.patch("/:id/status", checkPermission("enquiries", "edit"), enquiryController.updateEnquiryStatus);
router.patch("/:id/assign", checkPermission("enquiries", "edit"), enquiryController.assignEnquiry);
router.patch("/:id/follow-up", checkPermission("enquiries", "edit"), enquiryController.scheduleFollowUp);
router.patch("/:id/spam", checkPermission("enquiries", "edit"), enquiryController.markAsSpam);
router.patch("/:id/convert", checkPermission("enquiries", "edit"), enquiryController.markConverted);

// Notes
router.post("/:id/notes", checkPermission("enquiries", "edit"), enquiryController.addNote);

export default router;
