import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { notify } from "../../utils/notifyHelper.js";
import Payment from "./payment.model.js";
import Invoice from "../billing/invoice.model.js";
import Patient from "../patients/patient.model.js";
import MembershipPlan from "../memberships/membership.model.js";
import { TreatmentMaster } from "../treatments/treatment.model.js";
import { generateInvoice } from "../billing/invoice.service.js";
import SystemSettings from "../settings/settings.model.js";
import mongoose from "mongoose";
import crypto from "crypto";

/**
 * PAYMENT CONTROLLER
 *
 * Handles:
 * - Payment recording (cash, card, UPI)
 * - Razorpay integration
 * - Refund processing
 */

// ==================== PAYMENT CRUD ====================

/**
 * @desc    Get all payments
 * @route   GET /api/payments?patient=&status=&paymentMode=&from=&to=
 * @access  Admin
 */
export const getAllPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, patient, status, paymentMode, type, clinic, from, to } = req.query;

  // Build query
  const query = {};

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    query.patient = patient;
  }

  if (status) {
    query.status = status;
  }

  if (paymentMode) {
    query.paymentMode = paymentMode;
  }

  if (type) {
    query.type = type;
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    query.clinic = clinic;
  }

  // Date range filter
  if (from || to) {
    query.createdAt = {};
    if (from) {
      query.createdAt.$gte = new Date(from);
    }
    if (to) {
      query.createdAt.$lte = new Date(to);
    }
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate("patient", "name phone")
      .populate("invoice", "invoiceNumber grandTotal")
      .populate("clinic", "name code")
      .populate("receivedBy", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Payment.countDocuments(query),
  ]);

  ApiResponse.paginated(res, payments, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get payment by ID
 * @route   GET /api/payments/:id
 * @access  Admin
 */
export const getPaymentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid payment ID", 400);
  }

  const payment = await Payment.findById(id)
    .populate("patient", "name phone email")
    .populate("invoice", "invoiceNumber grandTotal balanceDue items")
    .populate("appointment")
    .populate("clinic", "name code")
    .populate("receivedBy", "name")
    .populate("refund.refundedBy", "name");

  if (!payment) {
    return ApiResponse.error(res, "Payment not found", 404);
  }

  ApiResponse.success(res, { payment }, "Payment fetched successfully");
});

/**
 * @desc    Get payment by payment number
 * @route   GET /api/payments/number/:paymentNumber
 * @access  Admin
 */
export const getPaymentByNumber = asyncHandler(async (req, res) => {
  const { paymentNumber } = req.params;

  const payment = await Payment.findOne({ paymentNumber })
    .populate("patient", "name phone email")
    .populate("invoice", "invoiceNumber grandTotal")
    .populate("clinic", "name code");

  if (!payment) {
    return ApiResponse.error(res, "Payment not found", 404);
  }

  ApiResponse.success(res, { payment }, "Payment fetched successfully");
});

/**
 * @desc    Record a payment (cash, UPI, card at clinic)
 * @route   POST /api/payments
 * @access  Admin
 */
