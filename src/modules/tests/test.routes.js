import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as testController from "./test.controller.js";
import { authProtect } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * TEST ROUTES
 * Base path: /api/tests
 *
 * Two types of data:
 * 1. Test Master - Catalog of available tests (X-ray, OPG, CBCT, etc.)
 * 2. Test Instance - Actual test ordered for a patient
 */

// ==================== TEST MASTER (Catalog) ====================

// Get all test types (catalog) - Admin/Staff
router.get("/master", authProtect, testController.getAllTestTypes);

// Get single test type - Admin/Staff
router.get("/master/:id", authProtect, testController.getTestTypeById);

// Create new test type (Admin)
router.post("/master", authProtect, checkPermission("lab", "create"), testController.createTestType);

// Update test type (Admin)
router.patch("/master/:id", authProtect, checkPermission("lab", "edit"), testController.updateTestType);

// Delete (deactivate) test type (Admin)
router.delete("/master/:id", authProtect, checkPermission("lab", "delete"), testController.deleteTestType);

// ==================== TEST INSTANCES (Patient Tests) ====================

// Get all test instances (Admin)
router.get("/", authProtect, testController.getAllTests);

// Get single test instance
router.get("/:id", authProtect, testController.getTestById);

// Order test for patient (Admin)
router.post("/", authProtect, checkPermission("lab", "create"), testController.createTest);

// Update test instance (Admin)
router.patch("/:id", authProtect, checkPermission("lab", "edit"), testController.updateTest);

// Update test status (Admin)
router.patch("/:id/status", authProtect, checkPermission("lab", "edit"), testController.updateTestStatus);

// Mark test as completed (Admin)
router.post("/:id/complete", authProtect, checkPermission("lab", "edit"), testController.completeTest);

// Cancel test (Admin)
router.post("/:id/cancel", authProtect, checkPermission("lab", "edit"), testController.cancelTest);

// Link report to test (Admin)
router.post("/:id/link-report", authProtect, checkPermission("lab", "edit"), testController.linkReport);

export default router;
