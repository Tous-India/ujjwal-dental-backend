import { Router } from "express";
import * as labController from "./lab.controller.js";
import { authProtect } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * LAB ROUTES
 * Base path: /api/labs  (admin-only)
 */

router.get("/", authProtect, labController.getAllLabs);
router.post("/", authProtect, labController.createLab);
router.get("/:id", authProtect, labController.getLabById);
router.patch("/:id", authProtect, labController.updateLab);
router.delete("/:id", authProtect, labController.deleteLab); // soft delete (inactive)

export default router;
