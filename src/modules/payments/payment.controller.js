import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { notify } from "../../utils/notifyHelper.js";
import { CLINIC_NAME } from "../../constants/clinic.js";
import { computeExternalIncomeTotal } from "../../utils/computeExternalIncomeTotal.js";
import { fireWhatsApp, sendWhatsApp } from "../../utils/whatsapp.js";
import { generateRazorpayPaymentLink } from "../../utils/razorpayLinks.js";
import Payment from "./payment.model.js";
import Invoice from "../billing/invoice.model.js";
import Appointment from "../appointments/appointment.model.js";
import Patient from "../patients/patient.model.js";
import MembershipPlan from "../memberships/membership.model.js";
import { TreatmentMaster } from "../treatments/treatment.model.js";
import { generateInvoice } from "../billing/invoice.service.js";
import SystemSettings from "../settings/settings.model.js";
import mongoose from "mongoose";
import { parseIstDateRange } from "../../utils/istDateRange.js";
import crypto from "crypto";
import PDFDocument from "pdfkit";
import { describeInvoice, pickPaymentDescription } from "../../utils/paymentDescription.js";
import ExternalIncome from "../externalIncome/externalIncome.model.js";
import {
  reconcilePaidPaymentLink,
  fetchRazorpayPaymentLink,
} from "../../utils/reconcilePaymentLink.js";

/**
 * PAYMENT CONTROLLER
 *
 * Handles:
 * - Payment recording (cash, card, UPI)
 * - Razorpay integration
 * - Refund processing
 */

// ── Shared label maps (used by list and PDF export) ──────────────────────────
const TYPE_LABELS = {
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

const MODE_LABELS = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  razorpay: "Razorpay",
  netbanking: "Net Banking",
  other: "Other",
};

/**
 * Builds a MongoDB filter query from payment list params.
 * Shared by getAllPayments and exportPaymentsPdf so filter logic never diverges.
 */
const buildPaymentQuery = ({ patient, status, paymentMode, type, clinic, from, to, appointment } = {}) => {
  const query = {};

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    query.patient = patient;
  }
  if (appointment && mongoose.Types.ObjectId.isValid(appointment)) {
    query.appointment = appointment;
  }
  if (status) {
    if (status.includes(",")) {
      query.status = { $in: status.split(",").map((s) => s.trim()) };
    } else {
      query.status = status;
    }
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
  if (from || to) {
    query.createdAt = parseIstDateRange(from, to);
  }

  return query;
};

// ==================== PAYMENT CRUD ====================

/**
 * @desc    Get all payments
 * @route   GET /api/payments?patient=&status=&paymentMode=&from=&to=
 * @access  Admin
 */
