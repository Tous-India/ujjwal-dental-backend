import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as labOrderController from "./labOrder.controller.js";
import { authProtect } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * LAB ORDER ROUTES
 * Base path: /api/lab-orders  (admin-only)
 */

router.get("/", authProtect, labOrderController.getAllLabOrders);
router.post("/", authProtect, checkPermission("lab", "create"), labOrderController.createLabOrder);
router.get("/stats", authProtect, labOrderController.getLabOrderStats);
router.get("/:id", authProtect, labOrderController.getLabOrderById);
router.patch("/:id", authProtect, checkPermission("lab", "edit"), labOrderController.updateLabOrder);
router.post("/:id/payment", authProtect, checkPermission("lab", "edit"), labOrderController.recordLabOrderPayment);
router.patch("/:id/archive", authProtect, checkPermission("lab", "edit"), labOrderController.archiveLabOrder);
router.patch("/:id/unarchive", authProtect, checkPermission("lab", "edit"), labOrderController.unarchiveLabOrder);

export default router;
