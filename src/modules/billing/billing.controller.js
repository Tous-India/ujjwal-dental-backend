import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Invoice from "./invoice.model.js";
import Patient from "../patients/patient.model.js";
import Payment from "../payments/payment.model.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import { parseIstDateRange } from "../../utils/istDateRange.js";

/**
 * BILLING CONTROLLER
 *
 * Handles:
 * - Invoice CRUD operations
 * - Invoice issuing and cancellation
 * - Payment tracking
 */

/**
 * @desc    Get all invoices
 * @route   GET /api/billing/invoices?patient=&status=&from=&to=
 * @access  Admin
 */
export const getAllInvoices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, patient, status, paymentStatus, clinic, from, to, itemType, voided, search } = req.query;

  // Build query
  const query = {};

  // Search by invoice number OR patient name/phone -- resolves matching
  // Patient _ids first, then filters invoices by those ids (mirrors the
  // getAllPayments fix and the enquiry.controller.js search pattern).
  // Previously `search` was destructured from req.query but never applied
  // to the query at all -- silently a no-op, same bug class as Payment History.
  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matchingPatients = await Patient.find({
      $or: [{ name: searchRegex }, { phone: searchRegex }],
    }).select("_id").lean();
    const searchPatientIds = matchingPatients.map((p) => p._id);

    query.$or = [
      { invoiceNumber: searchRegex },
      ...(searchPatientIds.length ? [{ patient: { $in: searchPatientIds } }] : []),
    ];
  }

  // Voided invoices are excluded from the default/active view -- pass
  // voided=true to see ONLY voided invoices (the "Voided" filter tab).
  if (voided === "true") {
    query.isVoided = true;
  } else {
    query.isVoided = { $ne: true };
  }

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    query.patient = patient;
  }

  if (status) {
    query.status = status;
  }

  if (paymentStatus) {
    const VALID_STATUSES = ["unpaid", "partial", "paid"];
    const statuses = paymentStatus.split(",").filter((s) => VALID_STATUSES.includes(s));
    if (statuses.length > 1) {
      query.paymentStatus = { $in: statuses };
    } else if (statuses.length === 1) {
      query.paymentStatus = statuses[0];
    }
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    query.clinic = clinic;
  }

  // Filter to invoices containing at least one item of the given type
  if (itemType) {
    query["items.itemType"] = itemType;
  }

  // Date range filter -- IST calendar-day boundaries, not UTC-midnight-anchored
  if (from || to) {
    query.invoiceDate = parseIstDateRange(from, to);
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [invoices, total] = await Promise.all([
    Invoice.find(query)
      .populate("patient", "name phone email")
      .populate("clinic", "name code")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Invoice.countDocuments(query),
  ]);

  // Live-recompute amountPaid/balanceDue/paymentStatus for just this page's
  // rows from real Payment records, rather than trusting the stored fields
  // -- scoped to only the returned page, so this stays a light query (one
  // extra Payment lookup for ≤ `limit` invoice ids) rather than a
  // clinic-wide join on every list request.
  const realPaidByInvoice = await getRealPaidByInvoiceMap(invoices.map((i) => i._id));
  const liveInvoices = invoices.map((inv) => {
    const doc = inv.toObject();
    const realPaid = realPaidByInvoice.get(String(inv._id)) || 0;
    doc.amountPaid = realPaid;
    doc.balanceDue = Math.max(0, (doc.grandTotal || 0) - realPaid);
    if (realPaid >= doc.grandTotal && doc.grandTotal > 0) doc.paymentStatus = "paid";
    else if (realPaid > 0) doc.paymentStatus = "partial";
    else doc.paymentStatus = "unpaid";
    return doc;
  });

  ApiResponse.paginated(res, liveInvoices, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get invoice by ID
 * @route   GET /api/billing/invoices/:id
 * @access  Admin
 */
export const getInvoiceById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id)
    .populate("patient", "name phone email address membership")
    .populate("clinic", "name code address phone")
    .populate("appointment")
    .populate("createdBy", "name")
    .populate("cancelledBy", "name");

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // IDOR guard: a patient may only view their own invoice (admins see any)
  if (req.userType === "patient") {
    const ownerId = invoice.patient?._id?.toString() || invoice.patient?.toString();
    if (!req.patient || ownerId !== req.patient._id.toString()) {
      return ApiResponse.error(res, "Not authorized to access this invoice", 403);
    }
  }

  ApiResponse.success(res, { invoice }, "Invoice fetched successfully");
});

/**
 * @desc    Get invoice by invoice number
 * @route   GET /api/billing/invoices/number/:invoiceNumber
 * @access  Admin
 */
export const getInvoiceByNumber = asyncHandler(async (req, res) => {
  const { invoiceNumber } = req.params;

  const invoice = await Invoice.findOne({ invoiceNumber })
    .populate("patient", "name phone email address")
    .populate("clinic", "name code address phone")
    .populate("appointment");

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  ApiResponse.success(res, { invoice }, "Invoice fetched successfully");
});

/**
 * @desc    Create new invoice
 * @route   POST /api/billing/invoices
 * @access  Admin
 */
