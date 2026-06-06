import jwt from "jsonwebtoken";
import crypto from "crypto";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import User from "../users/user.model.js";
import Patient from "../patients/patient.model.js";
import { sendEmail, sendOtpEmail } from "../../utils/email.js";

/**
 * AUTH CONTROLLER
 *
 * Handles all authentication operations:
 * - Admin/Staff login with email & password
 * - Patient login with email & OTP (passwordless)
 * - Patient login with email & password (optional)
 * - Token refresh
 * - Password reset
 */

// Helper function to generate JWT token
const generateToken = (payload, expiresIn = "7d") => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

// ===========================================
// ADMIN/STAFF AUTHENTICATION
// ===========================================

/**
 * @desc    Admin/Staff login
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return ApiResponse.error(res, "Please provide email and password", 400);
  }

  // Find user by email (include password for comparison)
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password",
  );

  // Use a single generic message for not-found / inactive / wrong-password
  // to avoid leaking whether an account exists (account enumeration).
  if (!user) {
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Check if user is active. Return the same generic message as other failures
  // (no account enumeration); record the real reason server-side only.
  if (!user.isActive) {
    console.warn(`[Admin Login] Blocked - deactivated account (id: ${user._id})`);
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Compare password
  const isPasswordMatch = await user.comparePassword(password);

  if (!isPasswordMatch) {
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Update last login time (use findByIdAndUpdate to avoid pre-save hook)
  await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

  // Generate token
  const token = generateToken({
    id: user._id,
    role: user.role,
    type: "admin",
  });

  res.cookie("admin_token", token, COOKIE_OPTIONS);

  // Return user data (without password)
  const userData = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };

  ApiResponse.success(res, { user: userData, token }, "Login successful");
});

/**
 * @desc    Get current logged in user
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = asyncHandler(async (req, res) => {
  // User is already attached to req by auth middleware
  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  ApiResponse.success(res, { user }, "User data retrieved");
});

/**
 * @desc    Logout user (clear refresh token)
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = asyncHandler(async (req, res) => {
  // Clear refresh token if using refresh token mechanism
  if (req.user && req.user._id) {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
  }

  res.clearCookie("admin_token", { ...COOKIE_OPTIONS, maxAge: 0 });

  ApiResponse.success(res, null, "Logged out successfully");
});

/**
 * @desc    Forgot password - Send reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return ApiResponse.error(res, "Please provide email", 400);
  }

  // Look up the account: admin/staff (User) first, then patient. The reset
  // link differs by area so admins land on the admin reset page while patients
  // land on the public one.
  const normalizedEmail = email.toLowerCase();
  let user = await User.findOne({ email: normalizedEmail });
  let resetPath = "/admin/reset-password";

  if (!user) {
    user = await Patient.findOne({ email: normalizedEmail });
    resetPath = "/reset-password";
  }

  if (!user) {
    // Don't reveal if the account exists or not
    return ApiResponse.success(
      res,
      null,
      "If email exists, a reset link will be sent",
    );
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString("hex");

  // Hash token and save to database
  user.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes

  await user.save();

  // Send email with reset link
  const resetLink = `${process.env.FRONTEND_URL}${resetPath}?token=${resetToken}`;
  const resetEmailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
      <p>Hello ${user.name},</p>
      <p>We received a request to reset your password. Click the button below to set a new password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background: #1976d2; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">Reset Password</a>
      </div>
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #1976d2; font-size: 13px;">${resetLink}</p>
      <p>This link is valid for <strong>30 minutes</strong>. After that, you will need to request a new one.</p>
      <p style="color: #f44336; font-size: 13px;">If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Staff Portal</p>
    </div>
  `;
  const resetEmailText = `Hello ${user.name}, Reset your password using this link: ${resetLink}. This link is valid for 30 minutes. If you did not request this, please ignore this email.`;

  const emailResult = await sendEmail({
    to: user.email,
    subject: "Password Reset - Ujjwal Dental Clinic",
    text: resetEmailText,
    html: resetEmailHtml,
  });

  if (!emailResult.success) {
    console.error("Failed to send password reset email:", emailResult.error);
  }

  ApiResponse.success(res, null, "If email exists, a reset link will be sent");
});

/**
 * @desc    Reset password
 * @route   POST /api/auth/reset-password
 * @access  Public (with reset token)
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return ApiResponse.error(res, "Please provide token and new password", 400);
  }

  // Validate password strength: min 10 chars, at least one letter and one number
  if (
    newPassword.length < 10 ||
    !/[A-Za-z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  ) {
    return ApiResponse.error(
      res,
      "Password must be at least 10 characters and include at least one letter and one number",
      400,
    );
  }

  // Hash the token to compare with stored hash
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Find the account with a valid reset token — check admin/staff first, then
  // patients, so this single endpoint serves both flows.
  let user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    user = await Patient.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });
  }

  if (!user) {
    return ApiResponse.error(res, "Invalid or expired reset token", 400);
  }

  // Update password
  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save();

  ApiResponse.success(res, null, "Password reset successful");
});

/**
 * @desc    Change password (when logged in)
 * @route   POST /api/auth/change-password
 * @access  Private
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return ApiResponse.error(
      res,
      "Please provide current and new password",
      400,
    );
  }

  // Get user with password
  const user = await User.findById(req.user._id).select("+password");

  // Check current password
  const isMatch = await user.comparePassword(currentPassword);

  if (!isMatch) {
    return ApiResponse.error(res, "Current password is incorrect", 401);
  }

  // Validate new password strength: min 10 chars, at least one letter and one number
  if (
    newPassword.length < 10 ||
    !/[A-Za-z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  ) {
    return ApiResponse.error(
      res,
      "New password must be at least 10 characters and include at least one letter and one number",
      400,
    );
  }

  // Update password
  user.password = newPassword;
  await user.save();

  ApiResponse.success(res, null, "Password changed successfully");
});

/**
 * @desc    Change password for a logged-in patient
 * @route   POST /api/auth/patient/change-password
 * @access  Private (Patient)
 */
