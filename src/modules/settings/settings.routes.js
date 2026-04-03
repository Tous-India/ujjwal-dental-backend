import express from "express";
import { authProtect, adminOnly } from "../../middlewares/auth.middleware.js";
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

// All routes below require authentication and admin role
router.use(authProtect, adminOnly);

/**
 * @route   PATCH /api/settings/fees
 * @desc    Update fee settings (admin only)
 */
router.patch("/fees", updateFeeSettings);

// ============================================
// PROFILE ROUTES
// ============================================

/**
 * @route   GET /api/settings/profile
 * @desc    Get current user's profile
 */
router.get("/profile", getProfile);

/**
 * @route   PATCH /api/settings/profile
 * @desc    Update profile (name, email, phone)
 */
router.patch("/profile", updateProfile);

/**
 * @route   POST /api/settings/profile/picture
 * @desc    Upload profile picture
 */
router.post("/profile/picture", uploadSingle("profilePicture"), uploadProfilePicture);

/**
 * @route   PATCH /api/settings/profile/password
 * @desc    Change password
 */
router.patch("/profile/password", changePassword);

// ============================================
// CLINIC ROUTES
// ============================================

/**
 * @route   GET /api/settings/clinic
 * @desc    Get clinic settings
 */
router.get("/clinic", getClinicSettings);

/**
 * @route   PATCH /api/settings/clinic
 * @desc    Update clinic settings
 */
router.patch("/clinic", updateClinicSettings);

// ============================================
// NOTIFICATION ROUTES
// ============================================

/**
 * @route   GET /api/settings/notifications
 * @desc    Get notification preferences
 */
router.get("/notifications", getNotificationPreferences);

/**
 * @route   PATCH /api/settings/notifications
 * @desc    Update notification preferences
 */
router.patch("/notifications", updateNotificationPreferences);

// ============================================
// SYSTEM CONFIG ROUTES
// ============================================

/**
 * @route   GET /api/settings/system
 * @desc    Get system configuration
 */
router.get("/system", getSystemConfig);

/**
 * @route   PATCH /api/settings/system
 * @desc    Update system configuration
 */
router.patch("/system", updateSystemConfig);

export default router;
