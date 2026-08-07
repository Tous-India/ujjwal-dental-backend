import { checkPermission } from "../../middlewares/permission.middleware.js";
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
router.get("/summary-stats", authProtect, paymentController.getPaymentSummaryStats);

// Get daily collection report - Admin
router.get("/daily-collection", authProtect, paymentController.getDailyCollection);

// Get payment by payment number
router.get("/number/:paymentNumber", authProtect, paymentController.getPaymentByNumber);

// Export filtered payments as PDF — must be before /:id to avoid param conflict
router.get("/export/pdf", authProtect, paymentController.exportPaymentsPdf);

// Get single payment by ID
router.get("/:id", anyAuth, paymentController.getPaymentById);

// Record a payment (cash, UPI, card) - Admin
router.post("/", authProtect, checkPermission("payments", "create"), paymentController.createPayment);

// ==================== SPECIALIZED PAYMENTS ====================

// Record OPD payment - Admin
router.post("/opd", authProtect, checkPermission("payments", "create"), paymentController.recordOpdPayment);

// Record membership payment - Admin
router.post("/membership", authProtect, checkPermission("payments", "create"), paymentController.recordMembershipPayment);

// Book a treatment to pay at the clinic (creates a pending payment) - Patient
router.post("/pay-at-clinic", patientProtect, paymentController.payAtClinic);

// ==================== RAZORPAY INTEGRATION ====================

// Create Razorpay order
router.post("/razorpay/create-order", optionalAuth, paymentController.createRazorpayOrder);

// Verify Razorpay payment
router.post("/razorpay/verify", optionalAuth, paymentController.verifyRazorpayPayment);

// Razorpay webhook (for async payment updates) - No auth, verified by signature
router.post("/razorpay/webhook", paymentController.razorpayWebhook);

// Manual safety net for a missed webhook: ask Razorpay for a payment link's
// REAL status and reconcile the invoice if it is genuinely paid. Idempotent.
router.post(
  "/verify-razorpay-link/:invoiceId",
  authProtect,
  checkPermission("payments", "edit"),
  paymentController.verifyRazorpayPaymentLink
);

// ==================== DELETE ====================

// Permanently delete a payment - Admin
router.delete("/:id", authProtect, checkPermission("payments", "delete"), paymentController.deletePayment);

// ==================== REFUNDS ====================

// Process refund - Admin
router.post("/:id/refund", authProtect, checkPermission("payments", "edit"), paymentController.processRefund);

// Confirm a manual refund after Razorpay API failure - Admin
router.post("/:id/confirm-manual-refund", authProtect, checkPermission("payments", "edit"), paymentController.confirmManualRefund);

// ==================== PATIENT PAYMENTS ====================

// Get patient's payment summary
router.get("/patient/:patientId/summary", authProtect, paymentController.getPatientPaymentSummary);

// ==================== ADMIN MANUAL PAYMENT ====================

// Record cash/UPI/card payment and auto-settle oldest invoices — Admin
router.post("/admin/record-payment", authProtect, checkPermission("payments", "create"), paymentController.recordAdminPayment);

// Collect payment for a specific invoice — Admin
router.post("/admin/collect", authProtect, checkPermission("payments", "create"), paymentController.collectPayment);

// Reverse an admin-recorded payment — Admin
router.post("/admin/reverse-payment", authProtect, checkPermission("payments", "edit"), paymentController.reverseAdminPayment);

// Create Razorpay order for pending invoice balance — Patient
router.post("/patient/create-pending-order", patientProtect, paymentController.createPendingOrder);

// Verify Razorpay payment and settle against oldest invoices — Patient
router.post("/patient/verify-pending-payment", patientProtect, paymentController.verifyPendingPayment);

export default router;
