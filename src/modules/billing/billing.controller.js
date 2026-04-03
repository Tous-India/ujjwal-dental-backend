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
  const { page = 1, limit = 10, patient, status, paymentStatus, clinic, from, to } = req.query;

  // Build query
  const query = {};

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    query.patient = patient;
  }

  if (status) {
    query.status = status;
  }

  if (paymentStatus) {
    query.paymentStatus = paymentStatus;
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    query.clinic = clinic;
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
  const { patient, clinic, appointment, items, discount, notes, terms } = req.body;

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

  // Create invoice
  const invoice = await Invoice.create({
    patient,
    clinic,
    appointment,
    items: processedItems,
    discount: discount || { percentage: 0, amount: 0 },
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

  // Cannot cancel paid invoices
  if (invoice.paymentStatus === "paid") {
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
  const { clinic, from, to } = req.query;

  // Date range (default: current month)
  const startDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const endDate = to ? new Date(to) : new Date();

  // Build match query
  const matchQuery = {
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $ne: "cancelled" },
  };

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    matchQuery.clinic = new mongoose.Types.ObjectId(clinic);
  }

  const stats = await Invoice.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalAmount: { $sum: "$grandTotal" },
        totalPaid: { $sum: "$amountPaid" },
        totalDue: { $sum: "$balanceDue" },
        paidCount: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
        },
        partialCount: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0] },
        },
        unpaidCount: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "unpaid"] }, 1, 0] },
        },
      },
    },
  ]);

  const result = stats[0] || {
    totalInvoices: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalDue: 0,
    paidCount: 0,
    partialCount: 0,
    unpaidCount: 0,
  };

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