export const patientChangePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return ApiResponse.error(
      res,
      "Please provide current and new password",
      400,
    );
  }

  // Fetch patient including the (normally hidden) password hash
  const patient = await Patient.findById(req.patient._id).select("+password");

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // OTP-only patients may have no password set yet — direct them to the
  // reset flow rather than failing on a current-password mismatch.
  if (!patient.password) {
    return ApiResponse.error(
      res,
      "No password is set on your account. Use 'Forgot Password' on the login page to set one.",
      400,
    );
  }

  // Verify current password
  const isMatch = await patient.comparePassword(currentPassword);
  if (!isMatch) {
    return ApiResponse.error(res, "Current password is incorrect", 401);
  }

  // Validate new password strength: min 10 chars, at least one letter and one number
  if (
    newPassword.length < 10 ||
    !/[A-Za-z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  ) {
    return ApiResponse.error(
      res,
      "New password must be at least 10 characters and include at least one letter and one number",
      400,
    );
  }

  // The pre-save hook hashes the password
  patient.password = newPassword;
  await patient.save();

  ApiResponse.success(res, null, "Password updated successfully");
});

// ===========================================
// PATIENT AUTHENTICATION (OTP BASED)
// ===========================================

/**
 * @desc    Patient login - Send OTP via Email
 * @route   POST /api/auth/patient/login
 * @access  Public
 */
export const patientLogin = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return ApiResponse.error(res, "Please provide email address", 400);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return ApiResponse.error(res, "Please provide a valid email address", 400);
  }

  // Find patient by email (case-insensitive)
  let patient = await Patient.findOne({ email: email.toLowerCase() });

  if (!patient) {
    return ApiResponse.error(
      res,
      "Patient not found. Connect to the doctor.",
      404,
    );
  }

  // Check if patient is active
  if (!patient.isActive) {
    return ApiResponse.error(res, "Your account has been deactivated", 401);
  }

  // Generate OTP
  const otp = patient.generateOTP();
  await patient.save();

  // Send OTP via email
  const emailResult = await sendOtpEmail(patient.email, otp, patient.name);

  if (!emailResult.success) {
    console.error("Failed to send OTP email:", emailResult.error);
  }

  ApiResponse.success(
    res,
    { email: patient.email, otpSent: true },
    "OTP sent to your email address",
  );
});

/**
 * @desc    Verify OTP for patient (email-based)
 * @route   POST /api/auth/patient/verify-otp
 * @access  Public
 */