export const createPayment = asyncHandler(async (req, res) => {
  const { patient, invoice, appointment, clinic, amount, paymentMode, type, referenceNumber, notes } = req.body;

  // Validation
  if (!patient || !clinic || !amount || !paymentMode) {
    return ApiResponse.error(res, "Patient, clinic, amount and payment mode are required", 400);
  }

  if (amount <= 0) {
    return ApiResponse.error(res, "Amount must be greater than 0", 400);
  }

  // Verify patient exists
  const patientDoc = await Patient.findById(patient);
  if (!patientDoc) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // If invoice provided, verify it exists and check balance
  if (invoice) {
    const invoiceDoc = await Invoice.findById(invoice);
    if (!invoiceDoc) {
      return ApiResponse.error(res, "Invoice not found", 404);
    }

    if (invoiceDoc.status === "cancelled") {
      return ApiResponse.error(res, "Cannot record payment for cancelled invoice", 400);
    }

    if (invoiceDoc.paymentStatus === "paid") {
      return ApiResponse.error(res, "Invoice is already fully paid", 400);
    }

    if (amount > invoiceDoc.balanceDue) {
      return ApiResponse.error(
        res,
        `Payment amount (${amount}) exceeds invoice balance due (${invoiceDoc.balanceDue})`,
        400
      );
    }
  }

  // Create payment
  const payment = await Payment.create({
    patient,
    invoice,
    appointment,
    clinic,
    amount,
    paymentMode,
    type: type || (invoice ? "invoice_payment" : "advance"),
    status: "paid",
    paidAt: new Date(),
    referenceNumber,
    receivedBy: req.user?._id,
    notes,
  });

  // Invoice update is handled by the post-save middleware in payment.model.js

  // Populate for response
  const populatedPayment = await Payment.findById(payment._id)
    .populate("patient", "name phone")
    .populate("invoice", "invoiceNumber grandTotal balanceDue paymentStatus")
    .populate("clinic", "name code");

  ApiResponse.created(res, { payment: populatedPayment }, "Payment recorded successfully");
});

/**
 * @desc    Record OPD fee payment
 * @route   POST /api/payments/opd
 * @access  Admin
 */
export const recordOpdPayment = asyncHandler(async (req, res) => {
  const { patient, clinic, appointment, amount, paymentMode, referenceNumber, notes } = req.body;

  // Validation
  if (!patient || !clinic || !amount || !paymentMode) {
    return ApiResponse.error(res, "Patient, clinic, amount and payment mode are required", 400);
  }

  // Create OPD payment
  const payment = await Payment.create({
    patient,
    clinic,
    appointment,
    amount,
    paymentMode,
    type: "opd_fee",
    status: "paid",
    paidAt: new Date(),
    referenceNumber,
    receivedBy: req.user?._id,
    notes: notes || "OPD Fee",
  });

  // Populate for response
  const populatedPayment = await Payment.findById(payment._id)
    .populate("patient", "name phone")
    .populate("clinic", "name code");

  ApiResponse.created(res, { payment: populatedPayment }, "OPD payment recorded successfully");
});

/**
 * @desc    Record membership payment
 * @route   POST /api/payments/membership
 * @access  Admin
 */
export const recordMembershipPayment = asyncHandler(async (req, res) => {
  const { patient, clinic, amount, paymentMode, referenceNumber, planName, notes } = req.body;

  // Validation
  if (!patient || !clinic || !amount || !paymentMode) {
    return ApiResponse.error(res, "Patient, clinic, amount and payment mode are required", 400);
  }

  // Create membership payment
  const payment = await Payment.create({
    patient,
    clinic,
    amount,
    paymentMode,
    type: "membership",
    status: "paid",
    paidAt: new Date(),
    referenceNumber,
    receivedBy: req.user?._id,
    notes: notes || `Membership: ${planName || "Plan"}`,
  });

  // Populate for response
  const populatedPayment = await Payment.findById(payment._id)
    .populate("patient", "name phone")
    .populate("clinic", "name code");

  ApiResponse.created(res, { payment: populatedPayment }, "Membership payment recorded successfully");
});

// ==================== TREATMENT PAYMENTS (PATIENT PORTAL) ====================

/**
 * Resolve a treatment's authoritative price and the patient's server-verified
 * membership discount. The client NEVER decides the price or the discount —
 * both are read from the database here so a tampered request cannot underpay.
 *
 * @returns {Promise<{treatment, baseAmount, discountPercent, finalAmount}>}
 * @throws  {Error} carrying a .statusCode for not-found / invalid states
 */
