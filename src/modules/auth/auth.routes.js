import { Router } from "express";
import * as authController from "./auth.controller.js";
import { authProtect, patientProtect } from "../../middlewares/auth.middleware.js";
import { authLimiter } from "../../middlewares/rateLimit.middleware.js";

const router = Router();

/**
 * AUTH ROUTES
 * Base path: /api/auth
 *
 * Public routes:
 * - POST /login           - Admin/Staff login
 * - POST /patient/login   - Patient login (send OTP)
 * - POST /patient/verify-otp - Verify patient OTP
 * - POST /patient/resend-otp - Resend OTP
 * - POST /forgot-password - Request password reset
 * - POST /reset-password  - Reset password with token
 * - POST /refresh-token   - Refresh access token
 *
 * Private routes (Admin):
 * - GET  /me              - Get current admin user
 * - POST /logout          - Logout admin
 * - POST /change-password - Change password
 *
 * Private routes (Patient):
 * - GET /patient/me       - Get current patient
 */

// ===========================================
// PUBLIC ROUTES
// ===========================================

// Admin/Staff login with email & password
router.post("/login", authLimiter, authController.login);

// Patient login - sends OTP to phone
router.post("/patient/login", authLimiter, authController.patientLogin);

// Patient login with password (given by doctor)
router.post("/patient/login-password", authLimiter, authController.patientLoginPassword);

// Patient verify OTP
router.post("/patient/verify-otp", authLimiter, authController.verifyOtp);

// Resend OTP
router.post("/patient/resend-otp", authLimiter, authController.resendOtp);

// Forgot password - sends reset link
router.post("/forgot-password", authLimiter, authController.forgotPassword);

// Reset password with token
router.post("/reset-password", authController.resetPassword);

// Refresh access token
router.post("/refresh-token", authController.refreshToken);

// ===========================================
// PRIVATE ROUTES - ADMIN
// ===========================================

// Get current logged in admin user
router.get("/me", authProtect, authController.getMe);

// Logout admin user
router.post("/logout", authProtect, authController.logout);

// Change password (when logged in)
router.post("/change-password", authProtect, authController.changePassword);

// ===========================================
// PRIVATE ROUTES - PATIENT
// ===========================================

// Get current logged in patient
router.get("/patient/me", patientProtect, authController.getPatientMe);

// Change password (when logged in as patient)
router.post("/patient/change-password", patientProtect, authController.patientChangePassword);

// Logout patient
router.post("/patient/logout", patientProtect, authController.patientLogout);

export default router;