export const createInvoice = asyncHandler(async (req, res) => {
  const { patient, clinic, appointment, items, discount, notes, terms, amountPaid, paymentMethod } = req.body;

  const hasOpdItem = items?.some((item) => item.itemType === "opd_fee");
  if (hasOpdItem) {
    return ApiResponse.error(
      res,
      "OPD Fee invoices must be created through appointment booking, not manually.",
      400,
    );
  }

  const hasTreatmentItem = items?.some((item) => item.itemType === "treatment");
  if (hasTreatmentItem) {
    return ApiResponse.error(
      res,
      "Treatment invoices must be created through appointment booking, not manually.",
      400,
    );
  }

  // Validation
  if (!patient || !clinic || !items || items.length === 0) {
    return ApiResponse.error(res, "Patient, clinic and at least one item are required", 400);
  }

  // Verify patient exists
  const patientDoc = await Patient.findById(patient);
  if (!patientDoc) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Process items and apply membership discount if applicable
  const processedItems = items.map((item) => {
    const quantity = item.quantity || 1;
    const unitPrice = Number(item.unitPrice);
    let itemDiscount = { percentage: 0, amount: 0 };

    // Apply membership discount if patient has active membership
    if (patientDoc.hasMembership && !item.discount?.percentage) {
      itemDiscount.percentage = patientDoc.currentDiscount;
    } else if (item.discount) {
      itemDiscount = item.discount;
    }

    // Calculate amount after discount
    let amount = unitPrice * quantity;
    if (itemDiscount.percentage > 0) {
      amount = amount - (amount * itemDiscount.percentage) / 100;
    }
    if (itemDiscount.amount > 0) {
      amount = amount - itemDiscount.amount;
    }
    amount = Math.max(0, amount);

    // Calculate tax
    const taxRate = item.taxRate || 0;
    const taxAmount = (amount * taxRate) / 100;
    const total = amount + taxAmount;

    return {
      itemType: item.itemType || "other",
      itemRef: item.itemRef,
      itemRefModel: item.itemRefModel,
      description: item.description,
      quantity,
      unitPrice,
      discount: itemDiscount,
      taxRate,
      amount,
      taxAmount,
      total,
    };
  });

  // Optional initial payment captured on the create form. The model's
  // calculateTotals() derives paymentStatus/status from amountPaid, so we only
  // need to set it here (never trust a client-sent status).
  const initialPaid = Math.max(0, Number(amountPaid) || 0);

  // Create invoice
  const invoice = await Invoice.create({
    patient,
    clinic,
    appointment,
    items: processedItems,
    discount: discount || { percentage: 0, amount: 0 },
    amountPaid: initialPaid,
    ...(initialPaid > 0 && paymentMethod ? { paymentMethod } : {}),
    notes,
    terms,
    createdBy: req.user?._id,
  });

  // Populate for response
  const populatedInvoice = await Invoice.findById(invoice._id)
    .populate("patient", "name phone")
    .populate("clinic", "name code");

  ApiResponse.created(res, { invoice: populatedInvoice }, "Invoice created successfully");
});

/**
 * @desc    Update invoice (add/modify items)
 * @route   PATCH /api/billing/invoices/:id
 * @access  Admin
 */
export const updateInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // Can only update draft invoices
  if (invoice.status !== "draft") {
    return ApiResponse.error(res, "Only draft invoices can be modified", 400);
  }

  // Update allowed fields
  const allowedFields = ["items", "discount", "notes", "terms", "dueDate"];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      invoice[field] = req.body[field];
    }
  });

  await invoice.save();

  const updatedInvoice = await Invoice.findById(id)
    .populate("patient", "name phone")
    .populate("clinic", "name code");

  ApiResponse.success(res, { invoice: updatedInvoice }, "Invoice updated successfully");
});

/**
 * @desc    Add item to invoice
 * @route   POST /api/billing/invoices/:id/items
 * @access  Admin
 */
export const addInvoiceItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const itemData = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // Can only add items to draft invoices
  if (invoice.status !== "draft") {
    return ApiResponse.error(res, "Can only add items to draft invoices", 400);
  }

  // Validate item data
  if (!itemData.description || itemData.unitPrice === undefined) {
    return ApiResponse.error(res, "Item description and unit price are required", 400);
  }

  // Process item
  const quantity = itemData.quantity || 1;
  const unitPrice = Number(itemData.unitPrice);
  const itemDiscount = itemData.discount || { percentage: 0, amount: 0 };

  let amount = unitPrice * quantity;
  if (itemDiscount.percentage > 0) {
    amount = amount - (amount * itemDiscount.percentage) / 100;
  }
  if (itemDiscount.amount > 0) {
    amount = amount - itemDiscount.amount;
  }
  amount = Math.max(0, amount);

  const taxRate = itemData.taxRate || 0;
  const taxAmount = (amount * taxRate) / 100;
  const total = amount + taxAmount;

  const newItem = {
    itemType: itemData.itemType || "other",
    itemRef: itemData.itemRef,
    itemRefModel: itemData.itemRefModel,
    description: itemData.description,
    quantity,
    unitPrice,
    discount: itemDiscount,
    taxRate,
    amount,
    taxAmount,
    total,
  };

  await invoice.addItem(newItem);

  const updatedInvoice = await Invoice.findById(id)
    .populate("patient", "name phone");

  ApiResponse.success(res, { invoice: updatedInvoice }, "Item added successfully");
});

/**
 * @desc    Remove item from invoice
 * @route   DELETE /api/billing/invoices/:id/items/:itemId
 * @access  Admin
 */
export const removeInvoiceItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // Can only remove items from draft invoices
  if (invoice.status !== "draft") {
    return ApiResponse.error(res, "Can only remove items from draft invoices", 400);
  }

  await invoice.removeItem(itemId);

  const updatedInvoice = await Invoice.findById(id)
    .populate("patient", "name phone");

  ApiResponse.success(res, { invoice: updatedInvoice }, "Item removed successfully");
});

/**
 * @desc    Issue invoice (finalize)
 * @route   POST /api/billing/invoices/:id/issue
 * @access  Admin
 */
export const issueInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // Can only issue draft invoices
  if (invoice.status !== "draft") {
    return ApiResponse.error(res, "Only draft invoices can be issued", 400);
  }

  // Check if invoice has items
  if (invoice.items.length === 0) {
    return ApiResponse.error(res, "Cannot issue invoice with no items", 400);
  }

  await invoice.markAsSent();

  ApiResponse.success(res, { invoice }, "Invoice issued successfully");
});

/**
 * @desc    Cancel invoice
 * @route   POST /api/billing/invoices/:id/cancel
 * @access  Admin
 */
export const cancelInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // Cannot cancel paid invoices — check both fields: an inconsistent invoice
  // (status="paid" but paymentStatus="unpaid") must also be blocked here.
  if (invoice.paymentStatus === "paid" || invoice.status === "paid") {
    return ApiResponse.error(res, "Cannot cancel a fully paid invoice", 400);
  }

  // Cannot cancel already cancelled invoices
  if (invoice.status === "cancelled") {
    return ApiResponse.error(res, "Invoice is already cancelled", 400);
  }

  // If partially paid, warn
  if (invoice.amountPaid > 0) {
    return ApiResponse.error(
      res,
      "Invoice has payments recorded. Please process refunds first.",
      400
    );
  }

  await invoice.cancelInvoice(req.user?._id, reason || "Cancelled by admin");

  ApiResponse.success(res, { invoice }, "Invoice cancelled successfully");
});