const resolveTreatmentCharge = async (treatmentId, patientDoc) => {
  if (!treatmentId || !mongoose.Types.ObjectId.isValid(treatmentId)) {
    const err = new Error("A valid treatmentId is required");
    err.statusCode = 400;
    throw err;
  }

  const treatment = await TreatmentMaster.findById(treatmentId);
  if (!treatment || !treatment.isActive) {
    const err = new Error("Treatment not found");
    err.statusCode = 404;
    throw err;
  }

  const baseAmount = treatment.price;
  if (!baseAmount || baseAmount <= 0) {
    const err = new Error("This treatment does not have a valid price set");
    err.statusCode = 400;
    throw err;
  }

  // Trust ONLY the patient's stored, currently-active membership for the discount.
  const discountPercent = patientDoc?.hasMembership ? patientDoc.currentDiscount || 0 : 0;
  const finalAmount = Math.max(1, Math.round(baseAmount * (1 - discountPercent / 100)));

  return { treatment, baseAmount, discountPercent, finalAmount };
};

/**
 * Build the notes string for a treatment payment record.
 */
const treatmentNotes = ({ treatment, baseAmount, discountPercent }) =>
  discountPercent > 0
    ? `Treatment: ${treatment.name} (${discountPercent}% member discount on ₹${baseAmount})`
    : `Treatment: ${treatment.name}`;

/**
 * @desc    Record a "pay at clinic" treatment booking (pending payment)
 * @route   POST /api/payments/pay-at-clinic
 * @access  Patient
 */
export const payAtClinic = asyncHandler(async (req, res) => {
  const { treatmentId } = req.body;

  // patientProtect guarantees req.patient
  let charge;
  try {
    charge = await resolveTreatmentCharge(treatmentId, req.patient);
  } catch (err) {
    return ApiResponse.error(res, err.message, err.statusCode || 400);
  }

  const payment = await Payment.create({
    patient: req.patient._id,
    amount: charge.finalAmount,
    paymentMode: "cash", // intended to be collected as cash/card at the clinic
    type: "treatment",
    status: "pending", // shows up as a pending payment for admin to collect
    treatmentType: charge.treatment._id,
    treatmentName: charge.treatment.name,
    notes: `Pay at clinic — ${treatmentNotes(charge)}`,
  });

  ApiResponse.created(
    res,
    {
      payment,
      amount: charge.finalAmount,
      treatmentName: charge.treatment.name,
    },
    "Treatment booked. Please pay at the clinic."
  );

  notify({
    recipientId: req.patient._id,
    recipientModel: "Patient",
    type: "payment_received",
    title: "Treatment Booked",
    message: `Your treatment "${charge.treatment.name}" is booked. Please pay ₹${charge.finalAmount} at the clinic.`,
    sendEmail: false,
  });
});

// ==================== RAZORPAY INTEGRATION ====================

/**
 * @desc    Create Razorpay order
 * @route   POST /api/payments/razorpay/create-order
 * @access  Admin / Patient
 */