export const getAllPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, patient, status, paymentMode, type, clinic, from, to, search, appointment } = req.query;

  // Payment has no name/phone of its own — search resolves to matching
  // Patient _ids first, then filters payments by those ids (mirrors the
  // enquiry.controller.js search pattern, adapted for a populated ref).
  let searchPatientIds = null;
  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matchingPatients = await Patient.find({
      $or: [{ name: searchRegex }, { phone: searchRegex }],
    }).select("_id").lean();
    searchPatientIds = matchingPatients.map((p) => p._id);
    if (searchPatientIds.length === 0) {
      return ApiResponse.paginated(res, [], {
        page: parseInt(page),
        limit: parseInt(limit),
        total: 0,
      });
    }
  }

  const query = buildPaymentQuery({ patient, status, paymentMode, type, clinic, from, to, appointment });
  if (searchPatientIds) {
    // A specific patient id filter combined with search must AND correctly —
    // narrow to the intersection rather than letting one silently override
    // the other.
    if (query.patient) {
      const alreadyMatches = searchPatientIds.some((id) => id.equals(query.patient));
      query.patient = alreadyMatches ? query.patient : { $in: [] };
    } else {
      query.patient = { $in: searchPatientIds };
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
      // Lets the admin UI compute the 1-year refund window for completed
      // treatments without a second round-trip. Only covers payments with a
      // direct appointment ref — see resolveTreatmentClosure for the fuller
      // (invoice/settledInvoices) lookup used server-side for enforcement.
      .populate("appointment", "visitType treatmentStatus treatmentClosedAt")
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
 * @desc    Export filtered payments as PDF
 * @route   GET /api/payments/export/pdf
 * @access  Admin
 *
 * Layout
 * ------
 *  Paid tab     — Portrait  A4 (595.28 x 841.89 pt)
 *                 7 columns, 40pt margins, 515pt usable, columns total 500pt
 *  Refunded tab — Landscape A4 (841.89 x 595.28 pt)
 *                 9 columns, 40pt margins, 762pt usable, columns total 762pt
 *
 * Why "Rs." instead of "₹"
 * ------------------------
 *  PDFKit's built-in fonts (Helvetica, Times-Roman, Courier) use WinAnsiEncoding
 *  (Windows-1252). The Indian Rupee sign U+20B9 (₹) is NOT in that encoding —
 *  it renders as an apostrophe glyph, corrupts the x-cursor, and causes the next
 *  column's text to start at the wrong position (hence "AMOUNTMODE" header bleed
 *  and "1Razorpay" / "20,000Cash" in data rows). "Rs." is ASCII-safe.
 *
 * Why column widths total 500pt (not 515pt)
 * ------------------------------------------
 *  Columns filling exactly 515pt (usable width) leave 0pt inter-column gap.
 *  Any text that touches its right boundary bleeds into the next column.
 *  500pt total leaves a 15pt right buffer AND 2pt cell padding is applied
 *  per column so adjacent text never touches.
 *
 * Why explicit `y` variable instead of doc.y / moveDown
 * -------------------------------------------------------
 *  doc.text(t,x,y,{lineBreak:false}) updates doc.y to y+lineHeight after
 *  every call.  When multiple doc.text calls share the same row (one per
 *  column), doc.y drift accumulates.  doc.moveDown(n) then advances from
 *  the drifted position, not the intended row bottom.  Using a standalone
 *  `y` counter that advances by exactly ROW_H per row eliminates all drift.
 */
export const exportPaymentsPdf = asyncHandler(async (req, res) => {
  const { patient, status, paymentMode, type, clinic, from, to } = req.query;

  const query = buildPaymentQuery({ patient, status, paymentMode, type, clinic, from, to });

  const payments = await Payment.find(query)
    .populate("patient", "name phone")
    .populate("invoice", "invoiceNumber")
    .sort({ createdAt: -1 })
    .limit(5000);

  const isRefunded = status === "refunded";
  const tabLabel   = isRefunded ? "Refunded" : "Paid";

  // ── Logo resolution (dynamic import — no new top-level imports needed) ─────
  const { fileURLToPath } = await import("url");
  const { dirname, resolve } = await import("path");
  const { existsSync }  = await import("fs");
  const __dir   = dirname(fileURLToPath(import.meta.url));
  // Controller: backend/src/modules/payments/ → project root: 4 levels up
  const logoPath = resolve(__dir, "../../../../frontend/public/ujjwal-dental-logo.png");
  const hasLogo  = existsSync(logoPath);

  // ── Locale-independent date formatter: "01 Jul 2026" ──────────────────────
  const MTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtDate = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,"0")} ${MTH[dt.getMonth()]} ${dt.getFullYear()}`;
  };

  // ── Page dimensions ────────────────────────────────────────────────────────
  const PAGE_W = isRefunded ? 841.89 : 595.28;
  const PAGE_H = isRefunded ? 595.28 : 841.89;
  const MARGIN  = 40;
  const USABLE  = PAGE_W - MARGIN * 2; // 515.28pt portrait / 761.89pt landscape

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: MARGIN, autoFirstPage: true });

  const today    = fmtDate(new Date());
  const filename = `payment-history-${tabLabel.toLowerCase()}-${today.replace(/ /g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.on("error", (err) => {
    console.error("[exportPaymentsPdf] PDFDocument stream error:", err);
    if (!res.writableEnded) res.end();
  });
  doc.pipe(res);

  // ── Brand colours (frontend/src/main.jsx MUI theme) ───────────────────────
  const NAVY   = "#0D1B4A"; // secondary.main — clinic name, titles, summary text
  const ORANGE = "#F57C00"; // primary.main   — accent (unused in table body)

  // ── Column definitions ─────────────────────────────────────────────────────
  //
  //  Paid — Portrait, 515pt usable, columns total 500pt:
  //    85 + 65 + 95 + 65 + 75 + 55 + 60 = 500
  //
  //  Refunded — Landscape, 762pt usable, columns total 762pt:
  //    82 + 65 + 100 + 68 + 87 + 57 + 60 + 80 + 163 = 762
  //
  //  "AMT (Rs.)" header: 9 chars ≈ 48pt at 10pt Helvetica-Bold → fits in 55pt ✓
  //  "AMOUNT (Rs.)" at 12 chars ≈ 66pt → OVERFLOWS 55pt → this caused the bleed.
  //
  //  x positions assigned sequentially below.

  const paidCols = [
    { header: "RECEIPT NO.",  key: "receipt",      align: "left",  w: 85 },
    { header: "DATE",         key: "date",         align: "left",  w: 65 },
    { header: "PATIENT",      key: "patient",      align: "left",  w: 95 },
    { header: "INVOICE NO.",  key: "invoice",      align: "left",  w: 65 },
    { header: "SERVICE",      key: "service",      align: "left",  w: 75 },
    { header: "AMT (Rs.)",    key: "amount",       align: "right", w: 55 },
    { header: "MODE",         key: "mode",         align: "left",  w: 60 },
  ];

  const refundedCols = [
    { header: "RECEIPT NO.",  key: "receipt",      align: "left",  w: 82  },
    { header: "DATE",         key: "date",         align: "left",  w: 65  },
    { header: "PATIENT",      key: "patient",      align: "left",  w: 100 },
    { header: "INVOICE NO.",  key: "invoice",      align: "left",  w: 68  },
    { header: "SERVICE",      key: "service",      align: "left",  w: 87  },
    { header: "AMT (Rs.)",    key: "amount",       align: "right", w: 57  },
    { header: "MODE",         key: "mode",         align: "left",  w: 60  },
    { header: "REFUNDED ON",  key: "refundedAt",   align: "left",  w: 80  },
    { header: "REASON",       key: "refundReason", align: "left",  w: 163 },
  ];

  const cols = isRefunded ? refundedCols : paidCols;

  // Sequential x assignment
  let xAcc = MARGIN;
  for (const col of cols) { col.x = xAcc; xAcc += col.w; }

  const ROW_H  = 26;           // data row height (pt) — 9pt font; text at rowY+(ROW_H-9)/2 = rowY+8.5 → rowY+8
  const HDR_H  = 26;           // column header row height (pt)
  const PAD    = 6;            // cell padding: left-pad for left-aligned, right-pad for right-aligned
  const BOTTOM = PAGE_H - 55; // page-break threshold

  // ── Cell text position helpers ─────────────────────────────────────────────
  //  Left-aligned:  text starts at col.x+PAD, width = col.w-PAD
  //  Right-aligned: text ends   at col.x+col.w-PAD (PAD gap before next column)
  const cellX = (col) => col.align === "right" ? col.x        : col.x + PAD;
  const cellW = (col) => col.w - PAD;

  // ── Column header renderer (called on every page) ──────────────────────────
  const drawHeaders = (y) => {
    // Light indigo pastel background — softer than dark navy, still clearly distinct from data rows
    doc.rect(MARGIN, y, USABLE, HDR_H).fill("#E8EAF6");
    // Dark indigo text — 8pt keeps headers subordinate to 12pt body data
    doc.fillColor("#3730A3").fontSize(8).font("Helvetica-Bold");
    for (const col of cols) {
      doc.text(col.header, cellX(col), y + 9, {  // (HDR_H 26 - font 8) / 2 = 9 → vertically centred
        width:     cellW(col),
        align:     col.align,
        lineBreak: false,
        ellipsis:  true,   // ← prevents any header text from bleeding into adjacent column
      });
    }
    return y + HDR_H;
  };

  // ── Page branding header (first page only) ─────────────────────────────────
  let y = MARGIN;

  if (hasLogo) {
    // Logo 55x55pt at top-left, clinic text to its right
    doc.image(logoPath, MARGIN, y, { width: 55, height: 55 });
    const txtX = MARGIN + 65; // 55pt logo + 10pt gap
    const txtW = USABLE - 65;
    doc.fillColor(NAVY).fontSize(18).font("Helvetica-Bold");
    doc.text(CLINIC_NAME, txtX, y + 2, { width: txtW, lineBreak: false });
    y = MARGIN + 62; // below logo (55pt) + 7pt gap
  } else {
    // Centred fallback when no logo file is found
    doc.fillColor(NAVY).fontSize(18).font("Helvetica-Bold");
    doc.text(CLINIC_NAME, MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
    y += 26;
  }

  // Thin horizontal divider below header block
  doc.strokeColor("#D1D5DB").lineWidth(0.8).moveTo(MARGIN, y).lineTo(MARGIN + USABLE, y).stroke();
  y += 10;

  // Report title — 13pt bold, centered, navy
  doc.fillColor(NAVY).fontSize(13).font("Helvetica-Bold");
  doc.text(`Payment History - ${tabLabel}`, MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
  y += 20;

  // Filter / export info — 9pt, gray, centered
  const filterParts = [];
  if (from || to) filterParts.push(`Date: ${fmtDate(from)} to ${fmtDate(to)}`);
  if (paymentMode) filterParts.push(`Mode: ${MODE_LABELS[paymentMode] || paymentMode}`);
  if (type)        filterParts.push(`Type: ${TYPE_LABELS[type] || type}`);
  filterParts.push(`Exported: ${today}`);
  doc.fillColor("#6b7280").fontSize(9).font("Helvetica");
  doc.text(filterParts.join("   |   "), MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
  y += 14;

  // Summary stats — 10pt bold, centered, navy
  const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
  doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
  doc.text(
    `Total Records: ${payments.length}   |   Total Amount: Rs. ${totalAmount.toLocaleString("en-IN")}`,
    MARGIN, y, { align: "center", width: USABLE, lineBreak: false }
  );
  y += 18;

  // ── Table ──────────────────────────────────────────────────────────────────
  y = drawHeaders(y);

  for (let i = 0; i < payments.length; i++) {
    const pmt = payments[i];

    // Page break — new page, reset y, redraw column headers
    if (y + ROW_H > BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = drawHeaders(y);
    }

    const rowY = y;

    // Alternating row background: white / very light lavender
    doc.rect(MARGIN, rowY, USABLE, ROW_H).fill(i % 2 === 0 ? "#FFFFFF" : "#F8F8FF");

    // Row values — plain numbers for Amount column (Rs. only in header + summary)
    const vals = {
      receipt:      pmt.paymentNumber || "-",
      date:         fmtDate(pmt.paidAt || pmt.createdAt),
      patient:      pmt.patient?.name || "-",
      invoice:      pmt.invoice?.invoiceNumber || "-",
      service:      pmt.treatmentName || TYPE_LABELS[pmt.type] || pmt.type || "-",
      amount:       (pmt.amount || 0).toLocaleString("en-IN"),
      mode:         MODE_LABELS[pmt.paymentMode] || pmt.paymentMode || "-",
      refundedAt:   fmtDate(pmt.refund?.refundedAt),
      refundReason: pmt.refund?.reason || "-",
    };

    // Draw each cell at explicit (cellX, rowY+8) — (ROW_H-fontSize)/2 = (26-9)/2 = 8.5 → 8 → vertically centred
    doc.fillColor("#1a1a2e").fontSize(9).font("Helvetica");
    for (const col of cols) {
      doc.text(vals[col.key] ?? "-", cellX(col), rowY + 8, {
        width:     cellW(col),
        align:     col.align,
        lineBreak: false,
        ellipsis:  true,
      });
    }

    // Thin row bottom rule
    doc.strokeColor("#E5E7EB").lineWidth(0.5)
       .moveTo(MARGIN, rowY + ROW_H)
       .lineTo(MARGIN + USABLE, rowY + ROW_H)
       .stroke();

    y = rowY + ROW_H; // explicit tracker — never use doc.y or moveDown
  }

  // ── Footer — pinned to bottom of last page ─────────────────────────────────
  // y must be ≤ PAGE_H - MARGIN (= PDFKit's usable bottom boundary).
  // PAGE_H - 28 exceeded that boundary and caused PDFKit to auto-add a blank page.
  doc.fillColor("#9ca3af").fontSize(8).font("Helvetica");
  doc.text(
    `Generated by ${CLINIC_NAME} admin panel - ${today}`,
    MARGIN, PAGE_H - MARGIN - 10, { align: "center", width: USABLE, lineBreak: false }
  );

  doc.end();
});

/**
 * @desc    Export filtered payments as CSV (mirrors exportPaymentsPdf query logic)
 * @route   GET /api/payments/export/csv?status=&paymentMode=&type=&from=&to=
 * @access  Admin
 */
export const exportPaymentsCsv = asyncHandler(async (req, res) => {
  const { patient, status, paymentMode, type, clinic, from, to } = req.query;
  const query = buildPaymentQuery({ patient, status, paymentMode, type, clinic, from, to });

  const payments = await Payment.find(query)
    .populate("patient", "name")
    .populate("invoice", "invoiceNumber")
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();

  const isRefunded = status?.includes("refunded") || status?.includes("reversed");
  const tabLabel   = isRefunded ? "Refunded & Voided" : "Paid";

  const MTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtDate = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,"0")} ${MTH[dt.getMonth()]} ${dt.getFullYear()}`;
  };
  const today = fmtDate(new Date());

  const esc = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvRow = (...cells) => cells.map(esc).join(",");

  const baseHeaders = ["Date", "Receipt No.", "Patient", "Invoice No.", "Service", "Amount (Rs.)", "Mode"];
  const headers = isRefunded
    ? [...baseHeaders, "Refunded On", "Reason"]
    : baseHeaders;

  const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);

  const lines = [
    csvRow(CLINIC_NAME, "", `Payment History — ${tabLabel}`),
    csvRow("Exported:", today, from ? `From: ${fmtDate(from)}` : "", to ? `To: ${fmtDate(to)}` : ""),
    csvRow(`Records: ${payments.length}`, `Total: Rs. ${totalAmount.toLocaleString("en-IN")}`),
    "",
    csvRow(...headers),
  ];

  for (const p of payments) {
    const baseRow = [
      fmtDate(p.paidAt || p.createdAt),
      p.paymentNumber || "-",
      p.patient?.name || "-",
      p.invoice?.invoiceNumber || "-",
      p.treatmentName || TYPE_LABELS[p.type] || p.type || "-",
      (p.amount || 0).toLocaleString("en-IN"),
      MODE_LABELS[p.paymentMode] || p.paymentMode || "-",
    ];
    const row = isRefunded
      ? [...baseRow, fmtDate(p.refund?.refundedAt), p.refund?.reason || "-"]
      : baseRow;
    lines.push(csvRow(...row));
  }

  const csv = lines.join("\r\n");
  const filename = `payment-history-${tabLabel.toLowerCase().replace(/\s+&\s+|\s+/g, "-")}-${today.replace(/ /g, "-")}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send("﻿" + csv);
});

/**
 * @desc    Export combined ledger: patient payments + refunds + external income
 * @route   GET /api/payments/export/combined?format=csv|pdf&from=&to=
 * @access  Admin
 *
 * Voided external income and payments linked to voided invoices are excluded,
 * matching how getPaymentSummaryStats computes on-screen totals. Reversed
 * payments are excluded (not real money events in the accounting ledger).
 *
 * Columns: Date | Type | Patient/Source | Description | Amount (Rs.) | Mode | Reference | Recorded By
 */
export const exportCombined = asyncHandler(async (req, res) => {
  const { from, to, format = "pdf" } = req.query;

  // ── Logo resolution ────────────────────────────────────────────────────────
  const { fileURLToPath } = await import("url");
  const { dirname, resolve } = await import("path");
  const { existsSync }  = await import("fs");
  const __dir   = dirname(fileURLToPath(import.meta.url));
  const logoPath = resolve(__dir, "../../../../frontend/public/ujjwal-dental-logo.png");
  const hasLogo  = existsSync(logoPath);

  // ── 1. Voided invoice ids ──────────────────────────────────────────────────
  const voidedInvoiceIds = await Invoice.find({ isVoided: true }).distinct("_id");

  // ── 2. Payments — paid, refunded, refund_pending (excludes reversed) ───────
  const paymentQuery = { status: { $in: ["paid", "refunded", "refund_pending"] } };
  if (from || to) paymentQuery.createdAt = parseIstDateRange(from, to);
  if (voidedInvoiceIds.length > 0) {
    paymentQuery.invoice = { $nin: voidedInvoiceIds };
    paymentQuery["settledInvoices.invoiceId"] = { $nin: voidedInvoiceIds };
  }

  const payments = await Payment.find(paymentQuery)
    .populate("patient", "name")
    .populate("invoice", "invoiceNumber")
    .populate("recordedBy", "name")
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();

  // ── 3. External income — non-voided ───────────────────────────────────────
  const incomeQuery = { isVoided: false };
  if (from || to) incomeQuery.date = parseIstDateRange(from, to);

  const incomes = await ExternalIncome.find(incomeQuery)
    .populate("recordedBy", "name")
    .sort({ date: -1 })
    .lean();

  // ── 4. Shared helpers ──────────────────────────────────────────────────────
  const MTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtDate = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,"0")} ${MTH[dt.getMonth()]} ${dt.getFullYear()}`;
  };

  // ── 5. Build rows ──────────────────────────────────────────────────────────
  const pmtRows = payments.map((p) => {
    const isRefund = p.status === "refunded" || p.status === "refund_pending";
    return {
      type:          isRefund ? "Refund" : "Payment",
      date:          p.paidAt || p.createdAt,
      patientSource: p.patient?.name || "-",
      description:   p.treatmentName || TYPE_LABELS[p.type] || p.type || "-",
      amount:        isRefund ? (p.refund?.amount ?? p.amount ?? 0) : (p.amount || 0),
      mode:          MODE_LABELS[p.paymentMode] || p.paymentMode || "-",
      reference:     p.invoice?.invoiceNumber || p.paymentNumber || "-",
      recordedBy:    p.recordedBy?.name || "-",
    };
  });

  const incomeRows = incomes.map((i) => ({
    type:          "External Income",
    date:          i.date,
    patientSource: i.clinicName || "-",
    description:   i.notes || i.treatment || "-",
    amount:        i.amount || 0,
    mode:          "-",
    reference:     i.treatment || "-",
    recordedBy:    i.recordedBy?.name || "-",
  }));

  // Merge, sort newest first
  const allRows = [...pmtRows, ...incomeRows].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  // ── 6. Totals — computed exactly as getPaymentSummaryStats ─────────────────
  const patientCollected = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalRefunds     = payments
    .filter((p) => p.status === "refunded" || p.status === "refund_pending")
    .reduce((s, p) => s + (p.refund?.amount || 0), 0);
  const totalExternal    = incomes.reduce((s, i) => s + (i.amount || 0), 0);
  const totalCollected   = patientCollected + totalExternal;
  const netCollection    = totalCollected - totalRefunds;

  const paidCount     = pmtRows.filter((r) => r.type === "Payment").length;
  const refundCount   = pmtRows.filter((r) => r.type === "Refund").length;
  const incomeCount   = incomeRows.length;

  const today = fmtDate(new Date());

  // ── 7a. CSV ────────────────────────────────────────────────────────────────
  if (format === "csv") {
    const esc = (v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const csvRow = (...cells) => cells.map(esc).join(",");

    const lines = [
      csvRow(CLINIC_NAME, "", "", "Payment History — All Sources", "", "", "", ""),
      csvRow("Exported:", today,
        from ? `From: ${from}` : "", to ? `To: ${to}` : "",
        "", "", "", ""),
      csvRow(`Records: ${allRows.length}`,
        `Payments: ${paidCount}`, `Refunds: ${refundCount}`, `External: ${incomeCount}`,
        "", "", "", ""),
      "",
      csvRow("Date", "Type", "Patient / Source", "Description",
             "Amount (Rs.)", "Mode", "Reference", "Recorded By"),
    ];

    for (const row of allRows) {
      lines.push(csvRow(
        fmtDate(row.date),
        row.type,
        row.patientSource,
        row.description,
        row.amount,
        row.mode,
        row.reference,
        row.recordedBy,
      ));
    }

    lines.push("");
    lines.push(csvRow("", "", "", "TOTALS", "", "", "", ""));
    lines.push(csvRow("", "", "", "Patient Collected (gross)", patientCollected.toLocaleString("en-IN"), "", "", ""));
    lines.push(csvRow("", "", "", "Total Refunds", totalRefunds.toLocaleString("en-IN"), "", "", ""));
    lines.push(csvRow("", "", "", "Total External Income", totalExternal.toLocaleString("en-IN"), "", "", ""));
    lines.push(csvRow("", "", "", "Total Collected", totalCollected.toLocaleString("en-IN"), "", "", ""));
    lines.push(csvRow("", "", "", "Net Collection", netCollection.toLocaleString("en-IN"), "", "", ""));

    const csv = lines.join("\r\n");
    const filename = `payment-history-all-${today.replace(/ /g, "-")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("﻿" + csv); // UTF-8 BOM so Excel opens without garble
  }

  // ── 7b. PDF — A4 landscape ─────────────────────────────────────────────────
  const PAGE_W = 841.89;  // A4 landscape
  const PAGE_H = 595.28;
  const MARGIN  = 40;
  const USABLE  = PAGE_W - MARGIN * 2; // 761.89 pt

  // 8 columns, totalling 762 pt
  const cols = [
    { header: "DATE",             key: "date",          align: "left",  w: 70  },
    { header: "TYPE",             key: "type",          align: "left",  w: 75  },
    { header: "PATIENT / SOURCE", key: "patientSource", align: "left",  w: 110 },
    { header: "DESCRIPTION",      key: "description",   align: "left",  w: 120 },
    { header: "AMT (Rs.)",        key: "amount",        align: "right", w: 65  },
    { header: "MODE",             key: "mode",          align: "left",  w: 60  },
    { header: "REFERENCE",        key: "reference",     align: "left",  w: 85  },
    { header: "RECORDED BY",      key: "recordedBy",    align: "left",  w: 177 },
  ];

  let xAcc = MARGIN;
  for (const col of cols) { col.x = xAcc; xAcc += col.w; }

  const ROW_H  = 24;
  const HDR_H  = 26;
  const PAD    = 6;
  const BOTTOM = PAGE_H - 55;

  const NAVY = "#0D1B4A";

  const cellX = (col) => col.align === "right" ? col.x        : col.x + PAD;
  const cellW = (col) => col.w - PAD;

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: MARGIN, autoFirstPage: true });
  const filename = `payment-history-all-${today.replace(/ /g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.on("error", (err) => {
    console.error("[exportCombined] PDFDocument stream error:", err);
    if (!res.writableEnded) res.end();
  });
  doc.pipe(res);

  const drawHeaders = (y) => {
    doc.rect(MARGIN, y, USABLE, HDR_H).fill("#E8EAF6");
    doc.fillColor("#3730A3").fontSize(8).font("Helvetica-Bold");
    for (const col of cols) {
      doc.text(col.header, cellX(col), y + 9, {
        width: cellW(col), align: col.align, lineBreak: false, ellipsis: true,
      });
    }
    return y + HDR_H;
  };

  // ── Branding header ────────────────────────────────────────────────────────
  let y = MARGIN;
  if (hasLogo) {
    doc.image(logoPath, MARGIN, y, { width: 55, height: 55 });
    const txtX = MARGIN + 65;
    const txtW = USABLE - 65;
    doc.fillColor(NAVY).fontSize(18).font("Helvetica-Bold");
    doc.text(CLINIC_NAME, txtX, y + 2, { width: txtW, lineBreak: false });
    y = MARGIN + 62;
  } else {
    doc.fillColor(NAVY).fontSize(18).font("Helvetica-Bold");
    doc.text(CLINIC_NAME, MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
    y += 26;
  }

  doc.strokeColor("#D1D5DB").lineWidth(0.8).moveTo(MARGIN, y).lineTo(MARGIN + USABLE, y).stroke();
  y += 10;

  doc.fillColor(NAVY).fontSize(13).font("Helvetica-Bold");
  doc.text("Payment History — All Sources", MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
  y += 20;

  const filterParts = [];
  if (from || to) filterParts.push(`Date: ${fmtDate(from)} to ${fmtDate(to)}`);
  filterParts.push(`Exported: ${today}`);
  doc.fillColor("#6b7280").fontSize(9).font("Helvetica");
  doc.text(filterParts.join("   |   "), MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
  y += 14;

  doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
  doc.text(
    `Total Records: ${allRows.length}   |   Payments: ${paidCount}   |   Refunds: ${refundCount}   |   External: ${incomeCount}`,
    MARGIN, y, { align: "center", width: USABLE, lineBreak: false }
  );
  y += 18;

  // ── Type → colour map ──────────────────────────────────────────────────────
  const TYPE_COLOR = {
    "Payment":         "#166534", // green
    "Refund":          "#9a3412", // red-orange
    "External Income": "#1e40af", // blue
  };

  // ── Table ──────────────────────────────────────────────────────────────────
  y = drawHeaders(y);

  for (let i = 0; i < allRows.length; i++) {
    if (y + ROW_H > BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = drawHeaders(y);
    }

    const row   = allRows[i];
    const rowY  = y;

    doc.rect(MARGIN, rowY, USABLE, ROW_H).fill(i % 2 === 0 ? "#FFFFFF" : "#F8F8FF");

    const vals = {
      date:          fmtDate(row.date),
      type:          row.type,
      patientSource: row.patientSource,
      description:   row.description,
      amount:        (row.amount || 0).toLocaleString("en-IN"),
      mode:          row.mode,
      reference:     row.reference,
      recordedBy:    row.recordedBy,
    };

    for (const col of cols) {
      const color = col.key === "type" ? (TYPE_COLOR[vals.type] || "#1a1a2e") : "#1a1a2e";
      doc.fillColor(color).fontSize(9).font(col.key === "type" ? "Helvetica-Bold" : "Helvetica");
      doc.text(vals[col.key] ?? "-", cellX(col), rowY + 7, {
        width: cellW(col), align: col.align, lineBreak: false, ellipsis: true,
      });
    }

    doc.strokeColor("#E5E7EB").lineWidth(0.5)
       .moveTo(MARGIN, rowY + ROW_H)
       .lineTo(MARGIN + USABLE, rowY + ROW_H)
       .stroke();

    y = rowY + ROW_H;
  }

  // ── Totals block ───────────────────────────────────────────────────────────
  const SUMMARY_H = 100;
  if (y + SUMMARY_H > BOTTOM) { doc.addPage(); y = MARGIN; }

  y += 18; // extra breathing space above separator so block is clearly detached from last row
  doc.strokeColor("#D1D5DB").lineWidth(0.8).moveTo(MARGIN, y).lineTo(MARGIN + USABLE, y).stroke();
  y += 10;

  const fmt  = (n) => `Rs. ${n.toLocaleString("en-IN")}`;
  // Right-align to the table's right edge (MARGIN + USABLE), not the page edge.
  // col2 + 90 = MARGIN + USABLE  →  value right edge matches table right edge exactly.
  // col1 + 160 = col2  →  label has 160pt, fits "Patient Collected (gross)" at 10pt without crowding.
  const col2 = MARGIN + USABLE - 90;  // was MARGIN + USABLE - 80; value now stops at table edge
  const col1 = MARGIN + USABLE - 250; // was MARGIN + USABLE - 220; 160pt label column (was 140pt)

  const summaryRows = [
    ["Patient Collected (gross)", fmt(patientCollected)],
    ["Total Refunds",             fmt(totalRefunds)],
    ["Total External Income",     fmt(totalExternal)],
    ["Total Collected",           fmt(totalCollected)],
    ["Net Collection",            fmt(netCollection)],
  ];

  for (const [label, value] of summaryRows) {
    const isNet = label === "Net Collection";
    doc.fillColor(isNet ? NAVY : "#374151")
       .fontSize(isNet ? 11 : 10)
       .font(isNet ? "Helvetica-Bold" : "Helvetica");
    doc.text(label, col1, y, { width: 160, align: "right", lineBreak: false });
    doc.fillColor(isNet ? NAVY : "#374151")
       .font("Helvetica-Bold");
    doc.text(value, col2, y, { width: 90, align: "right", lineBreak: false });
    y += 16;
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  doc.fillColor("#9ca3af").fontSize(8).font("Helvetica");
  doc.text(
    `Generated by ${CLINIC_NAME} admin panel — ${today}`,
    MARGIN, PAGE_H - MARGIN - 10, { align: "center", width: USABLE, lineBreak: false }
  );

  doc.end();
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

    if (invoiceDoc.paymentStatus === "paid" || invoiceDoc.status === "paid") {
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

  fireWhatsApp(populatedPayment.patient?.phone, "payment_recorded", {
    amount,
    description: pickPaymentDescription(
      notes,
      describeInvoice(populatedPayment.invoice),
      populatedPayment.invoice ? undefined : "Advance payment"
    ),
    invoiceNumber: populatedPayment.invoice?.invoiceNumber,
  }, populatedPayment.patient?.name);

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

  fireWhatsApp(populatedPayment.patient?.phone, "payment_recorded", {
    amount,
    description: notes || "OPD Fee",
    invoiceNumber: undefined,
  }, populatedPayment.patient?.name);

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

  fireWhatsApp(populatedPayment.patient?.phone, "payment_recorded", {
    amount,
    description: notes || `Membership: ${planName || "Plan"}`,
    invoiceNumber: undefined,
  }, populatedPayment.patient?.name);

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

  const payment = await Payment.createSafe(paymentData);

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

    fireWhatsApp(populatedPayment.patient?.phone, "payment_recorded", {
      amount: payment.amount,
      description: pickPaymentDescription(payment.treatmentName, payment.notes),
      invoiceNumber: populatedPayment.invoice?.invoiceNumber,
    }, populatedPayment.patient?.name);
  }
});

/**
 * @desc    Razorpay webhook handler
 * @route   POST /api/payments/razorpay/webhook
 * @access  Public (Razorpay server)
 */
/**
 * @desc    Verify a Razorpay payment link's REAL status and reconcile if paid
 * @route   POST /api/payments/verify-razorpay-link/:invoiceId
 * @access  Admin / clinic_manager (checkPermission payments:edit)
 *
 * The safety net for a missed webhook. A real one happened: payment_link.paid
 * was not enabled on the Razorpay webhook, so a patient paid and the CRM
 * showed the invoice unpaid indefinitely. Webhooks can also fail for network
 * reasons, downtime, or signature problems -- so when a patient says "I
 * already paid", admin can ask Razorpay directly instead of taking their word
 * or hunting through a dashboard.
 *
 * Never trusts our own stored state about whether the link was paid: it asks
 * Razorpay, and reconciles ONLY if Razorpay says "paid". Reconciliation runs
 * through the same shared function the webhook uses, so a manually-verified
 * payment is indistinguishable from a webhook-reconciled one.
 */
export const verifyRazorpayPaymentLink = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    return ApiResponse.error(res, "Invalid invoice ID", 400);
  }

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  const linkId = invoice.paymentLink?.id;
  if (!linkId) {
    return ApiResponse.error(
      res,
      "No Razorpay payment link was generated for this invoice, so there is nothing to verify.",
      400
    );
  }

  // Fast path: if a Payment already exists for this link, report that WITHOUT
  // calling Razorpay or touching anything. This is the idempotency case an
  // admin hits by clicking Verify after the webhook already worked.
  const existingPayment = await Payment.findOne({ razorpayPaymentLinkId: linkId });
  if (existingPayment || invoice.paymentLink?.status === "paid") {
    return ApiResponse.success(
      res,
      {
        outcome: "already_reconciled",
        razorpayStatus: invoice.paymentLink?.status || "paid",
        invoice,
        payment: existingPayment || null,
      },
      "This payment was already recorded — no action taken."
    );
  }

  let link;
  try {
    link = await fetchRazorpayPaymentLink(linkId);
  } catch (err) {
    return ApiResponse.error(
      res,
      `Could not reach Razorpay to verify this payment: ${err.message}`,
      err.statusCode || 502
    );
  }

  // Razorpay's own vocabulary: created | partially_paid | paid | cancelled | expired
  if (link.status !== "paid") {
    return ApiResponse.success(
      res,
      { outcome: "not_paid", razorpayStatus: link.status, amountPaid: (link.amount_paid || 0) / 100 },
      `Razorpay shows this link as "${link.status}" — no payment has been received, so nothing was changed.`
    );
  }

  // Genuinely paid but unrecorded: reconcile via the SAME path the webhook uses.
  // reference_id may carry the per-session appointment (invoiceId:appointmentId).
  let sessionAppointmentId = null;
  if (link.reference_id) {
    const [, refAppointmentId] = String(link.reference_id).split(":");
    if (refAppointmentId && mongoose.Types.ObjectId.isValid(refAppointmentId)) {
      sessionAppointmentId = refAppointmentId;
    }
  }

  const result = await reconcilePaidPaymentLink({
    invoice,
    linkEntity: link,
    paidPaymentEntity: null, // the underlying payment id isn't in this response
    sessionAppointmentId,
    source: "manual-verify",
  });

  if (result.alreadyReconciled) {
    return ApiResponse.success(
      res,
      { outcome: "already_reconciled", razorpayStatus: link.status, payment: result.payment || null },
      "This payment was already recorded — no action taken."
    );
  }

  const fresh = await Invoice.findById(invoiceId);
  return ApiResponse.success(
    res,
    {
      outcome: "reconciled",
      razorpayStatus: link.status,
      appliedAmount: result.appliedAmount,
      payment: result.payment,
      invoice: fresh,
    },
    `Payment verified with Razorpay and recorded (₹${result.appliedAmount}).`
  );
});

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

    case "payment_link.paid": {
      // Admin-generated Payment Link flow (razorpayLinks.js) -- distinct from
      // the payment.captured case above (embedded-checkout Orders API flow,
      // keyed off Payment.razorpayOrderId). Here there is no pre-existing
      // pending Payment document to find -- the link was generated directly
      // against an Invoice, so we look the invoice up and create the Payment
      // now, reusing the same settledInvoices-only pattern proven in
      // collectPayment/recordAdminPayment (never sets payment.invoice --
      // that would double-apply via the post-save hook, since amountPaid is
      // set directly on the invoice below).
      const linkEntity = payload.payment_link?.entity;
      const paidPaymentEntity = payload.payment?.entity; // the underlying payment that settled the link

      if (!linkEntity) {
        console.error("[Webhook] payment_link.paid: missing payload.payment_link.entity");
        break;
      }

      // Look up by reference_id (= invoice._id, set at link creation time --
      // OR `${invoiceId}:${appointmentId}` for a post-hoc/per-session
      // collection generated with a referenceAppointmentId, see
      // razorpayLinks.js) first; fall back to a stored paymentLink.id match
      // in case reference_id is ever missing/stale.
      let invoice = null;
      let sessionAppointmentId = null;
      if (linkEntity.reference_id) {
        const [refInvoiceId, refAppointmentId] = String(linkEntity.reference_id).split(":");
        if (refInvoiceId && mongoose.Types.ObjectId.isValid(refInvoiceId)) {
          invoice = await Invoice.findById(refInvoiceId);
        }
        if (refAppointmentId && mongoose.Types.ObjectId.isValid(refAppointmentId)) {
          sessionAppointmentId = refAppointmentId;
        }
      }
      if (!invoice && linkEntity.id) {
        invoice = await Invoice.findOne({ "paymentLink.id": linkEntity.id });
      }

      if (!invoice) {
        console.error(
          `[Webhook] payment_link.paid: no invoice found for reference_id=${linkEntity.reference_id} / link id=${linkEntity.id}`
        );
        break;
      }

      // Reconciliation -- applying the money, creating the Payment, syncing
      // the appointment and notifying -- lives in ONE shared function used by
      // BOTH this webhook and the manual Verify Payment endpoint, so the two
      // paths can never drift into applying money differently. It is
      // idempotent: a webhook and a manual verify racing on the same link
      // still produce exactly one Payment.
      const result = await reconcilePaidPaymentLink({
        invoice,
        linkEntity,
        paidPaymentEntity,
        sessionAppointmentId,
        source: "webhook",
      });

      if (result.alreadyReconciled) {
        console.log(
          `[Webhook] payment_link.paid already reconciled for invoice ${invoice.invoiceNumber} (${result.reason})`
        );
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
          refundedAt: payment.refund?.refundedAt || new Date(),
          razorpayError: null,  // clear any earlier failure note
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

const REFUND_WINDOW_DAYS = 365;

/**
 * Trace payment -> invoice -> appointment to find a closed treatment's
 * treatmentClosedAt (the moment Close Treatment Plan was used). Tries, in order:
 *   1. payment.appointment (direct ref — set for bookings created via createAppointment
 *      and via recordPayment when the caller passes an appointment id)
 *   2. payment.invoice -> invoice.appointment (single-invoice payments)
 *   3. payment.settledInvoices[0].invoiceId -> invoice.appointment, but ONLY when there
 *      is exactly one settled invoice — multi-invoice settlements (the admin
 *      "settle oldest pending invoices" flow, which intentionally never sets
 *      payment.invoice) can't be traced to one appointment unambiguously.
 * Returns null when no appointment can be resolved (historical data gap) —
 * callers must treat null as "no window restriction", not an error.
 */
const resolveTreatmentClosure = async (payment) => {
  let appointment = null;

  if (payment.appointment) {
    appointment = await Appointment.findById(payment.appointment)
      .select("visitType treatmentStatus treatmentClosedAt")
      .lean();
  }

  if (!appointment && payment.invoice) {
    const invoice = await Invoice.findById(payment.invoice).select("appointment").lean();
    if (invoice?.appointment) {
      appointment = await Appointment.findById(invoice.appointment)
        .select("visitType treatmentStatus treatmentClosedAt")
        .lean();
    }
  }

  if (!appointment && payment.settledInvoices?.length === 1) {
    const invoice = await Invoice.findById(payment.settledInvoices[0].invoiceId)
      .select("appointment")
      .lean();
    if (invoice?.appointment) {
      appointment = await Appointment.findById(invoice.appointment)
        .select("visitType treatmentStatus treatmentClosedAt")
        .lean();
    }
  }

  if (!appointment || appointment.visitType !== "treatment" || !appointment.treatmentStatus || !appointment.treatmentClosedAt) {
    return null;
  }

  return appointment;
};

/**
 * @desc    Process refund
 * @route   POST /api/payments/:id/refund
 * @access  Admin
 *
 * Two paths:
 *   1. Razorpay payment: attempts Razorpay API refund. On success → status "refunded".
 *      On API failure → status "refund_pending" + structured 400 so frontend can offer
 *      manual confirmation without losing the refund reason/amount.
 *   2. Offline payment (cash/upi/card): always succeeds locally → status "refunded".
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

  if (payment.status === "refunded") {
    return ApiResponse.error(res, "Payment is already refunded", 400);
  }

  if (payment.status !== "paid") {
    return ApiResponse.error(res, "Can only refund paid payments", 400);
  }

  const refundAmount = amount || payment.amount;

  if (refundAmount <= 0) {
    return ApiResponse.error(res, "Refund amount must be greater than 0", 400);
  }

  // A refund tied to a completed treatment (closed via Close Treatment Plan) gets
  // a 1-year window instead of the usual amount cap — Sunny's explicit goodwill/
  // compensation-refund allowance. Every other payment keeps the original hard cap.
  const closedTreatment = await resolveTreatmentClosure(payment);
  const exceedsCollectedAmount = refundAmount > payment.amount;

  if (closedTreatment) {
    const daysSinceClosed = (Date.now() - new Date(closedTreatment.treatmentClosedAt).getTime()) / 86400000;
    if (daysSinceClosed > REFUND_WINDOW_DAYS) {
      return ApiResponse.error(
        res,
        "Refund window has expired for this completed treatment (1 year limit)",
        400,
      );
    }
    // Within window: amount may exceed payment.amount (goodwill refund) — no cap here.
  } else if (exceedsCollectedAmount) {
    return ApiResponse.error(res, "Refund amount cannot exceed payment amount", 400);
  }

  // ── Path 1: Razorpay payment ────────────────────────────────────────────────
  if (payment.paymentMode === "razorpay" && payment.razorpayPaymentId) {
    try {
      const Razorpay = (await import("razorpay")).default;
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const rzpRefund = await razorpay.payments.refund(payment.razorpayPaymentId, {
        amount: Math.round(refundAmount * 100),
        notes: { reason: reason || "Refund requested" },
      });

      await payment.processRefund(req.user?._id, reason, rzpRefund.id, refundAmount, exceedsCollectedAmount);

      // Update linked invoice
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

      return ApiResponse.success(res, { payment: updatedPayment }, "Refund processed successfully");
    } catch (error) {
      console.error("[Refund] Razorpay API failed — writing refund_pending:", error);

      // Write refund_pending so the admin can manually confirm without re-entering details
      payment.status = "refund_pending";
      payment.refund = {
        amount: refundAmount,
        refundedAt: new Date(),
        refundedBy: req.user?._id,
        reason,
        razorpayError: error?.error?.description || error?.message || "Unknown Razorpay error",
        exceedsCollectedAmount,
      };
      await payment.save();

      return res.status(400).json({
        success: false,
        code: "RAZORPAY_API_FAILED",
        message: `Razorpay refund failed: ${error?.error?.description || error?.message}`,
        canConfirmManual: true,
        paymentId: payment._id,
      });
    }
  }

  // ── Path 2: Offline payment (cash/upi/card) ─────────────────────────────────
  await payment.processRefund(req.user?._id, reason, undefined, refundAmount, exceedsCollectedAmount);

  // Update linked invoice
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

  return ApiResponse.success(res, { payment: updatedPayment }, "Refund processed successfully");
});

/**
 * @desc    Confirm a manual refund after Razorpay API failure
 * @route   POST /api/payments/:id/confirm-manual-refund
 * @access  Admin
 */
export const confirmManualRefund = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { manualMethod } = req.body;

  if (!["cash", "upi", "bank_transfer"].includes(manualMethod)) {
    return ApiResponse.error(res, "manualMethod must be cash, upi, or bank_transfer", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid payment ID", 400);
  }

  const payment = await Payment.findById(id);
  if (!payment) return ApiResponse.error(res, "Payment not found", 404);

  if (payment.status !== "refund_pending") {
    return ApiResponse.error(res, "Only refund_pending payments can be manually confirmed", 400);
  }

  await payment.confirmManualRefund(req.user?._id, manualMethod);

  const updatedPayment = await Payment.findById(id)
    .populate("patient", "name phone")
    .populate("invoice", "invoiceNumber grandTotal balanceDue");

  return ApiResponse.success(res, { payment: updatedPayment }, "Refund confirmed as manually processed");
});

// ==================== STATISTICS ====================

/**
 * @desc    Date-range summary for the Payment History page: Total Collected,
 *          Total Refunded, Net Collection, Transactions -- computed directly
 *          from the Payment collection only (never Invoice.grandTotal/
 *          amountPaid), to stay clear of the invoice-corruption bug class
 *          found and fixed earlier tonight.
 * @route   GET /api/payments/summary-stats?from=&to=
 * @access  Admin
 *
 * Date-field choice: totalCollected/transactions use Payment.createdAt (when
 * the original payment happened). totalRefunded uses refund.refundedAt (when
 * the refund itself happened), not the original payment's createdAt -- a
 * payment collected last month but refunded this month should count as
 * THIS month's refund, matching how a clinic actually reads "this period's"
 * financials (money that left the account this period), not when the
 * original (now-reversed) transaction was recorded.
 */
export const getPaymentSummaryStats = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const createdAtRange = parseIstDateRange(from, to);

  const collectedMatch = { status: { $in: ["paid", "refunded", "refund_pending"] } };
  if (from || to) collectedMatch.createdAt = createdAtRange;

  // Exclude payments tied to a voided invoice -- voiding is a pure
  // data-entry correction (no real money involved), never a refund, and
  // void never touches the linked Payment document itself (see
  // voidInvoice in billing.controller.js). $nin on an array field
  // (settledInvoices.invoiceId) excludes the doc if ANY element matches;
  // payments with no invoice link at all are unaffected. Deliberately NOT
  // applied to refundedMatch below -- refunded money is a separate,
  // already-correct concept that must not be conflated with void.
  const voidedInvoiceIds = await Invoice.find({ isVoided: true }).distinct("_id");
  if (voidedInvoiceIds.length > 0) {
    collectedMatch.invoice = { $nin: voidedInvoiceIds };
    collectedMatch["settledInvoices.invoiceId"] = { $nin: voidedInvoiceIds };
  }

  const refundedMatch = {
    status: { $in: ["refunded", "refund_pending"] },
    "refund.amount": { $exists: true, $ne: null },
  };
  if (from || to) refundedMatch["refund.refundedAt"] = createdAtRange;

  const transactionMatch = { status: "paid" };
  if (from || to) transactionMatch.createdAt = createdAtRange;

  const [collectedResult, refundedResult, transactionCount] = await Promise.all([
    Payment.aggregate([
      { $match: collectedMatch },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: refundedMatch },
      { $group: { _id: null, total: { $sum: "$refund.amount" } } },
    ]),
    Payment.countDocuments(transactionMatch),
  ]);

  const patientCollected = collectedResult[0]?.total || 0;
  const totalRefunded = refundedResult[0]?.total || 0;

  // External income (another source revenue) — added in ONE shared place
  // (computeExternalIncomeTotal) so the total is consistent across P&L and
  // Payment History. This is the only call site in payment.controller.js.
  const externalIncome = await computeExternalIncomeTotal({ from, to });
  const totalCollected = patientCollected + externalIncome;

  ApiResponse.success(
    res,
    {
      totalCollected,
      externalIncome,
      totalRefunded,
      netCollection: totalCollected - totalRefunded,
      transactionCount,
    },
    "Payment summary stats fetched successfully"
  );
});

/**
 * @desc    Get payment statistics
 * @route   GET /api/payments/stats
 * @access  Admin
 */
export const getPaymentStats = asyncHandler(async (req, res) => {
  const { clinic, from, to } = req.query;

  // Date range (default: current month)
  const istRange = parseIstDateRange(from, to);
  const startDate = istRange.$gte || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const endDate = istRange.$lte || new Date();

  // When a custom date range is supplied, fall back to createdAt for legacy
  // payments that were recorded with paidAt: null (old-style single-invoice
  // link, before paidAt was reliably populated). Without this, those 8
  // payments are invisible to every date-filtered query even though they
  // are genuine paid records. The no-dates default (current month) keeps
  // filtering on paidAt so existing dashboard behaviour is unchanged.
  const paidAtFilter =
    from || to
      ? {
          $or: [
            { paidAt: { $gte: startDate, $lte: endDate } },
            { paidAt: null, createdAt: { $gte: startDate, $lte: endDate } },
          ],
        }
      : { paidAt: { $gte: startDate, $lte: endDate } };

  // Build match query
  const matchQuery = {
    status: "paid",
    ...paidAtFilter,
  };

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    matchQuery.clinic = new mongoose.Types.ObjectId(clinic);
  }

  // Exclude payments tied to a voided invoice -- same reasoning as
  // getPaymentSummaryStats above (voiding is a pure correction, never a
  // refund, and never touches the linked Payment document).
  const voidedInvoiceIds = await Invoice.find({ isVoided: true }).distinct("_id");
  if (voidedInvoiceIds.length > 0) {
    matchQuery.invoice = { $nin: voidedInvoiceIds };
    matchQuery["settledInvoices.invoiceId"] = { $nin: voidedInvoiceIds };
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

  const voidedInvoiceIds = await Invoice.find({ isVoided: true }).distinct("_id");
  const summary = await Payment.getPatientPaymentSummary(patientId, voidedInvoiceIds);

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

// ==================== ADMIN MANUAL PAYMENT + REVERSAL ====================

/**
 * @desc    Record a manual cash/UPI/card payment and auto-settle oldest invoices
 * @route   POST /api/payments/admin/record-payment
 * @access  Admin
 */
export const recordAdminPayment = asyncHandler(async (req, res) => {
  const { patientId, amount, mode, reference } = req.body;
  const adminId = req.user._id;

  // Validate inputs
  if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Valid patientId is required", 400);
  }
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return ApiResponse.error(res, "Amount must be greater than 0", 400);
  }
  const validModes = ["cash", "card", "upi"];
  const normalizedMode = (mode || "").toLowerCase();
  if (!validModes.includes(normalizedMode)) {
    return ApiResponse.error(res, "Mode must be cash, card, or upi", 400);
  }

  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Fetch pending invoices sorted oldest first
  const invoices = await Invoice.find({
    patient: patientId,
    paymentStatus: { $in: ["unpaid", "partial"] },
  }).sort({ createdAt: 1 });

  const totalPending = invoices.reduce(
    (sum, inv) => sum + (inv.balanceDue || 0),
    0
  );

  if (totalPending <= 0) {
    return ApiResponse.error(res, "No pending invoices for this patient", 400);
  }
  if (numAmount > totalPending + 0.01) {
    return ApiResponse.error(
      res,
      `Amount ₹${numAmount} exceeds total pending ₹${totalPending.toFixed(2)}`,
      400
    );
  }

  // Settle invoices oldest first
  let remaining = numAmount;
  const settledInvoices = [];

  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const balanceDue =
      invoice.balanceDue ??
      Math.max(0, invoice.grandTotal - (invoice.amountPaid || 0));
    const applyAmount = Math.min(remaining, balanceDue);
    if (applyAmount <= 0) continue;

    const previousAmountPaid = invoice.amountPaid || 0;
    invoice.amountPaid = previousAmountPaid + applyAmount;
    invoice.balanceDue = Math.max(0, invoice.grandTotal - invoice.amountPaid);

    if (invoice.amountPaid >= invoice.grandTotal) {
      invoice.paymentStatus = "paid";
      invoice.status = "paid";
    } else {
      invoice.paymentStatus = "partial";
      invoice.status = "partially_paid";
    }

    await invoice.save();

    settledInvoices.push({
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      appliedAmount: applyAmount,
      previousAmountPaid,
    });

    remaining -= applyAmount;
  }

  // Create payment record (no .invoice link so post-save hook doesn't double-settle)
  const payment = new Payment({
    patient: patientId,
    amount: numAmount,
    paymentMode: normalizedMode,
    type: "invoice_payment",
    status: "paid",
    paidAt: new Date(),
    referenceNumber: reference || undefined,
    recordedBy: adminId,
    settledInvoices,
    reversed: false,
  });
  await payment.save();

  fireWhatsApp(patient.phone, "payment_recorded", {
    amount: numAmount,
    description: settledInvoices.length === 1
      ? describeInvoice(settledInvoices[0])
      : `${settledInvoices.length} invoices`,
    invoiceNumber: settledInvoices[0]?.invoiceNumber,
  }, patient.name);

  return ApiResponse.success(
    res,
    { payment, settledInvoices },
    "Payment recorded successfully"
  );
});

/**
 * @desc    Reverse an admin-recorded payment and restore invoice balances
 * @route   POST /api/payments/admin/reverse-payment
 * @access  Admin
 */
export const reverseAdminPayment = asyncHandler(async (req, res) => {
  const { paymentId, reason } = req.body;
  const adminId = req.user._id;

  if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
    return ApiResponse.error(res, "Valid paymentId is required", 400);
  }
  if (!reason?.trim()) {
    return ApiResponse.error(res, "Reversal reason is required", 400);
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return ApiResponse.error(res, "Payment not found", 404);
  }
  if (payment.reversed) {
    return ApiResponse.error(res, "Payment already reversed", 400);
  }
  if (!payment.settledInvoices?.length) {
    return ApiResponse.error(
      res,
      "This payment has no settlement history — only admin-recorded payments can be reversed here",
      400
    );
  }

  // Restore each invoice to its exact pre-payment state
  for (const settled of payment.settledInvoices) {
    const invoice = await Invoice.findById(settled.invoiceId);
    if (!invoice) continue;

    invoice.amountPaid = settled.previousAmountPaid || 0;
    invoice.balanceDue = Math.max(0, invoice.grandTotal - invoice.amountPaid);

    if (invoice.amountPaid <= 0) {
      invoice.paymentStatus = "unpaid";
      if (["paid", "partially_paid"].includes(invoice.status)) {
        invoice.status = "sent";
      }
    } else if (invoice.amountPaid < invoice.grandTotal) {
      invoice.paymentStatus = "partial";
      invoice.status = "partially_paid";
    }

    await invoice.save();
  }

  payment.reversed = true;
  payment.reversalReason = reason.trim();
  payment.reversedAt = new Date();
  payment.reversedBy = adminId;
  payment.status = "reversed";
  await payment.save();

  return ApiResponse.success(res, { success: true }, "Payment reversed successfully");
});

/**
 * @desc    Collect payment for a specific invoice (admin — per-invoice, not oldest-first)
 * @route   POST /api/payments/admin/collect
 * @access  Admin
 */
export const collectPayment = asyncHandler(async (req, res) => {
  const { invoiceId, amount, mode, reference, notes, appointmentId } = req.body;
  const adminId = req.user._id;

  if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
    return ApiResponse.error(res, "Valid invoiceId is required", 400);
  }

  // Optional link to the SPECIFIC appointment (e.g. a treatment_session) this
  // payment was actually collected for -- lets the Treatments tab's session
  // timeline show the amount collected AT that session, not the invoice's
  // shared cumulative total. Purely additive; when omitted, behaves exactly
  // as before (a general invoice-level payment with no per-appointment tie).
  let resolvedAppointmentId = null;
  if (appointmentId) {
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return ApiResponse.error(res, "Invalid appointmentId", 400);
    }
    resolvedAppointmentId = appointmentId;
  }

  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return ApiResponse.error(res, "Amount must be greater than 0", 400);
  }

  const validModes = ["cash", "card", "upi", "razorpay"];
  const normalizedMode = (mode || "").toLowerCase();
  if (!validModes.includes(normalizedMode)) {
    return ApiResponse.error(res, "Mode must be cash, card, upi, or razorpay", 400);
  }

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  if (invoice.status === "cancelled") {
    return ApiResponse.error(res, "Cannot collect payment on a cancelled invoice", 400);
  }

  if (invoice.paymentStatus === "paid") {
    return ApiResponse.error(res, "Invoice is already fully paid", 400);
  }

  const balanceDue = Math.max(0, (invoice.grandTotal || 0) - (invoice.amountPaid || 0));

  if (numAmount > balanceDue + 0.01) {
    return ApiResponse.error(
      res,
      `Amount ₹${numAmount} exceeds balance due ₹${balanceDue.toFixed(2)}`,
      400
    );
  }

  // ── Razorpay: generate a shareable Payment Link for EXACTLY this amount
  // (never the full invoice grandTotal -- this may be a partial/post-hoc
  // collection against an invoice that already has amountPaid > 0). Nothing
  // is marked paid here: the actual collection happens later when the
  // patient pays the link, processed by the payment_link.paid webhook --
  // mirrors the booking-time razorpay flow in appointment.controller.js.
  if (normalizedMode === "razorpay") {
    const patientDoc = await Patient.findById(invoice.patient).select("name phone");
    if (!patientDoc) {
      return ApiResponse.error(res, "Patient not found for this invoice", 404);
    }

    try {
      const { shortUrl, paymentLinkId } = await generateRazorpayPaymentLink(invoice, patientDoc, {
        amount: numAmount,
        referenceAppointmentId: resolvedAppointmentId || undefined,
      });
      invoice.paymentLink = {
        id: paymentLinkId,
        shortUrl,
        status: "created",
        createdAt: new Date(),
        paidAt: null,
      };
      await invoice.save();

      // Awaited (same reasoning as createAppointment's razorpay branch) --
      // the admin UI needs the REAL send outcome, not an assumed one.
      const waResult = await sendWhatsApp(
        patientDoc.phone,
        "payment_link",
        { amount: numAmount, description: notes || `Invoice ${invoice.invoiceNumber}`, shortUrl },
        patientDoc.name
      );

      return ApiResponse.success(
        res,
        {
          paymentLink: { shortUrl, paymentLinkId, whatsappSent: !!waResult?.success },
          updatedInvoice: invoice,
        },
        "Payment link generated successfully"
      );
    } catch (linkErr) {
      console.error("[collectPayment] Razorpay payment link generation failed:", linkErr.message);
      return ApiResponse.success(
        res,
        {
          paymentLink: { error: linkErr.message },
          updatedInvoice: invoice,
        },
        "Payment link generation failed"
      );
    }
  }

  const previousAmountPaid = invoice.amountPaid || 0;
  invoice.amountPaid = previousAmountPaid + numAmount;
  invoice.balanceDue = Math.max(0, invoice.grandTotal - invoice.amountPaid);

  if (invoice.amountPaid >= invoice.grandTotal) {
    invoice.paymentStatus = "paid";
    invoice.status = "paid";
  } else {
    invoice.paymentStatus = "partial";
    invoice.status = "partially_paid";
  }

  await invoice.save();

  const payment = new Payment({
    patient: invoice.patient,
    amount: numAmount,
    paymentMode: normalizedMode,
    type: "invoice_payment",
    status: "paid",
    paidAt: new Date(),
    referenceNumber: reference || undefined,
    notes: notes || undefined,
    recordedBy: adminId,
    ...(resolvedAppointmentId ? { appointment: resolvedAppointmentId } : {}),
    settledInvoices: [
      {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        appliedAmount: numAmount,
        previousAmountPaid,
      },
    ],
    reversed: false,
  });

  await payment.save();

  // invoice.patient is only an ObjectId here -- resolve the phone in a
  // self-contained fire-and-forget lookup, never awaited by the caller.
  (async () => {
    try {
      const payer = await Patient.findById(invoice.patient).select("phone name");
      fireWhatsApp(payer?.phone, "payment_recorded", {
        amount: numAmount,
        description: pickPaymentDescription(notes, describeInvoice(invoice)),
        invoiceNumber: invoice.invoiceNumber,
      }, payer?.name);
    } catch (err) {
      console.error("[WhatsApp] payment_recorded lookup failed:", err.message);
    }
  })();

  return ApiResponse.success(
    res,
    { payment, updatedInvoice: invoice },
    "Payment collected successfully"
  );
});

// ==================== PATIENT PENDING PAYMENT (RAZORPAY) ====================

/**
 * @desc    Create a Razorpay order for patient's pending invoice balance.
 *          When invoiceId is provided the order is scoped to that invoice only;
 *          otherwise the amount is validated against the patient's total outstanding
 *          balance and settled FIFO in verifyPendingPayment (existing behaviour).
 * @route   POST /api/payments/patient/create-pending-order
 * @access  Patient
 */
export const createPendingOrder = asyncHandler(async (req, res) => {
  const patientId = req.patient._id;
  const amount = Number(req.body.amount);
  const { invoiceId } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return ApiResponse.error(res, "Amount must be greater than 0", 400);
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return ApiResponse.error(res, "Razorpay is not configured", 500);
  }

  let totalPending;

  if (invoiceId) {
    // Per-invoice flow: scope the order to a single invoice
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return ApiResponse.error(res, "Invalid invoice ID", 400);
    }
    const invoice = await Invoice.findById(invoiceId);
    // Identical 404 for missing or wrong-patient (IDOR protection)
    if (!invoice || invoice.patient.toString() !== patientId.toString()) {
      return ApiResponse.error(res, "Invoice not found", 404);
    }
    if (invoice.paymentStatus === "paid") {
      return ApiResponse.error(res, "This invoice is already fully paid", 400);
    }
    if (!invoice.balanceDue || invoice.balanceDue <= 0) {
      return ApiResponse.error(res, "No outstanding balance on this invoice", 400);
    }
    totalPending = invoice.balanceDue;
  } else {
    // Total-balance flow: sum across all pending invoices (existing behaviour)
    const pendingInvoices = await Invoice.find({
      patient: patientId,
      paymentStatus: { $in: ["unpaid", "partial"] },
    });
    totalPending = pendingInvoices.reduce(
      (sum, inv) => sum + (inv.balanceDue || 0),
      0
    );
    if (totalPending <= 0) {
      return ApiResponse.error(res, "No pending amount to pay", 400);
    }
  }

  if (amount > totalPending + 0.01) {
    return ApiResponse.error(
      res,
      `Amount cannot exceed total pending ₹${totalPending.toFixed(2)}`,
      400
    );
  }

  const Razorpay = (await import("razorpay")).default;
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  // Embed invoiceId in order notes so verifyPendingPayment can recover the scope
  const notes = { patientId: patientId.toString(), type: "pending_payment" };
  if (invoiceId) notes.invoiceId = invoiceId.toString();

  let order;
  try {
    order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `pending_${patientId.toString().slice(-8)}_${Date.now()}`,
      notes,
    });
  } catch (err) {
    console.error("[PendingOrder] Razorpay order creation failed:", err.message);
    return ApiResponse.error(res, "Failed to create payment order", 502);
  }

  return ApiResponse.success(
    res,
    { orderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID },
    "Order created successfully"
  );
});

/**
 * @desc    Verify Razorpay payment and settle against invoices.
 *          When the order notes contain an invoiceId (set by createPendingOrder) the
 *          payment is applied to that specific invoice only.  Otherwise the
 *          Razorpay-verified amount is distributed FIFO across all pending invoices
 *          (existing behaviour — unchanged).
 * @route   POST /api/payments/patient/verify-pending-payment
 * @access  Patient
 */
export const verifyPendingPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const patientId = req.patient._id;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return ApiResponse.error(res, "Missing Razorpay payment details", 400);
  }

  if (!process.env.RAZORPAY_KEY_SECRET) {
    return ApiResponse.error(res, "Payment verification not configured on server", 500);
  }

  // Verify Razorpay signature
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return ApiResponse.error(res, "Invalid payment signature", 400);
  }

  // Resolve the authoritative captured amount from Razorpay — do NOT trust
  // req.body.amount for settlement. The signature only covers order_id|payment_id,
  // not the amount, so a patient could supply a different figure and over- or
  // under-settle their invoices. Fetch the order and use order.amount_paid (paise).
  // Also recover the optional invoiceId embedded in order.notes by createPendingOrder.
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return ApiResponse.error(res, "Razorpay is not configured", 500);
  }
  const Razorpay = (await import("razorpay")).default;
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  let verifiedAmount;
  let scopedInvoiceId;
  try {
    const order = await razorpay.orders.fetch(razorpay_order_id);
    verifiedAmount = Number(order.amount_paid) / 100;
    scopedInvoiceId = order.notes?.invoiceId || null;
  } catch (err) {
    console.error("[VerifyPendingPayment] Could not fetch Razorpay order:", err.message);
    return ApiResponse.error(res, "Could not verify payment amount", 502);
  }
  if (!verifiedAmount || verifiedAmount <= 0) {
    return ApiResponse.error(res, "Payment has not been captured yet", 400);
  }

  if (scopedInvoiceId) {
    // ── Per-invoice settlement ──────────────────────────────────────────────
    if (!mongoose.Types.ObjectId.isValid(scopedInvoiceId)) {
      return ApiResponse.error(res, "Invalid invoice reference in payment order", 400);
    }
    const invoice = await Invoice.findOne({
      _id: scopedInvoiceId,
      patient: patientId,  // IDOR check
    });
    if (!invoice) {
      return ApiResponse.error(res, "Invoice not found", 404);
    }
    const previousAmountPaid = invoice.amountPaid || 0;
    invoice.amountPaid = previousAmountPaid + verifiedAmount;
    // pre-save hook calls calculateTotals() which updates balanceDue / paymentStatus / status
    await invoice.save();

    const payment = new Payment({
      patient: patientId,
      amount: verifiedAmount,
      paymentMode: "razorpay",
      type: "invoice_payment",
      status: "paid",
      paidAt: new Date(),
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      settledInvoices: [
        {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          appliedAmount: verifiedAmount,
          previousAmountPaid,
        },
      ],
      notes: `Invoice payment via Razorpay — ${invoice.invoiceNumber}`,
    });
    await payment.save();

    fireWhatsApp(req.patient?.phone, "payment_recorded", {
      amount: verifiedAmount,
      description: describeInvoice(invoice),
      invoiceNumber: invoice.invoiceNumber,
    }, req.patient?.name);
  } else {
    // ── Total-balance FIFO settlement (existing behaviour — unchanged) ───────
    const invoices = await Invoice.find({
      patient: patientId,
      paymentStatus: { $in: ["unpaid", "partial"] },
    }).sort({ invoiceDate: 1, createdAt: 1 });

    let remaining = verifiedAmount;
    const settledInvoicesArr = [];
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const balanceDue = invoice.balanceDue || Math.max(0, invoice.grandTotal - (invoice.amountPaid || 0));
      const applyAmount = Math.min(remaining, balanceDue);
      if (applyAmount <= 0) continue;

      const previousAmountPaid = invoice.amountPaid || 0;
      invoice.amountPaid = previousAmountPaid + applyAmount;
      invoice.balanceDue = Math.max(0, invoice.grandTotal - invoice.amountPaid);

      if (invoice.amountPaid >= invoice.grandTotal) {
        invoice.paymentStatus = "paid";
        invoice.status = "paid";
      } else {
        invoice.paymentStatus = "partial";
        invoice.status = "partially_paid";
      }

      await invoice.save();
      settledInvoicesArr.push({
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        appliedAmount: applyAmount,
        previousAmountPaid,
      });
      remaining -= applyAmount;
    }

    const payment = new Payment({
      patient: patientId,
      amount: verifiedAmount,
      paymentMode: "razorpay",
      type: "invoice_payment",
      status: "paid",
      paidAt: new Date(),
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      settledInvoices: settledInvoicesArr,
      notes: "Pending amount payment via Razorpay",
    });
    await payment.save();

    fireWhatsApp(req.patient?.phone, "payment_recorded", {
      amount: verifiedAmount,
      description: "Pending balance payment",
      invoiceNumber: undefined,
    }, req.patient?.name);
  }

  return ApiResponse.success(res, { success: true }, "Payment successful");
});
