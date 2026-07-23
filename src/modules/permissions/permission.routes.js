import { Router } from "express";
import * as permissionController from "./permission.controller.js";
import { authProtect, restrictTo } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * PERMISSION ROUTES
 * Base path: /api/permissions
 */

// Any authenticated staff user -- their own role's permissions only, drives
// the dynamic sidebar/route guards for every role, not just admin.
router.get("/mine", authProtect, permissionController.getMyPermissions);

// Admin-only: the full matrix + editing it.
router.get("/", authProtect, restrictTo("admin"), permissionController.getAllPermissions);
router.patch("/:role/:module", authProtect, restrictTo("admin"), permissionController.updatePermission);

export default router;