export const createRazorpayOrder = asyncHandler(async (req, res) => {
  // NOTE: the client-sent `amount` is intentionally ignored. The authoritative
  // price is always resolved server-side below to prevent underpayment.
  const { invoiceId, patient, clinic, type, isOnlineBooking, planId, isEmergency, treatmentId } = req.body;

  // For online booking/membership/treatment, patient and clinic are optional
  // (treatment uses the authenticated patient + server-side pricing).
  // For other payments, both are required
  if (!isOnlineBooking && type !== "membership" && type !== "treatment" && (!patient || !clinic)) {
    return ApiResponse.error(res, "Patient and clinic are required", 400);
  }

  // Check if Razorpay is configured
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return ApiResponse.error(res, "Razorpay is not configured", 500);
  }

  // ---- Resolve the authoritative amount server-side (never trust the client) ----
  let amount;
  let membershipPlan = null;
  let treatmentCharge = null;
  // For treatment payments, link the authenticated patient (fallback to body).
  const treatmentPatientId = req.patient?._id || patient;

  if (type === "treatment") {
    const patientDoc = treatmentPatientId ? await Patient.findById(treatmentPatientId) : null;
    try {
      treatmentCharge = await resolveTreatmentCharge(treatmentId, patientDoc);
    } catch (err) {
      return ApiResponse.error(res, err.message, err.statusCode || 400);
    }
    amount = treatmentCharge.finalAmount;
  } else if (type === "membership") {
    if (!planId) {
      return ApiResponse.error(res, "planId is required for membership payment", 400);
    }
    membershipPlan = await MembershipPlan.findById(planId);
    if (!membershipPlan) {
      return ApiResponse.error(res, "Membership plan not found", 404);
    }
    amount = membershipPlan.price;
  } else if (type === "opd_fee" || type === "consultation") {
    const settings = await SystemSettings.getSettings();
    const fees = settings?.feeSettings || {};
    if (type === "consultation") {
      amount = fees.consultationFee;
    } else {
      amount = isEmergency ? fees.opdFeeEmergency : fees.opdFeeRegular;
    }
  } else if (invoiceId) {
    const invoiceDoc = await Invoice.findById(invoiceId);
    if (!invoiceDoc) {
      return ApiResponse.error(res, "Invoice not found", 404);
    }
    amount = invoiceDoc.balanceDue;
  } else {
    return ApiResponse.error(res, "Unable to determine payment amount for this request", 400);
  }

  // Reject if the authoritative price is missing or zero
  if (!amount || amount <= 0) {
    return ApiResponse.error(res, "Could not determine a valid payment amount", 400);
  }

  // Dynamic import of Razorpay
  const Razorpay = (await import("razorpay")).default;

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  // Create Razorpay order
  const receipt = `rcpt_${Date.now()}`;
  let order;
  try {
    order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise (positive integer)
      currency: "INR",
      receipt,
    });
  } catch (err) {
    // Log the FULL Razorpay error (not a generic message) for diagnosis.
    console.error("[CreateOrder] Razorpay order creation failed:", {
      message: err?.message,
      statusCode: err?.statusCode,
      description: err?.error?.description,
      code: err?.error?.code,
    });
    return ApiResponse.error(
      res,
      err?.error?.description || err?.message || "Failed to create payment order",
      err?.statusCode || 502,
    );
  }

  // Create pending payment record with the SERVER-derived amount
  // For online booking, patient will be linked later after successful payment
  const paymentData = {
    invoice: invoiceId,
    ...(clinic && { clinic }),
    amount,
    paymentMode: "razorpay",
    type: type || (invoiceId ? "invoice_payment" : "advance"),
    status: "pending",
    razorpayOrderId: order.id,
    razorpayDetails: {
      receipt,
    },
  };

  // Only add patient if provided
  if (patient) {
    paymentData.patient = patient;
  }

  // Annotate membership purchases with the plan name
  if (membershipPlan) {
    paymentData.notes = `Membership: ${membershipPlan.name}`;
  }

  // Annotate treatment payments and link patient + treatment now
  if (treatmentCharge) {
    paymentData.type = "treatment";
    paymentData.treatmentType = treatmentCharge.treatment._id;
    paymentData.treatmentName = treatmentCharge.treatment.name;
    paymentData.notes = treatmentNotes(treatmentCharge);
    if (treatmentPatientId) {
      paymentData.patient = treatmentPatientId;
    }
  }

  const payment = await Payment.create(paymentData);

  ApiResponse.success(
    res,
    {
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      paymentId: payment._id,
      key_id: process.env.RAZORPAY_KEY_ID,
    },
    "Razorpay order created successfully"
  );
});

/**
 * @desc    Verify Razorpay payment
 * @route   POST /api/payments/razorpay/verify
 * @access  Admin / Patient
 */
