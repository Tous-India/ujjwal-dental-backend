import { Router } from "express";
import * as labOrderController from "./labOrder.controller.js";
import { authProtect } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * LAB ORDER ROUTES
 * Base path: /api/lab-orders  (admin-only)
 */

router.get("/", authProtect, labOrderController.getAllLabOrders);
router.post("/", authProtect, labOrderController.createLabOrder);
router.get("/:id", authProtect, labOrderController.getLabOrderById);
router.patch("/:id", authProtect, labOrderController.updateLabOrder);
router.post("/:id/payment", authProtect, labOrderController.recordLabOrderPayment);
router.patch("/:id/archive", authProtect, labOrderController.archiveLabOrder);
router.patch("/:id/unarchive", authProtect, labOrderController.unarchiveLabOrder);

export default router;