/**
 * @desc    Void an invoice — self-service correction for phantom/erroneous
 *          invoices (e.g. a double-submit), safe to use even on paid
 *          invoices (unlike cancelInvoice, which blocks on any payment).
 * @route   POST /api/billing/invoices/:id/void
 * @access  Admin / Clinic Manager
 *
 * Pure status flag -- never deletes the invoice, never touches any linked
 * Payment document. Voided invoices stay fully visible/queryable via the
 * `voided=true` filter on getAllInvoices, they just drop out of active
 * lists/totals by default.
 */
export const voidInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }
  if (!reason || reason.trim().length < 10) {
    return ApiResponse.error(res, "A reason of at least 10 characters is required to void an invoice", 400);
  }

  const invoice = await Invoice.findById(id);
  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }
  if (invoice.isVoided) {
    return ApiResponse.error(res, "Invoice is already voided", 400);
  }

  await Invoice.updateOne(
    { _id: id },
    {
      $set: {
        isVoided: true,
        voidedAt: new Date(),
        voidedBy: req.user?._id || null,
        voidReason: reason.trim(),
      },
    }
  );

  const updated = await Invoice.findById(id).populate("patient", "name phone");
  ApiResponse.success(res, { invoice: updated }, "Invoice voided successfully");
});

/**
 * @desc    Manually correct an invoice's items/discount/amountPaid -- a
 *          self-service tool so admin can fix a billing error (wrong totals,
 *          incomplete write-path data) without a developer running a script.
 * @route   PATCH /api/billing/invoices/:id/correct
 * @access  Admin / Clinic Manager
 *
 * Uses updateOne/$set exclusively -- NEVER a fetch-modify-.save() pattern --
 * so this tool cannot itself re-trigger the invoice-corruption bug class
 * (a pre-save hook recalculating grandTotal against stale/cleared items)
 * found and fixed earlier. All arithmetic happens here in plain JS before
 * the single $set write.
 */
export const correctInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { items, discount, amountPaid, reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }
  if (!reason || reason.trim().length < 10) {
    return ApiResponse.error(res, "A reason of at least 10 characters is required to correct an invoice", 400);
  }

  const invoice = await Invoice.findById(id).lean();
  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  const changes = {};
  const set = {};

  // Items: recompute each item's amount/tax/total and the invoice subtotal
  // directly in JS (mirrors Invoice.calculateTotals()'s math, but run here
  // once rather than via a document save/pre-save hook).
  const effectiveItems = items || invoice.items || [];
  if (items) {
    const recomputedItems = items.map((item) => {
      let amount = (item.unitPrice || 0) * (item.quantity || 1);
      const pct = item.discount?.percentage || 0;
      const amt = item.discount?.amount || 0;
      if (pct > 0) amount -= (amount * pct) / 100;
      if (amt > 0) amount -= amt;
      amount = Math.max(0, amount);
      const taxAmount = (amount * (item.taxRate || 0)) / 100;
      return { ...item, amount, taxAmount, total: amount + taxAmount };
    });
    set.items = recomputedItems;
    changes.items = { from: invoice.items, to: recomputedItems };
  }

  const finalItems = items ? set.items : effectiveItems;
  const subtotal = finalItems.reduce((s, it) => s + (it.amount || 0), 0);
  const totalTax = finalItems.reduce((s, it) => s + (it.taxAmount || 0), 0);

  const effectiveDiscount = discount !== undefined ? discount : invoice.discount;
  if (discount !== undefined) {
    set.discount = discount;
    changes.discount = { from: invoice.discount, to: discount };
  }

  let discountedSubtotal = subtotal;
  if (effectiveDiscount?.percentage > 0) {
    discountedSubtotal -= (discountedSubtotal * effectiveDiscount.percentage) / 100;
  }
  if (effectiveDiscount?.amount > 0) {
    discountedSubtotal -= effectiveDiscount.amount;
  }
  const grandTotal = Math.max(0, Math.round(discountedSubtotal + totalTax));

  const effectiveAmountPaid = amountPaid !== undefined ? amountPaid : invoice.amountPaid;
  if (amountPaid !== undefined) {
    changes.amountPaid = { from: invoice.amountPaid, to: amountPaid };
  }
  const balanceDue = Math.max(0, grandTotal - effectiveAmountPaid);

  let paymentStatus = "unpaid";
  if (effectiveAmountPaid >= grandTotal && grandTotal > 0) paymentStatus = "paid";
  else if (effectiveAmountPaid > 0) paymentStatus = "partial";

  if (items) set.subtotal = subtotal;
  if (items) set.totalTax = totalTax;
  set.grandTotal = grandTotal;
  set.balanceDue = balanceDue;
  set.paymentStatus = paymentStatus;
  if (amountPaid !== undefined) set.amountPaid = amountPaid;
  set.lastEditedAt = new Date();
  set.lastEditedBy = req.user?._id || null;

  if (Object.keys(changes).length === 0) {
    return ApiResponse.error(res, "No fields to correct were provided", 400);
  }

  await Invoice.updateOne(
    { _id: id },
    {
      $set: set,
      $push: {
        editHistory: {
          editedAt: new Date(),
          editedBy: req.user?._id || null,
          reason: reason.trim(),
          changes,
        },
      },
    }
  );

  const updated = await Invoice.findById(id).populate("patient", "name phone");
  ApiResponse.success(res, { invoice: updated }, "Invoice corrected successfully");
});

/**
 * @desc    Record payment for invoice
 * @route   POST /api/billing/invoices/:id/payment
 * @access  Admin
 */
export const recordPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  if (!amount || amount <= 0) {
    return ApiResponse.error(res, "Valid payment amount is required", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  if (invoice.status === "cancelled") {
    return ApiResponse.error(res, "Cannot record payment for cancelled invoice", 400);
  }

  if (invoice.paymentStatus === "paid") {
    return ApiResponse.error(res, "Invoice is already fully paid", 400);
  }

  // Check if payment exceeds balance
  if (amount > invoice.balanceDue) {
    return ApiResponse.error(
      res,
      `Payment amount (${amount}) exceeds balance due (${invoice.balanceDue})`,
      400
    );
  }

  // Capture BEFORE invoice.recordPayment() mutates amountPaid, so the ledger
  // entry records the true prior balance (same field collectPayment tracks).
  const previousAmountPaid = invoice.amountPaid || 0;

  await invoice.recordPayment(amount);

  // This endpoint previously only mutated the Invoice document -- zero
  // Payment record was ever created, the exact write-path gap identified
  // and fixed tonight for collectPayment/recordAdminPayment. Mirrors
  // collectPayment's already-correct pattern exactly. paymentMode isn't
  // currently collected by this endpoint's caller (InvoiceDetailModal's
  // "Record Payment" form only sends amount) -- defaults to "cash" as the
  // codebase already does elsewhere for admin-recorded payments with no
  // explicit mode.
  await Payment.create({
    patient: invoice.patient,
    amount,
    paymentMode: req.body.paymentMode || "cash",
    type: "invoice_payment",
    status: "paid",
    settledInvoices: [
      {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        appliedAmount: amount,
        previousAmountPaid,
      },
    ],
    recordedBy: req.user?._id,
  });

  const updatedInvoice = await Invoice.findById(id)
    .populate("patient", "name phone");

  ApiResponse.success(res, { invoice: updatedInvoice }, "Payment recorded successfully");
});