export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

  // Validation
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return ApiResponse.error(res, "Missing Razorpay payment details", 400);
  }

  // Verify signature
  if (!process.env.RAZORPAY_KEY_SECRET) {
    console.error("[VerifyPayment] RAZORPAY_KEY_SECRET is not configured!");
    return ApiResponse.error(res, "Payment verification not configured on server", 500);
  }

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  console.log(`[VerifyPayment] Order: ${razorpay_order_id}, Expected sig match: ${expectedSignature === razorpay_signature}`);

  if (expectedSignature !== razorpay_signature) {
    // Update payment as failed
    if (paymentId) {
      const payment = await Payment.findById(paymentId);
      if (payment) {
        await payment.markAsFailed("SIGNATURE_INVALID", "Payment signature verification failed");
      }
    }
    return ApiResponse.error(res, "Invalid payment signature", 400);
  }

  // Find and update payment
  let payment;
  if (paymentId) {
    payment = await Payment.findById(paymentId);
  } else {
    payment = await Payment.findByRazorpayOrderId(razorpay_order_id);
  }

  if (!payment) {
    return ApiResponse.error(res, "Payment record not found", 404);
  }

  // Confirm the amount actually paid matches what we expected at order creation.
  // The Razorpay order is the authoritative source; compare amount_paid (paise)
  // against the server-derived amount stored on the Payment doc. This catches
  // partial captures and any tampering between order creation and capture.
  try {
    const Razorpay = (await import("razorpay")).default;
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const expectedPaise = Math.round(payment.amount * 100);

    if (Number(order.amount_paid) !== expectedPaise) {
      await payment.markAsFailed(
        "AMOUNT_MISMATCH",
        `Order amount_paid ${order.amount_paid} != expected ${expectedPaise}`
      );
      return ApiResponse.error(res, "Payment amount mismatch", 400);
    }
  } catch (err) {
    console.error("[VerifyPayment] order amount verification failed:", err.message);
    return ApiResponse.error(res, "Could not verify payment amount", 502);
  }

  // Update payment details
  payment.razorpayPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  await payment.markAsPaid();

  console.log(`[VerifyPayment] Payment ${payment._id} marked as paid. Status: ${payment.status}`);

  // Auto-create an invoice for a successful treatment payment (once). The
  // amount is already the membership-discounted amount, so we don't re-apply a
  // discount. We create it unpaid, link it to the payment, then save the
  // payment — the payment post-save middleware records the amount onto the
  // invoice, marking it paid. The !payment.invoice guard prevents duplicates.
  if (payment.type === "treatment" && payment.treatmentType && payment.patient && !payment.invoice) {
    try {
      const invoice = await generateInvoice({
        patient: payment.patient,
        clinic: payment.clinic || undefined,
        items: [
          {
            itemType: "treatment",
            description: payment.treatmentName || "Treatment",
            unitPrice: payment.amount,
          },
        ],
        amountPaid: 0,
        paymentMethod: "razorpay",
        applyMembershipDiscount: false,
      });
      payment.invoice = invoice._id;
      await payment.save(); // post-save records the payment → invoice marked paid
    } catch (err) {
      console.error("Auto-invoice for treatment payment failed:", err.message);
    }
  }

  // Invoice update is handled by the post-save middleware

  const populatedPayment = await Payment.findById(payment._id)
    .populate("patient", "name phone")
    .populate("invoice", "invoiceNumber grandTotal balanceDue paymentStatus");

  ApiResponse.success(res, { payment: populatedPayment }, "Payment verified successfully");

  if (payment.patient) {
    notify({ recipientId: payment.patient, recipientModel: "Patient", type: "payment_received", title: "Payment Received", message: `Your payment of ₹${payment.amount} has been received successfully.`, sendEmail: true });
  }
});

