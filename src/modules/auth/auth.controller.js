import jwt from "jsonwebtoken";
import crypto from "crypto";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import User from "../users/user.model.js";
import Patient from "../patients/patient.model.js";
import { sendEmail } from "../../utils/email.js";
import { fireWhatsApp } from "../../utils/whatsapp.js";

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
/**
 * RETIRED: legacy EMAIL-based patient OTP login.
 *
 * Removed from service because it was strictly weaker than the login it sat
 * beside, on a portal holding real medical records:
 *   - stored the OTP in PLAINTEXT (patient.otp.code)
 *   - no attempt cap -- a 6-digit code could be brute-forced
 *   - no rate limiting -- anyone could spam a patient's inbox
 *   - leaked account enumeration via a 404 "Patient not found"
 * It was also unusable for most patients, who have no email on file.
 *
 * Superseded by the WhatsApp OTP flow (POST /api/patients/auth/request-otp and
 * /verify-otp), which is hashed, rate limited, attempt capped and
 * non-enumerating.
 *
 * Answers 410 Gone rather than being deleted outright: a removed route would
 * fall through to the generic 404 handler, which is indistinguishable from a
 * typo. 410 tells any lingering client -- a cached JS bundle, a webview, a
 * bookmarked call -- exactly what happened and where to go instead.
 *
 * NOTE: the password login (/api/auth/patient/login-password) is deliberately
 * untouched and still works. It is the transition fallback.
 */
const retiredEmailOtpEndpoint = (req, res) =>
  res.status(410).json({
    success: false,
    message:
      "Email OTP login has been retired. Please log in with the code sent to your WhatsApp, or use your password.",
  });

export const patientLogin = retiredEmailOtpEndpoint;
export const verifyOtp = retiredEmailOtpEndpoint;
export const resendOtp = retiredEmailOtpEndpoint;


/**
 * @desc    Verify OTP for patient (email-based)
 * @route   POST /api/auth/patient/verify-otp
 * @access  Public
 */


/**
 * @desc    Patient login with password
 * @route   POST /api/auth/patient/login-password
 * @access  Public
 */
export const patientLoginPassword = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return ApiResponse.error(
      res,
      "Please provide your phone number or email, and password",
      400
    );
  }

  const trimmed = identifier.trim();
  const isPhone = /^[6-9]\d{9}$/.test(trimmed);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  if (!isPhone && !isEmail) {
    return ApiResponse.error(
      res,
      "Please enter a valid 10-digit phone number or email address",
      400
    );
  }

  // Find patient by phone or email — exact match only (no partial/regex)
  const query = isPhone
    ? { phone: trimmed }
    : { email: trimmed.toLowerCase() };

  const patient = await Patient.findOne(query).select("+password");

  // Use a single generic message for not-found / wrong-password
  // to avoid leaking whether an account exists (account enumeration).
  if (!patient) {
    return ApiResponse.error(res, "Invalid credentials", 401);
  }

  // Check if patient is active. Return the same generic message as other
  // failures (no account enumeration); record the real reason server-side only.
  if (!patient.isActive) {
    console.warn(`[Patient Login] Blocked - deactivated account (id: ${patient._id})`);
    return ApiResponse.error(res, "Invalid credentials", 401);
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
    return ApiResponse.error(res, "Invalid credentials", 401);
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
// ===========================================
// PATIENT AUTHENTICATION (WHATSAPP OTP)
// ===========================================

/**
 * Identical success payload for every request-otp call.
 *
 * Returned whether or not the phone belongs to a registered patient, and
 * whether or not a send actually happened. Anything that varied by existence
 * -- status code, message, or response time -- would turn this endpoint into a
 * "is this number a patient here?" oracle against real medical records.
 */
const OTP_REQUEST_GENERIC =
  "If this number is registered with us, you'll receive a login code on WhatsApp within a minute. Didn't receive it? Please check the number, or call us at +91-9467776028.";

/**
 * @desc    Request a WhatsApp login OTP
 * @route   POST /api/patients/auth/request-otp
 * @access  Public
 */
export const requestPatientLoginOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body || {};

  const trimmed = String(phone || "").trim();
  // Format validation is safe to report -- it reveals nothing about who is
  // registered, only that the input wasn't a phone number at all.
  if (!/^[6-9]\d{9}$/.test(trimmed)) {
    return ApiResponse.error(res, "Please enter a valid 10-digit phone number", 400);
  }

  const patient = await Patient.findOne({ phone: trimmed }).select(
    "+loginOtp.codeHash +loginOtp.expiresAt +loginOtp.attempts +loginOtp.lastSentAt +loginOtp.sendCount +loginOtp.windowStartedAt"
  );

  // Unregistered, or deactivated: same generic success, nothing sent.
  if (!patient || !patient.isActive) {
    if (patient && !patient.isActive) {
      console.warn(`[Patient OTP] Blocked - deactivated account (id: ${patient._id})`);
    }
    return ApiResponse.success(res, { otpSent: true }, OTP_REQUEST_GENERIC);
  }

  // Rate limiting. This IS surfaced to the caller, deliberately: a genuine
  // patient tapping "Resend" needs to know to wait. It only ever reveals that
  // *someone* recently requested a code for this number -- which an attacker
  // could equally cause themselves -- and never confirms registration, since
  // an unregistered number returns the generic success above before reaching
  // this point.
  const gate = patient.canSendLoginOtp();
  if (!gate.allowed) {
    const message =
      gate.reason === "cooldown"
        ? `Please wait ${gate.retryAfterSec} second${gate.retryAfterSec === 1 ? "" : "s"} before requesting another code.`
        : "Too many code requests. Please try again later, or log in with your password.";
    return ApiResponse.error(res, message, 429, { retryAfterSec: gate.retryAfterSec });
  }

  const code = await patient.generateLoginOtp();
  await patient.save();

  // Fire-and-forget, matching every other dispatch in the app -- a WhatsApp
  // outage must never block or fail a login request.
  fireWhatsApp(patient.phone, "patient_login_otp", { otp: code }, patient.name);

  return ApiResponse.success(res, { otpSent: true }, OTP_REQUEST_GENERIC);
});