const PAYMENT_TYPE_LABELS = {
  opd_fee: "OPD Fee",
  consultation: "Consultation",
  treatment: "Treatment",
  test: "Test",
  invoice_payment: "Invoice Payment",
  advance: "Advance",
  membership: "Membership",
  refund: "Refund",
  other: "Other",
};

/**
 * Ids of every currently-voided invoice. A voided invoice is a pure
 * data-entry correction (e.g. a phantom double-submit) — no real money was
 * ever involved, so any Payment document tied to one must be excluded from
 * every "collected"/"paid" total. Void never deletes or touches the linked
 * Payment document itself (see voidInvoice), so this exclusion has to be
 * applied explicitly everywhere a Payment sum feeds a collected/paid figure.
 * This is a DIFFERENT concept from a refund (real money collected, then
 * genuinely returned) — refund totals are never filtered by this.
 */
const getVoidedInvoiceIds = () => Invoice.find({ isVoided: true }).distinct("_id");

/**
 * True if a lean Payment doc references (via the legacy singular `invoice`
 * field or any settledInvoices[].invoiceId entry) at least one voided
 * invoice. Payments with no invoice link at all are never excluded.
 */
const isPaymentLinkedToVoidedInvoice = (payment, voidedIdSet) => {
  if (payment.invoice && voidedIdSet.has(String(payment.invoice))) return true;
  if (Array.isArray(payment.settledInvoices)) {
    return payment.settledInvoices.some((s) => voidedIdSet.has(String(s.invoiceId)));
  }
  return false;
};

/**
 * The real amount a patient has paid, merging the same two sources
 * getMyPaymentHistory uses (Payment collection + unlinked-invoice
 * amountPaid) so the summary cards always agree with the payment list.
 * Read-only — no writes.
 */
const getPatientTotalPaid = async (patientId) => {
  const [rawPayments, voidedInvoiceIds] = await Promise.all([
    Payment.find({ patient: patientId, status: "paid" })
      .select("amount invoice settledInvoices")
      .lean(),
    getVoidedInvoiceIds(),
  ]);
  const voidedIdSet = new Set(voidedInvoiceIds.map(String));

  // Payments tied to a voided invoice never counted as real "paid" money —
  // voiding is a pure correction, not a refund. See getVoidedInvoiceIds.
  const realPayments = rawPayments.filter((p) => !isPaymentLinkedToVoidedInvoice(p, voidedIdSet));

  const paymentsSum = realPayments.reduce((s, p) => s + (p.amount || 0), 0);
  // Invoices already represented by a Payment doc must be excluded from the
  // "unlinked invoice" sum below, or the same money gets counted twice. The
  // actual write path (verifyPendingPayment) links a payment to the
  // invoice(s) it settled via settledInvoices[].invoiceId, NOT the legacy
  // singular `invoice` field — checking `invoice` alone missed virtually
  // every real payment, since settledInvoices is what write paths populate.
  const linkedInvoiceIds = new Set(
    realPayments.flatMap((p) => {
      const ids = p.invoice ? [String(p.invoice)] : [];
      if (Array.isArray(p.settledInvoices)) {
        ids.push(...p.settledInvoices.map((s) => String(s.invoiceId)));
      }
      return ids;
    })
  );

  const invoices = await Invoice.find({
    patient: patientId,
    amountPaid: { $gt: 0 },
    status: { $ne: "cancelled" },
    isVoided: { $ne: true },
  })
    .select("amountPaid")
    .lean();

  const unlinkedSum = invoices
    .filter((inv) => !linkedInvoiceIds.has(String(inv._id)))
    .reduce((s, inv) => s + (inv.amountPaid || 0), 0);

  return paymentsSum + unlinkedSum;
};

/**
 * Real amount paid PER invoice, computed from the Payment collection
 * (settledInvoices[].invoiceId, falling back to the legacy singular
 * `invoice` field), for an arbitrary set of invoice ids.
 *
 * Why this exists instead of `totalAmount - totalPaid` at the aggregate
 * level: a clinic-wide Payment sum includes money that isn't scoped to any
 * currently-billed invoice at all (standalone payments never linked to an
 * invoice, or payments referencing an invoice id that no longer exists) --
 * subtracting that from a clinic-wide grandTotal sum silently erases real
 * outstanding balance that has nothing to do with it, which is exactly what
 * produced a clinic-wide "Balance Due" LOWER than a single invoice's own
 * due (confirmed: Nisha's ₹15,400 alone exceeded the ₹8,597 aggregate-
 * subtraction figure). Balance due can never be negative per invoice, so it
 * must be clamped to 0 and summed PER INVOICE, never netted at the
 * aggregate level.
 *
 * @param {Array<ObjectId|string>} invoiceIds
 * @returns {Promise<Map<string, number>>} invoiceId (string) -> real amount paid
 */
const getRealPaidByInvoiceMap = async (invoiceIds) => {
  const ids = invoiceIds.map((id) => String(id));
  if (ids.length === 0) return new Map();

  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const payments = await Payment.find({
    status: { $in: ["paid", "refunded", "refund_pending"] },
    $or: [{ "settledInvoices.invoiceId": { $in: objectIds } }, { invoice: { $in: objectIds } }],
  })
    .select("amount invoice settledInvoices")
    .lean();

  const idSet = new Set(ids);
  const realPaidByInvoice = new Map();
  for (const p of payments) {
    if (Array.isArray(p.settledInvoices) && p.settledInvoices.length > 0) {
      for (const s of p.settledInvoices) {
        const id = String(s.invoiceId);
        if (!idSet.has(id)) continue;
        const applied = s.appliedAmount != null ? s.appliedAmount : p.amount;
        realPaidByInvoice.set(id, (realPaidByInvoice.get(id) || 0) + (applied || 0));
      }
    } else if (p.invoice && idSet.has(String(p.invoice))) {
      const id = String(p.invoice);
      realPaidByInvoice.set(id, (realPaidByInvoice.get(id) || 0) + (p.amount || 0));
    }
  }
  return realPaidByInvoice;
};

