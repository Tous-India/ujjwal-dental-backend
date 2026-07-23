import express from "express";
import { authProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
import { uploadSingle } from "../../middlewares/upload.middleware.js";
import {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  changePassword,
  getClinicSettings,
  updateClinicSettings,
  getNotificationPreferences,
  updateNotificationPreferences,
  getSystemConfig,
  updateSystemConfig,
  getFeeSettings,
  updateFeeSettings,
} from "./settings.controller.js";

const router = express.Router();

// ============================================
// PUBLIC ROUTES (no auth required)
// ============================================

/**
 * @route   GET /api/settings/fees
 * @desc    Get fee settings (OPD fees) - PUBLIC
 */
router.get("/fees", getFeeSettings);

// ============================================
// PROTECTED ROUTES (admin only)
// ============================================

// All routes below require authentication; previously a single blanket
// adminOnly gate, now per-action checkPermission -- behaviorally identical
// today since only "admin" has settings=true in the seeded matrix (every
// other role is false across the board), but expressed per action so a
// future settings.view-only role becomes possible without another migration.
router.use(authProtect);

/**
 * @route   PATCH /api/settings/fees
 * @desc    Update fee settings (admin only)
 */
router.patch("/fees", checkPermission("settings", "edit"), updateFeeSettings);

// ============================================
// PROFILE ROUTES
// ============================================

/**
 * @route   GET /api/settings/profile
 * @desc    Get current user's profile
 */
router.get("/profile", checkPermission("settings", "view"), getProfile);

/**
 * @route   PATCH /api/settings/profile
 * @desc    Update profile (name, email, phone)
 */
router.patch("/profile", checkPermission("settings", "edit"), updateProfile);

/**
 * @route   POST /api/settings/profile/picture
 * @desc    Upload profile picture
 */
router.post("/profile/picture", checkPermission("settings", "edit"), uploadSingle("profilePicture"), uploadProfilePicture);

/**
 * @route   PATCH /api/settings/profile/password
 * @desc    Change password
 */
router.patch("/profile/password", checkPermission("settings", "edit"), changePassword);

// ============================================
// CLINIC ROUTES
// ============================================

/**
 * @route   GET /api/settings/clinic
 * @desc    Get clinic settings
 */
router.get("/clinic", checkPermission("settings", "view"), getClinicSettings);

/**
 * @route   PATCH /api/settings/clinic
 * @desc    Update clinic settings
 */
router.patch("/clinic", checkPermission("settings", "edit"), updateClinicSettings);

// ============================================
// NOTIFICATION ROUTES
// ============================================

/**
 * @route   GET /api/settings/notifications
 * @desc    Get notification preferences
 */
router.get("/notifications", checkPermission("settings", "view"), getNotificationPreferences);

/**
 * @route   PATCH /api/settings/notifications
 * @desc    Update notification preferences
 */
router.patch("/notifications", checkPermission("settings", "edit"), updateNotificationPreferences);

// ============================================
// SYSTEM CONFIG ROUTES
// ============================================

/**
 * @route   GET /api/settings/system
 * @desc    Get system configuration
 */
router.get("/system", checkPermission("settings", "view"), getSystemConfig);

/**
 * @route   PATCH /api/settings/system
 * @desc    Update system configuration
 */
router.patch("/system", checkPermission("settings", "edit"), updateSystemConfig);

export default router;
