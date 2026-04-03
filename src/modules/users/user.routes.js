import { Router } from "express";
import * as userController from "./user.controller.js";
const router = Router();
import authProtect from "../../middlewares/auth.middleware.js";
/**
 * USER ROUTES (Admin/Staff Management)
 * Base path: /api/users
 * Access: Admin only
 */

// Get all users (admin/staff list)
router.get("/", userController.getAllUsers);

// Get current logged in user profile
router.get("/me", authProtect, userController.getMe);

// Update current user profile
router.patch("/me", userController.updateMe);

// Change current user password
router.patch("/me/password", userController.changePassword);

// Get single user by ID
router.get("/:id", userController.getUserById);

// Create new user (admin/staff)
router.post("/", userController.createUser);

// Update user by ID
router.patch("/:id", userController.updateUser);

// Delete (deactivate) user
router.delete("/:id", authProtect, userController.deleteUser);

// Permanently delete user
router.delete("/:id/permanent", authProtect, userController.permanentDeleteUser);

export default router;
