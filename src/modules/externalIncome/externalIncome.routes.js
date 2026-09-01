import { Router } from "express";
import { authProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
import * as ctrl from "./externalIncome.controller.js";

const router = Router();

/**
 * EXTERNAL INCOME ROUTES
 * Base path: /api/external-income
 * All routes require admin authentication (authProtect) and are gated
 * by the "external_income" permission module.
 */

// Staff list for doctor dropdown — view permission is sufficient
router.get("/staff", authProtect, checkPermission("external_income", "view"), ctrl.getStaffList);

// Stats (must come before /:id to avoid route conflict)
router.get("/stats", authProtect, checkPermission("external_income", "view"), ctrl.getExternalIncomeStats);

// Export CSV / PDF — must be before /:id
router.get("/export", authProtect, checkPermission("external_income", "view"), ctrl.exportExternalIncome);

// List
router.get("/", authProtect, checkPermission("external_income", "view"), ctrl.getExternalIncomes);

// Create
router.post("/", authProtect, checkPermission("external_income", "create"), ctrl.createExternalIncome);

// Update (cannot change recordedBy or update a voided record)
router.put("/:id", authProtect, checkPermission("external_income", "edit"), ctrl.updateExternalIncome);

// Void (soft-delete, requires voidReason)
router.post("/:id/void", authProtect, checkPermission("external_income", "delete"), ctrl.voidExternalIncome);

export default router;