/**
 * @desc    Razorpay webhook handler
 * @route   POST /api/payments/razorpay/webhook
 * @access  Public (Razorpay server)
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // Fail closed: never process an unverified webhook. If no secret is configured
  // we cannot validate authenticity, so reject outright.
  if (!webhookSecret) {
    console.error("[Webhook] RAZORPAY_WEBHOOK_SECRET is not configured — rejecting webhook");
    return res.status(403).json({ error: "Webhook not configured" });
  }

  // Verify signature over the RAW request bytes. Razorpay signs the exact bytes
  // it sent; re-serializing the parsed body would change key order/whitespace
  // and break verification, so we use req.rawBody captured by the body parser.
  const receivedSignature = req.headers["x-razorpay-signature"];
  if (!receivedSignature || !req.rawBody) {
    console.error("[Webhook] Missing signature header or raw body");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(req.rawBody)
    .digest("hex");

  if (expectedSignature !== receivedSignature) {
    console.error("[Webhook] Signature verification failed");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const { event, payload } = req.body;

  console.log("Razorpay webhook received:", event);

  // Handle different events
  switch (event) {
    case "payment.captured": {
      const paymentEntity = payload.payment.entity;
      const payment = await Payment.findByRazorpayOrderId(paymentEntity.order_id);

      if (payment && payment.status === "pending") {
        // Verify the captured amount matches the server-derived expected amount
        // before marking as paid (guards against amount tampering).
        const expectedPaise = Math.round(payment.amount * 100);
        if (Number(paymentEntity.amount) !== expectedPaise) {
          console.error(
            `[Webhook] Amount mismatch for ${payment.paymentNumber}: captured ${paymentEntity.amount} != expected ${expectedPaise}`
          );
          await payment.markAsFailed(
            "AMOUNT_MISMATCH",
            `Captured ${paymentEntity.amount} != expected ${expectedPaise}`
          );
          break;
        }

        payment.razorpayPaymentId = paymentEntity.id;
        payment.razorpayDetails = {
          ...payment.razorpayDetails,
          method: paymentEntity.method,
          bank: paymentEntity.bank,
          wallet: paymentEntity.wallet,
          vpa: paymentEntity.vpa,
          fee: paymentEntity.fee,
          tax: paymentEntity.tax,
        };
        await payment.markAsPaid();
        console.log(`Payment ${payment.paymentNumber} captured via webhook`);
      }
      break;
    }

    case "payment.failed": {
      const paymentEntity = payload.payment.entity;
      const payment = await Payment.findByRazorpayOrderId(paymentEntity.order_id);

      if (payment && payment.status === "pending") {
        await payment.markAsFailed(
          paymentEntity.error_code,
          paymentEntity.error_description
        );
        console.log(`Payment ${payment.paymentNumber} failed via webhook`);
      }
      break;
    }

    case "refund.processed": {
      const refundEntity = payload.refund.entity;
      const payment = await Payment.findOne({
        razorpayPaymentId: refundEntity.payment_id,
      });

      if (payment) {
        payment.status = "refunded";
        payment.refund = {
          ...payment.refund,
          razorpayRefundId: refundEntity.id,
          refundedAt: new Date(),
        };
        await payment.save();
        console.log(`Payment ${payment.paymentNumber} refunded via webhook`);
      }
      break;
    }

    default:
      console.log(`Unhandled Razorpay webhook event: ${event}`);
  }

  // Always acknowledge receipt
  res.json({ received: true });
});

// ==================== REFUNDS ====================

/**
 * @desc    Process refund
 * @route   POST /api/payments/:id/refund
 * @access  Admin
 */
