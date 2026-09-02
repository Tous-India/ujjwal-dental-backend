import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import ExternalIncome from "./externalIncome.model.js";
import User from "../users/user.model.js";
import mongoose from "mongoose";
import { parseIstDateRange } from "../../utils/istDateRange.js";
import PDFDocument from "pdfkit";
import { CLINIC_NAME } from "../../constants/clinic.js";

/**
 * @desc    List external income records
 * @route   GET /api/external-income
 * @access  checkPermission("external_income","view")
 *
 * Filters: from, to, includeVoided
 * Default: excludes voided records. Pass includeVoided=true to include them.
 */
export const getExternalIncomes = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    from,
    to,
    includeVoided,
  } = req.query;

  const query = {};

  if (includeVoided === "true") {
    // No isVoided filter — return all
  } else {
    query.isVoided = { $ne: true };
  }

  if (from || to) {
    query.date = parseIstDateRange(from, to);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [records, total] = await Promise.all([
    ExternalIncome.find(query)
      .populate("doctor", "name email role")
      .populate("recordedBy", "name email role")
      .populate("voidedBy", "name email role")
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    ExternalIncome.countDocuments(query),
  ]);

  ApiResponse.paginated(
    res,
    records,
    { page: parseInt(page), limit: parseInt(limit), total },
    "External income records fetched successfully"
  );
});

/**
 * @desc    Create an external income record
 * @route   POST /api/external-income
 * @access  checkPermission("external_income","create")
 *
 * recordedBy is always set server-side from req.user._id — any client-sent
 * value is silently ignored (stripped before save).
 */
export const createExternalIncome = asyncHandler(async (req, res) => {
  // Strip recordedBy from body — always server-set
  const { recordedBy: _stripped, isVoided: _v, voidedAt: _va, voidedBy: _vb, voidReason: _vr, ...body } = req.body;

  const { date, amount, doctor, doctorName, clinicName, treatment, notes } = body;

  if (!date) return ApiResponse.error(res, "date is required", 400);
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
    return ApiResponse.error(res, "amount must be a number greater than 0", 400);
  if (!clinicName || !clinicName.trim())
    return ApiResponse.error(res, "clinicName is required", 400);
  if (!treatment || !treatment.trim())
    return ApiResponse.error(res, "treatment is required", 400);

  const hasDoctor = doctor && mongoose.Types.ObjectId.isValid(doctor);
  const hasDoctorName = doctorName && doctorName.trim().length > 0;
  if (!hasDoctor && !hasDoctorName) {
    return ApiResponse.error(
      res,
      "Either doctor (staff ObjectId) or doctorName (free text) must be provided",
      400
    );
  }
  if (doctor && !mongoose.Types.ObjectId.isValid(doctor)) {
    return ApiResponse.error(res, "Invalid doctor user ID", 400);
  }

  const record = await ExternalIncome.create({
    date: new Date(date),
    amount: Number(amount),
    doctor: hasDoctor ? doctor : null,
    doctorName: hasDoctorName ? doctorName.trim() : "",
    clinicName: clinicName.trim(),
    treatment: treatment.trim(),
    notes: notes ? notes.trim() : "",
    recordedBy: req.user._id, // always server-set
  });

  const populated = await ExternalIncome.findById(record._id)
    .populate("doctor", "name email role")
    .populate("recordedBy", "name email role")
    .lean();

  ApiResponse.created(res, { record: populated }, "External income recorded successfully");
});

/**
 * @desc    Update an external income record
 * @route   PUT /api/external-income/:id
 * @access  checkPermission("external_income","edit")
 *
 * Cannot update a voided record. Cannot change recordedBy.
 */
export const updateExternalIncome = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return ApiResponse.error(res, "Invalid external income ID", 400);

  const record = await ExternalIncome.findById(id);
  if (!record) return ApiResponse.error(res, "External income record not found", 404);
  if (record.isVoided)
    return ApiResponse.error(res, "Cannot update a voided record", 400);

  // Strip fields that must never be editable
  const {
    recordedBy: _r,
    isVoided: _v,
    voidedAt: _va,
    voidedBy: _vb,
    voidReason: _vr,
    ...updates
  } = req.body;

  if (updates.doctor && !mongoose.Types.ObjectId.isValid(updates.doctor)) {
    return ApiResponse.error(res, "Invalid doctor user ID", 400);
  }
  if (updates.date) updates.date = new Date(updates.date);
  if (updates.amount !== undefined) {
    if (isNaN(Number(updates.amount)) || Number(updates.amount) <= 0)
      return ApiResponse.error(res, "amount must be a number greater than 0", 400);
    updates.amount = Number(updates.amount);
  }

  Object.assign(record, updates);
  await record.save();

  const populated = await ExternalIncome.findById(id)
    .populate("doctor", "name email role")
    .populate("recordedBy", "name email role")
    .lean();

  ApiResponse.success(res, { record: populated }, "External income updated successfully");
});

