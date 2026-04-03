import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import SystemSettings from "./settings.model.js";
import User from "../users/user.model.js";
import bcrypt from "bcryptjs";
import { deleteFromCloudinary } from "../../middlewares/upload.middleware.js";

/**
 * SETTINGS CONTROLLER
 *
 * Handles:
 * - Profile settings (name, email, phone, password, picture)
 * - Clinic settings (clinic info, address, working hours)
 * - Notification preferences
 * - System configuration
 */

// ============================================
// PROFILE SETTINGS
// ============================================

/**
 * @desc    Get current user's profile
 * @route   GET /api/settings/profile
 * @access  Private (Admin)
 */
export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  ApiResponse.success(res, { user }, "Profile fetched successfully");
});

/**
 * @desc    Update profile (name, email, phone)
 * @route   PATCH /api/settings/profile
 * @access  Private (Admin)
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const { name, email, phone } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Check if email is already taken by another user
  if (email && email.toLowerCase() !== user.email) {
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: user._id },
    });
    if (existingUser) {
      return ApiResponse.error(res, "Email already in use", 400);
    }
  }

  // Check if phone is already taken by another user
  if (phone && phone !== user.phone) {
    const existingUser = await User.findOne({
      phone,
      _id: { $ne: user._id },
    });
    if (existingUser) {
      return ApiResponse.error(res, "Phone number already in use", 400);
    }
  }

  // Update fields
  if (name) user.name = name;
  if (email) user.email = email.toLowerCase();
  if (phone) user.phone = phone;

  await user.save();

  ApiResponse.success(res, { user }, "Profile updated successfully");
});

/**
 * @desc    Upload profile picture
 * @route   POST /api/settings/profile/picture
 * @access  Private (Admin)
 */
export const uploadProfilePicture = asyncHandler(async (req, res) => {
  if (!req.uploadedFile) {
    return ApiResponse.error(res, "File is required", 400);
  }

  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Delete old profile picture from Cloudinary if exists
  if (user.profilePicture?.publicId) {
    try {
      await deleteFromCloudinary(user.profilePicture.publicId);
    } catch (error) {
      console.error("Failed to delete old profile picture:", error);
    }
  }

  // Update with new picture
  user.profilePicture = {
    url: req.uploadedFile.url,
    publicId: req.uploadedFile.publicId,
  };

  await user.save();

  ApiResponse.success(res, { user }, "Profile picture uploaded successfully");
});

/**
 * @desc    Change password
 * @route   PATCH /api/settings/profile/password
 * @access  Private (Admin)
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Validation
  if (!currentPassword || !newPassword) {
    return ApiResponse.error(
      res,
      "Current password and new password are required",
      400
    );
  }

  if (newPassword.length < 6) {
    return ApiResponse.error(
      res,
      "New password must be at least 6 characters",
      400
    );
  }

  if (newPassword !== confirmPassword) {
    return ApiResponse.error(res, "Passwords do not match", 400);
  }

  // Get user with password
  const user = await User.findById(req.user._id).select("+password");

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Verify current password
  const isMatch = await user.comparePassword(currentPassword);

  if (!isMatch) {
    return ApiResponse.error(res, "Current password is incorrect", 400);
  }

  // Update password (will be hashed by pre-save middleware)
  user.password = newPassword;
  await user.save();

  ApiResponse.success(res, null, "Password changed successfully");
});

// ============================================
// CLINIC SETTINGS
// ============================================

/**
 * @desc    Get clinic settings
 * @route   GET /api/settings/clinic
 * @access  Private (Admin)
 */
export const getClinicSettings = asyncHandler(async (req, res) => {
  const settings = await SystemSettings.getSettings();

  ApiResponse.success(
    res,
    {
      clinicName: settings.clinicName,
      clinicPhone: settings.clinicPhone,
      clinicEmail: settings.clinicEmail,
      address: settings.address,
      workingHours: settings.workingHours,
    },
    "Clinic settings fetched successfully"
  );
});

/**
 * @desc    Update clinic settings
 * @route   PATCH /api/settings/clinic
 * @access  Private (Admin)
 */
export const updateClinicSettings = asyncHandler(async (req, res) => {
  const { clinicName, clinicPhone, clinicEmail, address, workingHours } =
    req.body;

  const settings = await SystemSettings.getSettings();

  // Update fields
  if (clinicName !== undefined) settings.clinicName = clinicName;
  if (clinicPhone !== undefined) settings.clinicPhone = clinicPhone;
  if (clinicEmail !== undefined) settings.clinicEmail = clinicEmail;

  if (address) {
    settings.address = {
      ...settings.address,
      ...address,
    };
  }

  if (workingHours) {
    settings.workingHours = {
      ...settings.workingHours,
      ...workingHours,
    };
  }

  settings.updatedBy = req.user._id;
  await settings.save();

  ApiResponse.success(
    res,
    {
      clinicName: settings.clinicName,
      clinicPhone: settings.clinicPhone,
      clinicEmail: settings.clinicEmail,
      address: settings.address,
      workingHours: settings.workingHours,
    },
    "Clinic settings updated successfully"
  );
});

