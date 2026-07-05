import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Invoice from "./invoice.model.js";
import Patient from "../patients/patient.model.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";

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
  const { page = 1, limit = 10, patient, status, paymentStatus, clinic, from, to, itemType } = req.query;

  // Build query
  const query = {};

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

  // Date range filter
  if (from || to) {
    query.invoiceDate = {};
    if (from) {
      query.invoiceDate.$gte = new Date(from);
    }
    if (to) {
      query.invoiceDate.$lte = new Date(to);
    }
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

  ApiResponse.paginated(res, invoices, {
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

  await invoice.recordPayment(amount);

  const updatedInvoice = await Invoice.findById(id)
    .populate("patient", "name phone");

  ApiResponse.success(res, { invoice: updatedInvoice }, "Payment recorded successfully");
});

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
  const query = { patient: patientId };
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
  const matchQuery = { status: { $ne: "cancelled" } };

  // Date window: only applied when the admin explicitly provides a range.
  // No date params → no date filter → all-time stats, consistent with the
  // invoice table which also shows all records when no date is selected.
  let startDate = null;
  let endDate = null;
  if (from || to) {
    matchQuery.invoiceDate = {};
    if (from) { startDate = new Date(from); matchQuery.invoiceDate.$gte = startDate; }
    if (to) { endDate = new Date(to); matchQuery.invoiceDate.$lte = endDate; }
  }

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    matchQuery.patient = new mongoose.Types.ObjectId(patient);
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    matchQuery.clinic = new mongoose.Types.ObjectId(clinic);
  }

  // Shared aggregation (same source the patient billing summary uses).
  const result = await Invoice.getStats(matchQuery);

  ApiResponse.success(
    res,
    {
      stats: result,
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
 * Uses the exact same invoice aggregation as the admin billing stats, scoped to
 * this patient's all-time non-cancelled invoices, so "Pending Amount" equals the
 * sum of per-invoice balanceDue (matches the admin Billing page).
 */
export const getMyBillingSummary = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id;
  if (!patientId) {
    return ApiResponse.error(res, "Not authorized", 401);
  }

  const matchQuery = {
    patient: new mongoose.Types.ObjectId(patientId),
    status: { $ne: "cancelled" },
  };

  const stats = await Invoice.getStats(matchQuery);

  ApiResponse.success(res, { stats }, "Billing summary fetched successfully");
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
    "Ujjwal Dental Clinic — A unit of Healing Fairy Health Care Pvt. Ltd.",
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
 * @desc    Get the logged-in patient's payment history derived from invoices
 * @route   GET /api/billing/invoices/my-payment-history
 * @access  Patient (Bearer token)
 *
 * Returns all non-cancelled invoices where amountPaid > 0, shaped as payment
 * entries. Patient ID is derived from the auth token — never from a client param
 * (IDOR-safe). Payments recorded via invoice.amountPaid (not Payment collection)
 * are correctly surfaced here.
 */
export const getMyPaymentHistory = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id;
  if (!patientId) {
    return ApiResponse.error(res, "Not authorized", 401);
  }

  const invoices = await Invoice.find({
    patient: patientId,
    amountPaid: { $gt: 0 },
    status: { $ne: "cancelled" },
  })
    .select("invoiceNumber invoiceDate amountPaid paymentMethod paymentStatus grandTotal items")
    .sort({ invoiceDate: -1 });

  const itemTypeLabels = {
    opd_fee: "OPD Fee",
    treatment: "Treatment",
    surgery: "Surgery",
    test: "Test",
    medicine: "Medicine",
    membership: "Membership",
    other: "Other",
  };

  const payments = invoices.map((inv) => {
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
    };
  });

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