/**
 * @desc    Get the logged-in patient's own invoices
 * @route   GET /api/billing/invoices/my-invoices
 * @access  Patient (Bearer token)
 *
 * Derives the patient from the auth token (req.patient) — never from a client
 * param — so a patient can ONLY ever see their own invoices (IDOR-safe).
 */
export const getMyInvoices = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id;
  if (!patientId) {
    return ApiResponse.error(res, "Not authorized", 401);
  }

  const { page = 1, limit = 50, status } = req.query;
  const query = { patient: patientId, isVoided: { $ne: true } };
  if (status) {
    query.status = status;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [invoices, total] = await Promise.all([
    Invoice.find(query)
      .populate("clinic", "name code")
      .sort({ invoiceDate: -1, createdAt: -1 }) // newest first
      .skip(skip)
      .limit(parseInt(limit)),
    Invoice.countDocuments(query),
  ]);

  ApiResponse.paginated(res, invoices, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get pending invoices for a patient
 * @route   GET /api/billing/invoices/patient/:patientId/pending
 * @access  Admin
 */
export const getPatientPendingInvoices = asyncHandler(async (req, res) => {
  const { patientId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  const invoices = await Invoice.getPendingInvoices(patientId);

  ApiResponse.success(res, { invoices }, "Pending invoices fetched successfully");
});

/**
 * @desc    Get total pending amount for a patient (computed from grandTotal - amountPaid)
 * @route   GET /api/billing/patient/:patientId/pending-amount
 * @access  Admin
 */
export const getPatientPendingAmount = asyncHandler(async (req, res) => {
  const { patientId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  const invoices = await Invoice.find({
    patient: patientId,
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: { $ne: "cancelled" },
    isVoided: { $ne: true },
  }).select("grandTotal amountPaid invoiceNumber");

  const pendingAmount = invoices.reduce((sum, inv) => {
    // Always compute from grandTotal - amountPaid so stale balanceDue never causes issues
    return sum + Math.max(0, (inv.grandTotal || 0) - (inv.amountPaid || 0));
  }, 0);

  // Return flat — no ApiResponse wrapper so frontend reads res.data.pendingAmount directly
  res.json({
    success: true,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    invoiceCount: invoices.length,
  });
});

/**
 * @desc    Get overdue invoices
 * @route   GET /api/billing/invoices/overdue
 * @access  Admin
 */
export const getOverdueInvoices = asyncHandler(async (req, res) => {
  const invoices = await Invoice.getOverdueInvoices();

  ApiResponse.success(res, { invoices }, "Overdue invoices fetched successfully");
});

/**
 * @desc    Get billing summary/statistics
 * @route   GET /api/billing/stats
 * @access  Admin
 */
export const getBillingStats = asyncHandler(async (req, res) => {
  const { clinic, from, to, patient } = req.query;

  // Build match query (same aggregation the Billing page uses).
  const matchQuery = { status: { $ne: "cancelled" }, isVoided: { $ne: true } };

  // Date window: only applied when the admin explicitly provides a range.
  // No date params → no date filter → all-time stats, consistent with the
  // invoice table which also shows all records when no date is selected.
  let startDate = null;
  let endDate = null;
  if (from || to) {
    matchQuery.invoiceDate = parseIstDateRange(from, to);
    startDate = matchQuery.invoiceDate.$gte || null;
    endDate = matchQuery.invoiceDate.$lte || null;
  }

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    matchQuery.patient = new mongoose.Types.ObjectId(patient);
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    matchQuery.clinic = new mongoose.Types.ObjectId(clinic);
  }

  // Shared aggregation (same source the patient billing summary uses).
  // "Total Amount" ("invoices raised") stays Invoice.grandTotal-derived --
  // that's a legitimate, different concept from money actually collected.
  const result = await Invoice.getStats(matchQuery);

  // "Total Paid" now derives from the Payment collection directly, NOT
  // Invoice.amountPaid -- same source and same status scope
  // (paid/refunded/refund_pending, i.e. gross collected) as Payment
  // History's "Total Collected" (getPaymentSummaryStats), so the two can
  // never disagree again. Invoice.amountPaid has repeatedly proven
  // unreliable this session (corruption bug, multiple write-path gaps) even
  // though the specific known gaps are now fixed -- deriving from the
  // ledger itself is the more resilient source of truth going forward.
  const paymentMatch = { status: { $in: ["paid", "refunded", "refund_pending"] } };
  if (startDate || endDate) {
    paymentMatch.createdAt = {};
    if (startDate) paymentMatch.createdAt.$gte = startDate;
    if (endDate) paymentMatch.createdAt.$lte = endDate;
  }
  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    paymentMatch.patient = new mongoose.Types.ObjectId(patient);
  }
  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    paymentMatch.clinic = new mongoose.Types.ObjectId(clinic);
  }
  // Exclude payments tied to a voided invoice -- see getVoidedInvoiceIds.
  // $nin on an array field (settledInvoices.invoiceId) excludes the document
  // if ANY element matches, which is exactly what's needed here; payments
  // with no invoice link at all are unaffected since [] never matches $nin.
  const voidedInvoiceIds = await getVoidedInvoiceIds();
  if (voidedInvoiceIds.length > 0) {
    paymentMatch.invoice = { $nin: voidedInvoiceIds };
    paymentMatch["settledInvoices.invoiceId"] = { $nin: voidedInvoiceIds };
  }
  const [paidAgg] = await Payment.aggregate([
    { $match: paymentMatch },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalPaid = paidAgg?.total || 0;

  // "Balance Due" must NEVER be `totalAmount - totalPaid` at the aggregate
  // level -- totalPaid is a flat clinic-wide Payment sum that includes money
  // not scoped to any billed invoice (standalone payments, orphaned invoice
  // references), so subtracting it can erase real per-invoice balance and
  // produce a clinic-wide total LOWER than a single invoice's own due (the
  // exact bug this fixes). Balance due can never be negative per invoice --
  // clamp to 0 and sum PER INVOICE instead, guaranteeing the total can never
  // be less than any individual invoice's own due.
  const matchedInvoices = await Invoice.find(matchQuery).select("_id grandTotal").lean();
  const realPaidByInvoice = await getRealPaidByInvoiceMap(matchedInvoices.map((i) => i._id));
  const totalDue = matchedInvoices.reduce((sum, inv) => {
    const real = realPaidByInvoice.get(String(inv._id)) || 0;
    return sum + Math.max(0, (inv.grandTotal || 0) - real);
  }, 0);

  ApiResponse.success(
    res,
    {
      stats: { ...result, totalPaid, totalDue },
      dateRange: { from: startDate, to: endDate },
    },
    "Billing statistics fetched successfully"
  );
});

/**
 * @desc    Get the logged-in patient's own billing summary (outstanding balance)
 * @route   GET /api/billing/my-summary
 * @access  Patient (Bearer token)
 *
 * Derives the patient from the auth token (req.patient) — never from a client
 * param — so a patient can ONLY ever see their own totals (IDOR-safe).
 *
 * totalAmount ("Total Billed") still comes from Invoice.getStats — a sum of
 * grandTotal across this patient's non-cancelled invoices.
 *
 * totalPaid / totalDue are recomputed here rather than taken from
 * Invoice.getStats, because that aggregation sums the stored
 * Invoice.amountPaid field, which — same root cause as getMyPaymentHistory's
 * fix above — is incomplete for payments never linked to (or reflected in)
 * an invoice. totalPaid now uses getPatientTotalPaid(), the exact same
 * Payment-collection-based total the payment history list already shows, so
 * the summary cards and the list never disagree. totalDue is then computed
 * (never read from the stale stored balanceDue) and floored at 0 for
 * display — a patient can't owe a negative amount, though a paid total that
 * exceeds the billed total is itself a sign one of their invoices has an
 * incorrect grandTotal, a separate data issue this read-only fix does not
 * (and should not) silently correct.
 */
export const getMyBillingSummary = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id;
  if (!patientId) {
    return ApiResponse.error(res, "Not authorized", 401);
  }

  const matchQuery = {
    patient: new mongoose.Types.ObjectId(patientId),
    status: { $ne: "cancelled" },
    isVoided: { $ne: true },
  };

  const stats = await Invoice.getStats(matchQuery);
  const totalPaid = await getPatientTotalPaid(patientId);
  const totalDue = Math.max(0, (stats.totalAmount || 0) - totalPaid);

  ApiResponse.success(
    res,
    { stats: { ...stats, totalPaid, totalDue } },
    "Billing summary fetched successfully"
  );
});

/**
 * @desc    Download invoice as PDF
 * @route   GET /api/billing/invoices/:id/pdf
 * @access  Admin / Patient (own invoice)
 */
export const downloadInvoicePdf = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id)
    .populate("patient", "name phone email address")
    .populate("clinic", "name code address phone");

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // IDOR guard: a patient may only download their own invoice (admins see any)
  if (req.userType === "patient") {
    const ownerId = invoice.patient?._id?.toString() || invoice.patient?.toString();
    if (!req.patient || ownerId !== req.patient._id.toString()) {
      return ApiResponse.error(res, "Not authorized to access this invoice", 403);
    }
  }

  // Create PDF document
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  // Set response headers
  const filename = `invoice-${invoice.invoiceNumber || id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // Pipe PDF to response
  doc.pipe(res);

  const leftMargin = 50;
  const pageWidth = doc.page.width - 100;

  // --- Clinic Header ---
  doc.fontSize(20).font("Helvetica-Bold");
  if (invoice.clinic?.name) {
    doc.text(invoice.clinic.name, leftMargin, 50, { align: "center" });
  }
  doc.fontSize(10).font("Helvetica");
  if (invoice.clinic?.address) {
    const addr = invoice.clinic.address;
    const addressParts = [addr.street, addr.area, addr.city, addr.state, addr.pincode].filter(Boolean);
    if (addressParts.length) {
      doc.text(addressParts.join(", "), { align: "center" });
    }
  }
  if (invoice.clinic?.phone) {
    doc.text(`Phone: ${invoice.clinic.phone}`, { align: "center" });
  }

  // Legal company line (payment gateway is registered under this company)
  doc.moveDown(0.4);
  doc.fontSize(9).font("Helvetica-Oblique").fillColor("#555555");
  doc.text(
    "Ujjwal Dental Clinic and Maxillofacial Surgery Center",
    leftMargin,
    doc.y,
    { align: "center", width: pageWidth },
  );
  doc.fillColor("black").font("Helvetica");

  doc.moveDown(1.5);
  doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y).stroke("#cccccc");
  doc.moveDown(1);

  // --- Invoice Title ---
  doc.fontSize(16).font("Helvetica-Bold").text("INVOICE", { align: "center" });
  doc.moveDown(0.5);

  // --- Invoice Details & Patient Info (two columns) ---
  const detailsY = doc.y;

  // Left column - Invoice details
  doc.fontSize(10).font("Helvetica-Bold").text("Invoice Details", leftMargin, detailsY);
  doc.moveDown(0.3);
  doc.font("Helvetica");
  doc.text(`Invoice #: ${invoice.invoiceNumber || "N/A"}`);
  doc.text(`Date: ${invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString("en-IN") : "N/A"}`);
  doc.text(`Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-IN") : "N/A"}`);
  doc.text(`Status: ${(invoice.status || "").toUpperCase()}`);

  const afterLeftCol = doc.y;

  // Right column - Patient info
  const rightCol = leftMargin + pageWidth / 2 + 20;
  doc.fontSize(10).font("Helvetica-Bold").text("Bill To", rightCol, detailsY);
  doc.moveDown(0.3);
  doc.font("Helvetica");
  if (invoice.patient?.name) doc.text(invoice.patient.name, rightCol);
  if (invoice.patient?.phone) doc.text(`Phone: ${invoice.patient.phone}`, rightCol);
  if (invoice.patient?.email) doc.text(`Email: ${invoice.patient.email}`, rightCol);
  if (invoice.patient?.address) {
    const pAddr = invoice.patient.address;
    const parts = [pAddr.street, pAddr.city, pAddr.state, pAddr.pincode].filter(Boolean);
    if (parts.length) doc.text(parts.join(", "), rightCol);
  }

  doc.y = Math.max(afterLeftCol, doc.y) + 20;

  // --- Items Table ---
  doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y).stroke("#cccccc");
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const colWidths = { description: 160, qty: 40, unitPrice: 70, discount: 60, tax: 60, total: 75 };

  let xPos = leftMargin;
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Description", xPos, tableTop, { width: colWidths.description });
  xPos += colWidths.description;
  doc.text("Qty", xPos, tableTop, { width: colWidths.qty, align: "right" });
  xPos += colWidths.qty;
  doc.text("Unit Price", xPos, tableTop, { width: colWidths.unitPrice, align: "right" });
  xPos += colWidths.unitPrice;
  doc.text("Discount", xPos, tableTop, { width: colWidths.discount, align: "right" });
  xPos += colWidths.discount;
  doc.text("Tax", xPos, tableTop, { width: colWidths.tax, align: "right" });
  xPos += colWidths.tax;
  doc.text("Total", xPos, tableTop, { width: colWidths.total, align: "right" });

  doc.moveDown(0.5);
  doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y).stroke("#cccccc");
  doc.moveDown(0.3);

  // Table rows
  doc.font("Helvetica").fontSize(9);
  const items = invoice.items || [];
  for (const item of items) {
    const rowY = doc.y;
    xPos = leftMargin;

    doc.text(item.description || "", xPos, rowY, { width: colWidths.description });
    xPos += colWidths.description;
    doc.text(String(item.quantity ?? ""), xPos, rowY, { width: colWidths.qty, align: "right" });
    xPos += colWidths.qty;
    doc.text((item.unitPrice ?? 0).toFixed(2), xPos, rowY, { width: colWidths.unitPrice, align: "right" });
    xPos += colWidths.unitPrice;
    doc.text(((item.discount?.amount) ?? 0).toFixed(2), xPos, rowY, { width: colWidths.discount, align: "right" });
    xPos += colWidths.discount;
    doc.text((item.taxAmount ?? 0).toFixed(2), xPos, rowY, { width: colWidths.tax, align: "right" });
    xPos += colWidths.tax;
    doc.text((item.total ?? 0).toFixed(2), xPos, rowY, { width: colWidths.total, align: "right" });

    doc.moveDown(0.5);
  }

  doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y).stroke("#cccccc");
  doc.moveDown(1);

  // --- Totals Section ---
  const totalsX = leftMargin + pageWidth - 200;
  const valuesX = leftMargin + pageWidth - 80;

  doc.font("Helvetica").fontSize(10);
  doc.text("Subtotal:", totalsX, doc.y);
  doc.text(`₹${(invoice.subtotal ?? 0).toFixed(2)}`, valuesX, doc.y - doc.currentLineHeight(), { width: 80, align: "right" });

  if (invoice.discount?.amount > 0) {
    const discLabel = invoice.discount.percentage ? `Discount (${invoice.discount.percentage}%):` : "Discount:";
    doc.text(discLabel, totalsX, doc.y);
    doc.text(`-₹${(invoice.discount.amount ?? 0).toFixed(2)}`, valuesX, doc.y - doc.currentLineHeight(), { width: 80, align: "right" });
  }

  if (invoice.totalTax > 0) {
    doc.text("Tax:", totalsX, doc.y);
    doc.text(`₹${(invoice.totalTax ?? 0).toFixed(2)}`, valuesX, doc.y - doc.currentLineHeight(), { width: 80, align: "right" });
  }

  doc.moveDown(0.3);
  doc.moveTo(totalsX, doc.y).lineTo(leftMargin + pageWidth, doc.y).stroke("#333333");
  doc.moveDown(0.3);

  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("Grand Total:", totalsX, doc.y);
  doc.text(`₹${(invoice.grandTotal ?? 0).toFixed(2)}`, valuesX, doc.y - doc.currentLineHeight(), { width: 80, align: "right" });

  doc.moveDown(1);

  // --- Payment Info ---
  doc.font("Helvetica").fontSize(10);
  doc.text(`Payment Status: ${(invoice.paymentStatus || "unpaid").toUpperCase()}`, leftMargin);
  doc.text(`Amount Paid: ₹${(invoice.amountPaid ?? 0).toFixed(2)}`, leftMargin);
  doc.font("Helvetica-Bold");
  doc.text(`Balance Due: ₹${(invoice.balanceDue ?? 0).toFixed(2)}`, leftMargin);
  doc.moveDown(1);

  // --- Notes ---
  if (invoice.notes) {
    doc.font("Helvetica-Bold").fontSize(10).text("Notes:", leftMargin);
    doc.font("Helvetica").fontSize(9).text(invoice.notes, leftMargin, doc.y, { width: pageWidth });
  }

  // --- Footer ---
  doc.moveDown(2);
  doc.fontSize(8).font("Helvetica").fillColor("#999999");
  doc.text("Thank you for choosing our clinic. This is a computer-generated invoice.", leftMargin, doc.y, { align: "center", width: pageWidth });

  doc.end();
});

