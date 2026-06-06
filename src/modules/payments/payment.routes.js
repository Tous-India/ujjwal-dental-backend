import { Router } from "express";
import * as paymentController from "./payment.controller.js";
import { authProtect, anyAuth, optionalAuth, patientProtect } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * PAYMENT ROUTES
 * Base path: /api/payments
 *
 * Payment methods:
 * - Cash
 * - UPI
 * - Card
 * - Razorpay (online)
 */

// ==================== PAYMENT CRUD ====================

// Get all payments (with filters) - Admin
router.get("/", authProtect, paymentController.getAllPayments);

// Get payment statistics - Admin
router.get("/stats", authProtect, paymentController.getPaymentStats);

// Get daily collection report - Admin
router.get("/daily-collection", authProtect, paymentController.getDailyCollection);

// Get payment by payment number
router.get("/number/:paymentNumber", authProtect, paymentController.getPaymentByNumber);

// Get single payment by ID
router.get("/:id", anyAuth, paymentController.getPaymentById);

// Record a payment (cash, UPI, card) - Admin
router.post("/", authProtect, paymentController.createPayment);

// ==================== SPECIALIZED PAYMENTS ====================

// Record OPD payment - Admin
router.post("/opd", authProtect, paymentController.recordOpdPayment);

// Record membership payment - Admin
router.post("/membership", authProtect, paymentController.recordMembershipPayment);

// Book a treatment to pay at the clinic (creates a pending payment) - Patient
router.post("/pay-at-clinic", patientProtect, paymentController.payAtClinic);

// ==================== RAZORPAY INTEGRATION ====================

// Create Razorpay order
router.post("/razorpay/create-order", optionalAuth, paymentController.createRazorpayOrder);

// Verify Razorpay payment
router.post("/razorpay/verify", optionalAuth, paymentController.verifyRazorpayPayment);

// Razorpay webhook (for async payment updates) - No auth, verified by signature
router.post("/razorpay/webhook", paymentController.razorpayWebhook);

// ==================== DELETE ====================

// Permanently delete a payment - Admin
router.delete("/:id", authProtect, paymentController.deletePayment);

// ==================== REFUNDS ====================

// Process refund - Admin
router.post("/:id/refund", authProtect, paymentController.processRefund);

// ==================== PATIENT PAYMENTS ====================

// Get patient's payment summary
router.get("/patient/:patientId/summary", authProtect, paymentController.getPatientPaymentSummary);

export default router;
