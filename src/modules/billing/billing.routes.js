import { Router } from "express";
import * as billingController from "./billing.controller.js";
import { authProtect, anyAuth, patientProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

const router = Router();

/**
 * BILLING/INVOICE ROUTES
 * Base path: /api/billing
 *
 * Invoices contain:
 * - OPD fees
 * - Treatment charges
 * - Test charges
 * - Membership purchases
 * - Discounts (from membership)
 */

// ==================== INVOICE CRUD ====================

// Get all invoices (with filters) - Admin
router.get("/invoices", authProtect, billingController.getAllInvoices);

// Get billing statistics - Admin
router.get("/stats", authProtect, billingController.getBillingStats);

// Get overdue invoices - Admin
router.get("/overdue", authProtect, billingController.getOverdueInvoices);

// Export the currently-filtered invoice list as a PDF statement - Admin
router.get("/export", authProtect, billingController.exportInvoices);

// Get invoice by invoice number
router.get("/invoices/number/:invoiceNumber", authProtect, billingController.getInvoiceByNumber);

// Get the logged-in patient's own invoices (token-derived, IDOR-safe).
// MUST be registered before "/invoices/:id" so "my-invoices" isn't treated as an id.
router.get("/invoices/my-invoices", patientProtect, billingController.getMyInvoices);

// Get the logged-in patient's payment history derived from invoices.amountPaid (token-derived, IDOR-safe).
// MUST be registered before "/invoices/:id".
router.get("/invoices/my-payment-history", patientProtect, billingController.getMyPaymentHistory);

// Get the logged-in patient's own billing summary / outstanding balance (token-derived, IDOR-safe).
router.get("/my-summary", patientProtect, billingController.getMyBillingSummary);

// Get single invoice by ID
router.get("/invoices/:id", anyAuth, billingController.getInvoiceById);

// Create new invoice - Admin
router.post("/invoices", authProtect, checkPermission("billing", "create"), billingController.createInvoice);

// Update invoice (add items, update details) - Admin
router.patch("/invoices/:id", authProtect, checkPermission("billing", "edit"), billingController.updateInvoice);

// ==================== INVOICE ITEMS ====================

// Add item to invoice - Admin
router.post("/invoices/:id/items", authProtect, checkPermission("billing", "edit"), billingController.addInvoiceItem);

// Remove item from invoice - Admin
router.delete("/invoices/:id/items/:itemId", authProtect, checkPermission("billing", "edit"), billingController.removeInvoiceItem);

// Delete invoice permanently - Admin
router.delete("/invoices/:id", authProtect, checkPermission("billing", "delete"), billingController.deleteInvoice);

// ==================== INVOICE ACTIONS ====================

// Issue invoice (finalize and send to patient) - Admin
router.post("/invoices/:id/issue", authProtect, checkPermission("billing", "edit"), billingController.issueInvoice);

// Cancel invoice - Admin
router.post("/invoices/:id/cancel", authProtect, checkPermission("billing", "edit"), billingController.cancelInvoice);
router.post("/invoices/:id/void", authProtect, checkPermission("billing", "delete"), billingController.voidInvoice);
router.patch("/invoices/:id/correct", authProtect, checkPermission("billing", "edit"), billingController.correctInvoice);

// Record payment on invoice - Admin
router.post("/invoices/:id/payment", authProtect, checkPermission("payments", "create"), billingController.recordPayment);

// Download invoice as PDF
router.get("/invoices/:id/pdf", anyAuth, billingController.downloadInvoicePdf);

// ==================== PATIENT BILLING ====================

// Get patient's pending invoices
router.get("/patient/:patientId/pending", authProtect, billingController.getPatientPendingInvoices);

// Get patient's total pending amount (computed fresh from grandTotal - amountPaid)
router.get("/patient/:patientId/pending-amount", authProtect, billingController.getPatientPendingAmount);

// Get patient's unpaid/partial invoices with fresh balanceDue (for collect-payment flow)
router.get("/patient/:patientId/unpaid-invoices", authProtect, billingController.getPatientUnpaidInvoices);

export default router;
