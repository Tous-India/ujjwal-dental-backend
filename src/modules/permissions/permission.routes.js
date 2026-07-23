import { Router } from "express";
import * as permissionController from "./permission.controller.js";
import { authProtect, restrictTo } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * PERMISSION ROUTES
 * Base path: /api/permissions (admin-only)
 */

router.get("/", authProtect, restrictTo("admin"), permissionController.getAllPermissions);
router.patch("/:role/:module", authProtect, restrictTo("admin"), permissionController.updatePermission);

export default router;
