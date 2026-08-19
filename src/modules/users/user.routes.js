import { Router } from "express";
import * as userController from "./user.controller.js";
const router = Router();
import authProtect from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
/**
 * USER ROUTES (Admin/Staff Management)
 * Base path: /api/users
 * Access:
 *   - Authenticated staff/admin: list users, view a user, own profile
 *   - Admin only: create / update / delete users (account & role management)
 */

// Get blog-eligible authors (admin/blog_editor/clinic_manager) — for author select dropdown
router.get("/blog-authors", authProtect, checkPermission("blogs", "view"), userController.getBlogAuthors);

// Get all users (admin/staff list) — authenticated staff/admin
router.get("/", authProtect, userController.getAllUsers);

// Get current logged in user profile
router.get("/me", authProtect, userController.getMe);

// Update current user profile
router.patch("/me", authProtect, userController.updateMe);

// Change current user password
router.patch("/me/password", authProtect, userController.changePassword);

// Get single user by ID — authenticated staff/admin
router.get("/:id", authProtect, userController.getUserById);

// Create new user (admin/staff) — admin only
router.post("/", authProtect, checkPermission("staff", "create"), userController.createUser);

// Update user by ID (incl. role changes) — admin only
router.patch("/:id", authProtect, checkPermission("staff", "edit"), userController.updateUser);

// Delete (deactivate) user — admin only
router.delete("/:id", authProtect, checkPermission("staff", "delete"), userController.deleteUser);

// Permanently delete user — admin only
router.delete("/:id/permanent", authProtect, checkPermission("staff", "delete"), userController.permanentDeleteUser);

export default router;