// ==================== DELETE ====================

/**
 * @desc    Permanently delete an invoice
 * @route   DELETE /api/billing/invoices/:id
 * @access  Admin
 */
export const deleteInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(id);

  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  // Only allow deleting draft or cancelled invoices
  if (!["draft", "cancelled"].includes(invoice.status)) {
    return ApiResponse.error(
      res,
      "Only draft or cancelled invoices can be permanently deleted",
      400
    );
  }

  await Invoice.findByIdAndDelete(id);

  ApiResponse.success(res, null, "Invoice deleted permanently");
});

/**
 * @desc    Get the logged-in patient's payment history
 * @route   GET /api/billing/invoices/my-payment-history
 * @access  Patient (Bearer token)
 *
 * Patient ID is derived from the auth token — never from a client param
 * (IDOR-safe). Merges TWO sources so nothing a patient actually paid is
 * missing, matching what admin's Payment History already shows:
 *
 *  1. Payment collection entries (status: "paid") — covers payments recorded
 *     directly (e.g. manual/legacy "Add Payment" entries) that were never
 *     linked to an invoice, so they'd otherwise be invisible here.
 *  2. Invoices with amountPaid > 0 that have NO matching Payment doc — covers
 *     invoices created with an initial payment via the admin "Create Invoice"
 *     flow, which sets Invoice.amountPaid directly without ever creating a
 *     Payment record.
 *
 * Invoices already represented by a linked Payment doc are excluded from (2)
 * to avoid double-counting the same money twice.
 *
 * Read-only: does not write to Payment or Invoice, does not backfill/link
 * anything. The underlying write-path gap (payments not always linked to an
 * invoice) is intentionally out of scope here.
 */
