import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as treatmentPageController from "./treatmentPage.controller.js";
import authProtect from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * TREATMENT PAGE CMS ROUTES
 * Base path: /api/cms/treatments
 *
 * ═══════════════════════════════════════════════════════════════
 * ROUTE SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * PUBLIC ROUTES (No auth required):
 * ---------------------------------
 * GET    /                     - List all published treatment pages
 * GET    /search               - Search treatment pages
 * GET    /:slug                - Get page by slug (published only)
 * POST   /:id/view             - Increment view count
 *
 * ADMIN ROUTES (Auth required):
 * -----------------------------
 * GET    /all                  - List all pages (including unpublished)
 * GET    /id/:id               - Get page by ID
 * POST   /                     - Create treatment page
 * PATCH  /:id                  - Update treatment page
 * DELETE /:id                  - Delete treatment page
 * PATCH  /:id/publish          - Publish page
 * PATCH  /:id/unpublish        - Unpublish page
 *
 * SECTION MANAGEMENT (Admin):
 * ---------------------------
 * POST   /:id/sections         - Add section
 * PATCH  /:id/sections/reorder - Reorder sections
 * PATCH  /:id/sections/:sectionId - Update section
 * DELETE /:id/sections/:sectionId - Delete section
 *
 * FAQ MANAGEMENT (Admin):
 * -----------------------
 * POST   /:id/faqs             - Add FAQ
 * PATCH  /:id/faqs/:faqId      - Update FAQ
 * DELETE /:id/faqs/:faqId      - Delete FAQ
 *
 * PROCEDURE STEPS (Admin):
 * ------------------------
 * PATCH  /:id/procedure-steps  - Update procedure steps
 *
 * ═══════════════════════════════════════════════════════════════
 */

// ========== PUBLIC ROUTES ==========

// Get all published pages
router.get("/", treatmentPageController.getPublishedPages);

// Search treatment pages
router.get("/search", treatmentPageController.searchPages);

// ========== ADMIN ROUTES (Auth Required) ==========

// Get all pages (admin) - must be before /:slug
router.get("/all", authProtect, treatmentPageController.getAllPages);

// Get page by ID (admin) - must be before /:slug
router.get("/id/:id", authProtect, treatmentPageController.getPageById);

// Create treatment page
router.post("/", authProtect, checkPermission("blogs", "create"), treatmentPageController.createPage);

// ========== PUBLIC ROUTES (continued) ==========

// Increment view count (public)
router.post("/:id/view", treatmentPageController.incrementViewCount);

// Get page by slug (public) - must be after /all, /id/:id, /search
router.get("/:slug", treatmentPageController.getPageBySlug);

// ========== ADMIN ROUTES (continued) ==========

// Update treatment page
router.patch("/:id", authProtect, checkPermission("blogs", "edit"), treatmentPageController.updatePage);

// Delete treatment page
router.delete("/:id", authProtect, checkPermission("blogs", "delete"), treatmentPageController.deletePage);

// Publish/Unpublish
router.patch("/:id/publish", authProtect, checkPermission("blogs", "edit"), treatmentPageController.publishPage);
router.patch("/:id/unpublish", authProtect, checkPermission("blogs", "edit"), treatmentPageController.unpublishPage);

// ========== SECTION MANAGEMENT ==========

// Add section
router.post("/:id/sections", authProtect, checkPermission("blogs", "edit"), treatmentPageController.addSection);

// Reorder sections (must be before /:id/sections/:sectionId)
router.patch(
  "/:id/sections/reorder",
  authProtect, checkPermission("blogs", "edit"),
  treatmentPageController.reorderSections
);

// Update section
router.patch(
  "/:id/sections/:sectionId",
  authProtect, checkPermission("blogs", "edit"),
  treatmentPageController.updateSection
);

// Delete section
router.delete(
  "/:id/sections/:sectionId",
  authProtect, checkPermission("blogs", "delete"),
  treatmentPageController.deleteSection
);

// ========== FAQ MANAGEMENT ==========

// Add FAQ
router.post("/:id/faqs", authProtect, checkPermission("blogs", "edit"), treatmentPageController.addFaq);

// Update FAQ
router.patch("/:id/faqs/:faqId", authProtect, checkPermission("blogs", "edit"), treatmentPageController.updateFaq);

// Delete FAQ
router.delete("/:id/faqs/:faqId", authProtect, checkPermission("blogs", "delete"), treatmentPageController.deleteFaq);

// ========== PROCEDURE STEPS ==========

// Update procedure steps
router.patch(
  "/:id/procedure-steps",
  authProtect, checkPermission("blogs", "edit"),
  treatmentPageController.updateProcedureSteps
);

export default router;