// ============================================
// NOTIFICATION PREFERENCES
// ============================================

/**
 * @desc    Get notification preferences
 * @route   GET /api/settings/notifications
 * @access  Private (Admin)
 */
export const getNotificationPreferences = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Return default preferences if not set
  const preferences = user.notificationPreferences || {
    email: { appointments: true, payments: true, systemAlerts: true },
    sms: { appointments: false, payments: false, systemAlerts: false },
  };

  ApiResponse.success(
    res,
    { preferences },
    "Notification preferences fetched successfully"
  );
});

/**
 * @desc    Update notification preferences
 * @route   PATCH /api/settings/notifications
 * @access  Private (Admin)
 */
export const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const { email, sms } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Initialize if not exists
  if (!user.notificationPreferences) {
    user.notificationPreferences = {
      email: { appointments: true, payments: true, systemAlerts: true },
      sms: { appointments: false, payments: false, systemAlerts: false },
    };
  }

  // Update email preferences
  if (email) {
    user.notificationPreferences.email = {
      ...user.notificationPreferences.email,
      ...email,
    };
  }

  // Update SMS preferences
  if (sms) {
    user.notificationPreferences.sms = {
      ...user.notificationPreferences.sms,
      ...sms,
    };
  }

  await user.save();

  ApiResponse.success(
    res,
    { preferences: user.notificationPreferences },
    "Notification preferences updated successfully"
  );
});

// ============================================
// FEE SETTINGS
// ============================================

/**
 * @desc    Get fee settings (OPD fees) - PUBLIC
 * @route   GET /api/settings/fees
 * @access  Public
 */
export const getFeeSettings = asyncHandler(async (req, res) => {
  const settings = await SystemSettings.getSettings();

  ApiResponse.success(
    res,
    {
      fees: settings.feeSettings || {
        opdFeeRegular: 300,
        opdFeeEmergency: 500,
        consultationFee: 500,
        requirePaymentBeforeBooking: true,
      },
    },
    "Fee settings fetched successfully"
  );
});

/**
 * @desc    Update fee settings
 * @route   PATCH /api/settings/fees
 * @access  Private (Admin)
 */
export const updateFeeSettings = asyncHandler(async (req, res) => {
  const { opdFeeRegular, opdFeeEmergency, consultationFee, requirePaymentBeforeBooking } =
    req.body;

  const settings = await SystemSettings.getSettings();

  // Initialize if not exists
  if (!settings.feeSettings) {
    settings.feeSettings = {
      opdFeeRegular: 300,
      opdFeeEmergency: 500,
      consultationFee: 500,
      requirePaymentBeforeBooking: true,
    };
  }

  // Update fields
  if (opdFeeRegular !== undefined) settings.feeSettings.opdFeeRegular = opdFeeRegular;
  if (opdFeeEmergency !== undefined) settings.feeSettings.opdFeeEmergency = opdFeeEmergency;
  if (consultationFee !== undefined) settings.feeSettings.consultationFee = consultationFee;
  if (requirePaymentBeforeBooking !== undefined) {
    settings.feeSettings.requirePaymentBeforeBooking = requirePaymentBeforeBooking;
  }

  settings.updatedBy = req.user._id;
  await settings.save();

  ApiResponse.success(
    res,
    { fees: settings.feeSettings },
    "Fee settings updated successfully"
  );
});

// ============================================
// SYSTEM CONFIGURATION
// ============================================

/**
 * @desc    Get system configuration
 * @route   GET /api/settings/system
 * @access  Private (Admin)
 */
export const getSystemConfig = asyncHandler(async (req, res) => {
  const settings = await SystemSettings.getSettings();

  ApiResponse.success(
    res,
    {
      config: settings.systemConfig,
      backup: settings.backupSettings,
    },
    "System configuration fetched successfully"
  );
});

/**
 * @desc    Update system configuration
 * @route   PATCH /api/settings/system
 * @access  Private (Admin)
 */
export const updateSystemConfig = asyncHandler(async (req, res) => {
  const { timezone, currency, language, dateFormat, timeFormat, backupSettings } =
    req.body;

  const settings = await SystemSettings.getSettings();

  // Update system config
  if (timezone !== undefined) settings.systemConfig.timezone = timezone;
  if (currency !== undefined) settings.systemConfig.currency = currency;
  if (language !== undefined) settings.systemConfig.language = language;
  if (dateFormat !== undefined) settings.systemConfig.dateFormat = dateFormat;
  if (timeFormat !== undefined) settings.systemConfig.timeFormat = timeFormat;

  // Update backup settings
  if (backupSettings) {
    settings.backupSettings = {
      ...settings.backupSettings,
      ...backupSettings,
    };
  }

  settings.updatedBy = req.user._id;
  await settings.save();

  ApiResponse.success(
    res,
    {
      config: settings.systemConfig,
      backup: settings.backupSettings,
    },
    "System configuration updated successfully"
  );
});