export const getMyPaymentHistory = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id;
  if (!patientId) {
    return ApiResponse.error(res, "Not authorized", 401);
  }

  const rawPayments = await Payment.find({ patient: patientId, status: "paid" })
    .populate("invoice", "invoiceNumber grandTotal")
    .sort({ createdAt: -1 })
    .lean();

  // Same fix as getPatientTotalPaid: real payments link to their invoice(s)
  // via settledInvoices[].invoiceId (what verifyPendingPayment actually
  // writes), not the legacy singular `invoice` field. Checking `invoice`
  // alone left almost every invoice looking "unlinked", so its amountPaid
  // was re-added below even though a Payment entry above already covers it.
  const linkedInvoiceIds = new Set(
    rawPayments.flatMap((p) => {
      const ids = p.invoice ? [String(p.invoice._id)] : [];
      if (Array.isArray(p.settledInvoices)) {
        ids.push(...p.settledInvoices.map((s) => String(s.invoiceId)));
      }
      return ids;
    })
  );

  const invoices = await Invoice.find({
    patient: patientId,
    amountPaid: { $gt: 0 },
    status: { $ne: "cancelled" },
    isVoided: { $ne: true },
  })
    .select("invoiceNumber invoiceDate amountPaid paymentMethod paymentStatus grandTotal items")
    .lean();

  const itemTypeLabels = {
    opd_fee: "OPD Fee",
    treatment: "Treatment",
    surgery: "Surgery",
    test: "Test",
    medicine: "Medicine",
    membership: "Membership",
    other: "Other",
  };

  const unlinkedInvoiceEntries = invoices
    .filter((inv) => !linkedInvoiceIds.has(String(inv._id)))
    .map((inv) => {
      const firstItem = inv.items?.[0];
      const service =
        firstItem?.description ||
        itemTypeLabels[firstItem?.itemType] ||
        "Treatment";

      // Normalise legacy "pay-at-clinic" to cash
      let paymentMode = inv.paymentMethod || "cash";
      if (paymentMode === "pay-at-clinic") paymentMode = "cash";

      return {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.invoiceDate,
        service,
        amountPaid: inv.amountPaid,
        paymentMethod: paymentMode,
        paymentStatus: inv.paymentStatus,
        grandTotal: inv.grandTotal,
        // No settledInvoices to derive a running balance from -- legacy
        // pre-write-path-fix invoice, not a real Payment record.
        dueAfterThisPayment: null,
      };
    });

  // Running Dues balance -- grandTotal minus the CUMULATIVE amount paid as of
  // this specific payment (previousAmountPaid + appliedAmount, both captured
  // by settledInvoices at write time), not a flat per-row calculation. Only
  // the PRIMARY (first) settled invoice is used when a payment somehow
  // settles more than one -- keeps this a single running number per row
  // rather than an ambiguous combined figure.
  const settledInvoiceIds = [
    ...new Set(
      rawPayments
        .map((p) => p.settledInvoices?.[0]?.invoiceId)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const settledInvoicesGrandTotals = settledInvoiceIds.length
    ? await Invoice.find({ _id: { $in: settledInvoiceIds } }).select("grandTotal").lean()
    : [];
  const grandTotalByInvoiceId = Object.fromEntries(
    settledInvoicesGrandTotals.map((inv) => [String(inv._id), inv.grandTotal])
  );

  const paymentEntries = rawPayments.map((p) => {
    let paymentMode = p.paymentMode || "cash";
    if (paymentMode === "pay-at-clinic") paymentMode = "cash";

    const primarySettlement = p.settledInvoices?.[0];
    let dueAfterThisPayment = null;
    if (primarySettlement) {
      const grandTotal = grandTotalByInvoiceId[String(primarySettlement.invoiceId)];
      if (grandTotal !== undefined) {
        const cumulativePaid = (primarySettlement.previousAmountPaid || 0) + (primarySettlement.appliedAmount || 0);
        dueAfterThisPayment = Math.max(0, grandTotal - cumulativePaid);
      }
    }

    return {
      _id: p._id,
      invoiceNumber: p.invoice?.invoiceNumber || null,
      date: p.createdAt,
      service: PAYMENT_TYPE_LABELS[p.type] || "Payment",
      amountPaid: p.amount,
      paymentMethod: paymentMode,
      paymentStatus: "paid",
      grandTotal: p.invoice?.grandTotal ?? p.amount,
      dueAfterThisPayment,
    };
  });

  const payments = [...paymentEntries, ...unlinkedInvoiceEntries].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  ApiResponse.success(res, payments, "Payment history fetched successfully");
});