export const processRefund = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid payment ID", 400);
  }

  const payment = await Payment.findById(id);

  if (!payment) {
    return ApiResponse.error(res, "Payment not found", 404);
  }

  if (payment.status !== "paid") {
    return ApiResponse.error(res, "Can only refund paid payments", 400);
  }

  if (payment.status === "refunded") {
    return ApiResponse.error(res, "Payment is already refunded", 400);
  }

  const refundAmount = amount || payment.amount;

  if (refundAmount > payment.amount) {
    return ApiResponse.error(res, "Refund amount cannot exceed payment amount", 400);
  }

  // If Razorpay payment, process refund through Razorpay API
  if (payment.paymentMode === "razorpay" && payment.razorpayPaymentId) {
    try {
      const Razorpay = (await import("razorpay")).default;
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
        amount: Math.round(refundAmount * 100), // Convert to paise
        notes: { reason: reason || "Refund requested" },
      });

      await payment.processRefund(req.user?._id, reason, refund.id);
    } catch (error) {
      console.error("Razorpay refund error:", error);
      return ApiResponse.error(res, `Razorpay refund failed: ${error.message}`, 500);
    }
  } else {
    // For offline payments, just update the status
    await payment.processRefund(req.user?._id, reason);
  }

  // Update invoice if linked
  if (payment.invoice) {
    const invoice = await Invoice.findById(payment.invoice);
    if (invoice) {
      invoice.amountPaid -= refundAmount;
      invoice.calculateTotals();
      await invoice.save();
    }
  }

  const updatedPayment = await Payment.findById(id)
    .populate("patient", "name phone")
    .populate("invoice", "invoiceNumber grandTotal balanceDue");

  ApiResponse.success(res, { payment: updatedPayment }, "Refund processed successfully");
});

// ==================== STATISTICS ====================

/**
 * @desc    Get payment statistics
 * @route   GET /api/payments/stats
 * @access  Admin
 */
export const getPaymentStats = asyncHandler(async (req, res) => {
  const { clinic, from, to } = req.query;

  // Date range (default: current month)
  const startDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const endDate = to ? new Date(to) : new Date();

  // Build match query
  const matchQuery = {
    status: "paid",
    paidAt: { $gte: startDate, $lte: endDate },
  };

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    matchQuery.clinic = new mongoose.Types.ObjectId(clinic);
  }

  // Get stats by payment mode
  const stats = await Payment.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: "$paymentMode",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  // Get stats by payment type
  const typeStats = await Payment.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  // Calculate totals
  const collection = {
    total: 0,
    count: 0,
    byMode: {},
    byType: {},
  };

  stats.forEach((item) => {
    collection.byMode[item._id] = {
      total: item.total,
      count: item.count,
    };
    collection.total += item.total;
    collection.count += item.count;
  });

  typeStats.forEach((item) => {
    collection.byType[item._id] = {
      total: item.total,
      count: item.count,
    };
  });

  ApiResponse.success(
    res,
    {
      stats: collection,
      dateRange: { from: startDate, to: endDate },
    },
    "Payment statistics fetched successfully"
  );
});

/**
 * @desc    Get daily collection report
 * @route   GET /api/payments/daily-collection
 * @access  Admin
 */
export const getDailyCollection = asyncHandler(async (req, res) => {
  const { clinic, date } = req.query;

  if (!clinic || !mongoose.Types.ObjectId.isValid(clinic)) {
    return ApiResponse.error(res, "Valid clinic ID is required", 400);
  }

  const reportDate = date ? new Date(date) : new Date();
  const collection = await Payment.getDailyCollection(clinic, reportDate);

  ApiResponse.success(
    res,
    {
      collection,
      date: reportDate,
      clinic,
    },
    "Daily collection fetched successfully"
  );
});

/**
 * @desc    Get patient payment summary
 * @route   GET /api/payments/patient/:patientId/summary
 * @access  Admin
 */
export const getPatientPaymentSummary = asyncHandler(async (req, res) => {
  const { patientId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  const summary = await Payment.getPatientPaymentSummary(patientId);

  ApiResponse.success(res, { summary }, "Patient payment summary fetched successfully");
});

// ==================== DELETE ====================

/**
 * @desc    Permanently delete a payment
 * @route   DELETE /api/payments/:id
 * @access  Admin
 */
export const deletePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid payment ID", 400);
  }

  const payment = await Payment.findById(id);

  if (!payment) {
    return ApiResponse.error(res, "Payment not found", 404);
  }

  await Payment.findByIdAndDelete(id);

  ApiResponse.success(res, null, "Payment deleted permanently");
});