export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return ApiResponse.error(res, "Please provide email and OTP", 400);
  }

  // Find patient by email
  const patient = await Patient.findOne({ email: email.toLowerCase() });

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Verify OTP
  const isValid = patient.verifyOTP(otp);

  if (!isValid) {
    return ApiResponse.error(res, "Invalid or expired OTP", 400);
  }

  // Clear OTP after successful verification
  patient.clearOTP();
  await patient.save();

  // Generate token
  const token = generateToken({
    id: patient._id,
    type: "patient",
  });

  res.cookie("patient_token", token, COOKIE_OPTIONS);

  // Return patient data
  const patientData = {
    _id: patient._id,
    name: patient.name,
    phone: patient.phone,
    email: patient.email,
    hasMembership: patient.hasMembership,
  };

  ApiResponse.success(
    res,
    { patient: patientData, token },
    "OTP verified successfully",
  );
});

/**
 * @desc    Patient login with password
 * @route   POST /api/auth/patient/login-password
 * @access  Public
 */
export const patientLoginPassword = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return ApiResponse.error(res, "Please provide email and password", 400);
  }

  // Find patient by email (include password for comparison)
  const patient = await Patient.findOne({ email: email.toLowerCase() }).select("+password");

  // Use a single generic message for not-found / wrong-password
  // to avoid leaking whether an account exists (account enumeration).
  if (!patient) {
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Check if patient is active. Return the same generic message as other
  // failures (no account enumeration); record the real reason server-side only.
  if (!patient.isActive) {
    console.warn(`[Patient Login] Blocked - deactivated account (id: ${patient._id})`);
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Check if patient has a password set
  if (!patient.password) {
    return ApiResponse.error(
      res,
      "Password login not enabled for your account. Please use OTP login or contact the clinic to set a password.",
      400
    );
  }

  // Compare password
  const isPasswordMatch = await patient.comparePassword(password);

  if (!isPasswordMatch) {
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Generate token
  const token = generateToken({
    id: patient._id,
    type: "patient",
  });

  res.cookie("patient_token", token, COOKIE_OPTIONS);

  // Return patient data
  const patientData = {
    _id: patient._id,
    name: patient.name,
    phone: patient.phone,
    email: patient.email,
    hasMembership: patient.hasMembership,
  };

  ApiResponse.success(
    res,
    { patient: patientData, token },
    "Login successful"
  );
});

/**
 * @desc    Resend OTP via Email
 * @route   POST /api/auth/patient/resend-otp
 * @access  Public
 */
export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return ApiResponse.error(res, "Please provide email address", 400);
  }

  // Find patient by email
  const patient = await Patient.findOne({ email: email.toLowerCase() });

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Generate new OTP
  const otp = patient.generateOTP();
  await patient.save();

  // Send OTP via email
  const emailResult = await sendOtpEmail(patient.email, otp, patient.name);

  if (!emailResult.success) {
    console.error("Failed to resend OTP email:", emailResult.error);
  }

  ApiResponse.success(res, { email: patient.email, otpSent: true }, "OTP resent successfully");
});

/**
 * @desc    Get current logged in patient
 * @route   GET /api/auth/patient/me
 * @access  Private (Patient)
 */
export const getPatientMe = asyncHandler(async (req, res) => {
  const patient = await Patient.findById(req.patient._id).populate(
    "preferredClinic",
    "name code",
  );

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  ApiResponse.success(res, { patient }, "Patient data retrieved");
});

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh-token
 * @access  Public (with refresh token)
 */
/**
 * @desc    Patient logout (clear cookie)
 * @route   POST /api/auth/patient/logout
 * @access  Private (Patient)
 */
export const patientLogout = asyncHandler(async (req, res) => {
  res.clearCookie("patient_token", { ...COOKIE_OPTIONS, maxAge: 0 });
  ApiResponse.success(res, null, "Logged out successfully");
});

export const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    return ApiResponse.error(res, "Refresh token is required", 400);
  }

  try {
    // Verify refresh token
    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    );

    // Generate new access token
    const newAccessToken = generateToken(
      {
        id: decoded.id,
        role: decoded.role,
        type: decoded.type,
      },
      "15m", // Short lived access token
    );

    ApiResponse.success(
      res,
      { accessToken: newAccessToken },
      "Token refreshed",
    );
  } catch (error) {
    return ApiResponse.error(res, "Invalid refresh token", 401);
  }
});