/**
 * @desc    Void (soft-delete) an external income record
 * @route   POST /api/external-income/:id/void
 * @access  checkPermission("external_income","delete")
 *
 * Mirrors the expense void pattern. Requires a voidReason of at least 10 chars.
 */
export const voidExternalIncome = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return ApiResponse.error(res, "Invalid external income ID", 400);

  const { voidReason } = req.body;
  if (!voidReason || voidReason.trim().length < 10)
    return ApiResponse.error(res, "A void reason of at least 10 characters is required", 400);

  const record = await ExternalIncome.findById(id);
  if (!record) return ApiResponse.error(res, "External income record not found", 404);
  if (record.isVoided) return ApiResponse.error(res, "Record is already voided", 400);

  await ExternalIncome.updateOne(
    { _id: id },
    {
      $set: {
        isVoided: true,
        voidedAt: new Date(),
        voidedBy: req.user._id,
        voidReason: voidReason.trim(),
      },
    }
  );

  const updated = await ExternalIncome.findById(id)
    .populate("doctor", "name email role")
    .populate("recordedBy", "name email role")
    .populate("voidedBy", "name email role")
    .lean();

  ApiResponse.success(res, { record: updated }, "External income record voided successfully");
});

/**
 * @desc    Export external income as CSV or PDF
 * @route   GET /api/external-income/export?format=csv|pdf&from=&to=
 * @access  checkPermission("external_income","view")
 */