/**
 * @desc    Verify a WhatsApp login OTP and issue a patient session
 * @route   POST /api/patients/auth/verify-otp
 * @access  Public
 */
export const verifyPatientLoginOtp = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body || {};

  const trimmed = String(phone || "").trim();
  const submitted = String(otp || "").trim();

  if (!trimmed || !submitted) {
    return ApiResponse.error(res, "Please provide your phone number and the code", 400);
  }

  const patient = await Patient.findOne({ phone: trimmed }).select(
    "+loginOtp.codeHash +loginOtp.expiresAt +loginOtp.attempts +loginOtp.lastSentAt +loginOtp.sendCount +loginOtp.windowStartedAt"
  );

  // Same generic failure for unknown/inactive/no-code-outstanding -- never
  // distinguishes "wrong code" from "no such patient".
  const GENERIC_INVALID = "That code is invalid or has expired. Please request a new one.";

  if (!patient || !patient.isActive) {
    return ApiResponse.error(res, GENERIC_INVALID, 400);
  }

  const result = await patient.verifyLoginOtp(submitted);

  if (!result.ok) {
    // Persist attempts/lock state -- verifyLoginOtp mutates but never saves.
    await patient.save();

    if (result.reason === "locked") {
      return ApiResponse.error(
        res,
        "Too many incorrect attempts. That code is no longer valid -- please request a new one.",
        400
      );
    }
    if (result.reason === "mismatch") {
      return ApiResponse.error(
        res,
        `Incorrect code. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? "" : "s"} remaining.`,
        400,
        { attemptsRemaining: result.attemptsRemaining }
      );
    }
    return ApiResponse.error(res, GENERIC_INVALID, 400);
  }

  // Single-use: destroy the code immediately on success.
  patient.clearLoginOtp();
  await patient.save();

  // SAME token generation + cookie as the password login, so everything
  // downstream (patientProtect, the portal, refresh) is unchanged.
  const token = generateToken({
    id: patient._id,
    type: "patient",
  });

  res.cookie("patient_token", token, COOKIE_OPTIONS);

  const patientData = {
    _id: patient._id,
    name: patient.name,
    phone: patient.phone,
    email: patient.email,
    hasMembership: patient.hasMembership,
  };

  return ApiResponse.success(res, { patient: patientData, token }, "Logged in successfully");
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
