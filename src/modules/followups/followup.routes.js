import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as followUpController from "./followup.controller.js";
import authProtect, { patientProtect } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * FOLLOW-UP REMINDER ROUTES
 * Base path: /api/followups
 */

// Patient: own upcoming reminders (must be before "/:id" patterns)
router.get("/my", patientProtect, followUpController.getMyFollowUps);

// Admin CRUD
router.get("/", authProtect, followUpController.getFollowUps);
router.post("/", authProtect, checkPermission("appointments", "create"), followUpController.createFollowUp);
router.patch("/:id", authProtect, checkPermission("appointments", "edit"), followUpController.updateFollowUp);
router.patch("/:id/done", authProtect, checkPermission("appointments", "edit"), followUpController.markFollowUpDone);
router.patch("/:id/cancel", authProtect, checkPermission("appointments", "edit"), followUpController.cancelFollowUp);

export default router;