export const exportExternalIncome = asyncHandler(async (req, res) => {
  const { from, to, format = "pdf" } = req.query;

  const query = { isVoided: { $ne: true } };
  if (from || to) query.date = parseIstDateRange(from, to);

  const records = await ExternalIncome.find(query)
    .populate("doctor", "name")
    .populate("recordedBy", "name")
    .sort({ date: -1 })
    .limit(5000)
    .lean();

  const { fileURLToPath } = await import("url");
  const { dirname, resolve } = await import("path");
  const { existsSync } = await import("fs");
  const __dir = dirname(fileURLToPath(import.meta.url));
  const logoPath = resolve(__dir, "../../../../frontend/public/ujjwal-dental-logo.png");
  const hasLogo = existsSync(logoPath);

  const MTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtDate = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,"0")} ${MTH[dt.getMonth()]} ${dt.getFullYear()}`;
  };
  const today = fmtDate(new Date());
  const totalAmount = records.reduce((s, r) => s + (r.amount || 0), 0);

  // ── CSV ──────────────────────────────────────────────────────────────────────
  if (format === "csv") {
    const esc = (v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvRow = (...cells) => cells.map(esc).join(",");

    const lines = [
      csvRow(CLINIC_NAME, "", "Payment History — Another Source"),
      csvRow("Exported:", today, from ? `From: ${fmtDate(from)}` : "", to ? `To: ${fmtDate(to)}` : ""),
      csvRow(`Records: ${records.length}`, `Total: Rs. ${totalAmount.toLocaleString("en-IN")}`),
      "",
      csvRow("Date", "Source (Clinic)", "Treatment / Service", "Doctor / Staff", "Amount (Rs.)", "Notes", "Recorded By"),
    ];

    for (const r of records) {
      lines.push(csvRow(
        fmtDate(r.date),
        r.clinicName || "-",
        r.treatment || "-",
        r.doctor?.name || r.doctorName || "-",
        (r.amount || 0).toLocaleString("en-IN"),
        r.notes || "-",
        r.recordedBy?.name || "-",
      ));
    }

    // Bottom totals — same figures as header rows, visible after scrolling data
    lines.push("");
    lines.push(csvRow("Total Amount:", `Rs. ${totalAmount.toLocaleString("en-IN")}`));
    lines.push(csvRow("Records:", String(records.length)));

    const csv = lines.join("\r\n");
    const filename = `payment-history-another-source-${today.replace(/ /g, "-")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("﻿" + csv);
  }

  // ── PDF (A4 landscape) ───────────────────────────────────────────────────────
  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const MARGIN  = 40;
  const USABLE  = PAGE_W - MARGIN * 2;

  const cols = [
    { header: "DATE",             key: "date",       align: "left",  w: 80  },
    { header: "SOURCE (CLINIC)",  key: "clinic",     align: "left",  w: 155 },
    { header: "TREATMENT",        key: "treatment",  align: "left",  w: 140 },
    { header: "DOCTOR / STAFF",   key: "doctor",     align: "left",  w: 130 },
    { header: "AMT (Rs.)",        key: "amount",     align: "right", w: 75  },
    { header: "NOTES",            key: "notes",      align: "left",  w: 181 },
  ];

  let xAcc = MARGIN;
  for (const col of cols) { col.x = xAcc; xAcc += col.w; }

  const ROW_H  = 24;
  const HDR_H  = 26;
  const PAD    = 6;
  const BOTTOM = PAGE_H - 55;
  const NAVY   = "#0D1B4A";

  const cellX = (col) => col.align === "right" ? col.x : col.x + PAD;
  const cellW = (col) => col.w - PAD;

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: MARGIN, autoFirstPage: true });
  const filename = `payment-history-another-source-${today.replace(/ /g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.on("error", (err) => {
    console.error("[exportExternalIncome] PDFDocument stream error:", err);
    if (!res.writableEnded) res.end();
  });
  doc.pipe(res);

  const drawHeaders = (y) => {
    doc.rect(MARGIN, y, USABLE, HDR_H).fill("#E8EAF6");
    doc.fillColor("#3730A3").fontSize(8).font("Helvetica-Bold");
    for (const col of cols) {
      doc.text(col.header, cellX(col), y + 9, { width: cellW(col), align: col.align, lineBreak: false, ellipsis: true });
    }
    return y + HDR_H;
  };

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
  doc.text("Payment History — Another Source", MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
  y += 20;

  const filterParts = [];
  if (from || to) filterParts.push(`Date: ${fmtDate(from)} to ${fmtDate(to)}`);
  filterParts.push(`Exported: ${today}`);
  doc.fillColor("#6b7280").fontSize(9).font("Helvetica");
  doc.text(filterParts.join("   |   "), MARGIN, y, { align: "center", width: USABLE, lineBreak: false });
  y += 14;

  doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
  doc.text(
    `Total Records: ${records.length}   |   Total Amount: Rs. ${totalAmount.toLocaleString("en-IN")}`,
    MARGIN, y, { align: "center", width: USABLE, lineBreak: false }
  );
  y += 18;

  y = drawHeaders(y);

  for (let i = 0; i < records.length; i++) {
    if (y + ROW_H > BOTTOM) { doc.addPage(); y = MARGIN; y = drawHeaders(y); }
    const r = records[i];
    const rowY = y;
    doc.rect(MARGIN, rowY, USABLE, ROW_H).fill(i % 2 === 0 ? "#FFFFFF" : "#F8F8FF");

    const vals = {
      date:      fmtDate(r.date),
      clinic:    r.clinicName || "-",
      treatment: r.treatment || "-",
      doctor:    r.doctor?.name || r.doctorName || "-",
      amount:    (r.amount || 0).toLocaleString("en-IN"),
      notes:     r.notes || "-",
    };

    doc.fillColor("#1a1a2e").fontSize(9).font("Helvetica");
    for (const col of cols) {
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

  // ── Bottom totals ──────────────────────────────────────────────────────────
  if (y + 50 > BOTTOM) { doc.addPage(); y = MARGIN; }
  y += 12;
  doc.strokeColor("#D1D5DB").lineWidth(0.8).moveTo(MARGIN, y).lineTo(MARGIN + USABLE, y).stroke();
  y += 8;

  const sumValX = MARGIN + USABLE - 90;
  const sumLblX = MARGIN + USABLE - 250;
  doc.fillColor(NAVY).fontSize(11).font("Helvetica-Bold");
  doc.text("Total Amount:", sumLblX, y, { width: 150, align: "right", lineBreak: false });
  doc.text(`Rs. ${totalAmount.toLocaleString("en-IN")}`, sumValX, y, { width: 90, align: "right", lineBreak: false });
  y += 14;
  doc.fillColor("#6b7280").fontSize(8).font("Helvetica");
  doc.text(`${records.length} record${records.length !== 1 ? "s" : ""}`, sumLblX, y, { width: 150, align: "right", lineBreak: false });

  doc.fillColor("#9ca3af").fontSize(8).font("Helvetica");
  doc.text(
    `Generated by ${CLINIC_NAME} admin panel — ${today}`,
    MARGIN, PAGE_H - MARGIN - 10, { align: "center", width: USABLE, lineBreak: false }
  );
  doc.end();
});

/**
 * @desc    Summary stats for external income (sum of non-voided records in date range)
 * @route   GET /api/external-income/stats
 * @access  checkPermission("external_income","view")
 */
export const getExternalIncomeStats = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const match = { isVoided: false };
  if (from || to) match.date = parseIstDateRange(from, to);

  const [agg] = await ExternalIncome.aggregate([
    { $match: match },
    { $group: { _id: null, totalAmount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  ApiResponse.success(res, {
    totalAmount: agg?.totalAmount || 0,
    count: agg?.count || 0,
  }, "External income stats fetched successfully");
});

/**
 * @desc    Staff list for the doctor dropdown
 * @route   GET /api/external-income/staff
 * @access  checkPermission("external_income","view")
 */
export const getStaffList = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true })
    .select("name email role")
    .sort({ name: 1 })
    .lean();

  ApiResponse.success(res, { users });
});