/**
 * @desc    Get unpaid/partially-paid invoices for a patient (for collect-payment flow)
 * @route   GET /api/billing/patient/:patientId/unpaid-invoices
 * @access  Admin
 */
export const getPatientUnpaidInvoices = asyncHandler(async (req, res) => {
  const { patientId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  const patient = await Patient.findById(patientId).select("name phone email");
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  const rawInvoices = await Invoice.find({
    patient: patientId,
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: { $ne: "cancelled" },
    isVoided: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .select("invoiceNumber invoiceDate dueDate grandTotal amountPaid paymentStatus status items");

  const invoices = rawInvoices.map((inv) => {
    const balanceDue = Math.max(0, (inv.grandTotal || 0) - (inv.amountPaid || 0));

    // Derive category from first item type
    let category = "Other";
    if (inv.items && inv.items.length > 0) {
      const types = inv.items.map((item) => item.itemType);
      if (types.some((t) => ["treatment", "surgery"].includes(t))) {
        category = "Treatment";
      } else if (types.includes("membership")) {
        category = "Membership";
      } else if (types.includes("opd_fee")) {
        category = "OPD Fee";
      } else if (types.includes("test")) {
        category = "Test";
      } else if (types.includes("medicine")) {
        category = "Medicine";
      }
    }

    return {
      _id: inv._id,
      invoiceNumber: inv.invoiceNumber,
      date: inv.invoiceDate,
      dueDate: inv.dueDate,
      totalAmount: inv.grandTotal || 0,
      amountPaid: inv.amountPaid || 0,
      balanceDue,
      paymentStatus: inv.paymentStatus,
      status: inv.status,
      category,
    };
  });

  const totalPending = Math.round(
    invoices.reduce((sum, inv) => sum + inv.balanceDue, 0) * 100
  ) / 100;

  res.json({
    success: true,
    patient: { name: patient.name, phone: patient.phone, email: patient.email },
    totalPending,
    invoices,
  });
});
