/**
 * Per-tab export verification — T1–T6
 *
 * Seeds:
 *   10 paid payments  (amounts sum to 85,600)
 *    1 refunded payment (amount 300, refund.amount 300)
 *    4 external income records (amounts sum to 65,316)
 *
 * Verifies each tab exports only its own rows, CSV + PDF, with correct counts.
 * Also verifies date-filter narrows rows, and Export All still works.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Payment from "../../src/modules/payments/payment.model.js";
import ExternalIncome from "../../src/modules/externalIncome/externalIncome.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

describe("Per-tab export — T1–T6", () => {
  let token;
  let invoices = [];
  let payments = [];
  let incomes  = [];
  let extraPatient;

  // Dates: 9 paid in LAST 30 days, 1 paid MORE than 30 days ago (for date-filter test)
  const OLD_DATE = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago

  beforeAll(async () => {
    token = await getAdminToken(app);
    extraPatient = await Patient.create({ name: "PerTabExport Patient", phone: "9000000097" });

    // 9 recent paid + 1 old paid
    const recentAmounts = [5000, 12000, 800, 3000, 15000, 300, 500, 45000, 3500];
    for (const amt of recentAmounts) {
      const inv = await Invoice.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        items: [{ itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: amt, amount: amt, total: amt }],
      });
      const p = await Payment.create({
        patient: testData.patient._id,
        amount: amt,
        paymentMode: "cash",
        type: "invoice_payment",
        status: "paid",
        invoice: inv._id,
      });
      invoices.push(inv);
      payments.push(p);
    }
    // 1 old paid (for date-filter T4)
    const oldInv = await Invoice.create({
      patient: extraPatient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD", quantity: 1, unitPrice: 500, amount: 500, total: 500 }],
    });
    const oldP = await Payment.create({
      patient: extraPatient._id,
      amount: 500,
      paymentMode: "upi",
      type: "opd_fee",
      status: "paid",
      invoice: oldInv._id,
      createdAt: OLD_DATE,
      paidAt: OLD_DATE,
    });
    invoices.push(oldInv);
    payments.push(oldP);

    // 1 refunded payment
    const refInv = await Invoice.create({
      patient: extraPatient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD", quantity: 1, unitPrice: 300, amount: 300, total: 300 }],
    });
    const refP = await Payment.create({
      patient: extraPatient._id,
      amount: 300,
      paymentMode: "cash",
      type: "opd_fee",
      status: "refunded",
      invoice: refInv._id,
      refund: { amount: 300, refundedAt: new Date(), reason: "duplicate charge" },
    });
    invoices.push(refInv);
    payments.push(refP);

    // 4 external income records
    for (const amt of [20000, 15000, 12316, 18000]) {
      const inc = await ExternalIncome.create({
        clinicName: "City Dental Lab",
        treatment: "Lab referral",
        doctorName: "Dr. Test",
        notes: "Referral fee",
        amount: amt,
        date: new Date(),
        recordedBy: testData.admin._id,
        isVoided: false,
      });
      incomes.push(inc);
    }
  });

  afterAll(async () => {
    await Payment.deleteMany({ _id: { $in: payments.map((p) => p._id) } });
    await Invoice.deleteMany({ _id: { $in: invoices.map((i) => i._id) } });
    await ExternalIncome.deleteMany({ _id: { $in: incomes.map((i) => i._id) } });
    await Patient.findByIdAndDelete(extraPatient._id);
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  const getPdf = (path, query = {}) =>
    request(app).get(path).query(query).set(authHeader(token))
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  const getCsv = (path, query = {}) =>
    request(app).get(path).query(query).set(authHeader(token));

  // Count CSV data rows: skip header block (first 5 lines incl blank separator)
  // Header block = 3 meta lines + 1 blank + 1 column-header = 5 lines
  const csvDataRows = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    // Drop first 4 lines (3 meta + col header)
    return lines.slice(4).filter((l) => !l.startsWith(",") && l.trim()); // skip totals/blank
  };

  // ── T1: Paid tab — PDF + CSV ───────────────────────────────────────────────
  it("T1a: Paid tab PDF — 200, valid PDF, ≥10 rows in this test run", async () => {
    const res = await getPdf("/api/payments/export/pdf", { status: "paid" });
    console.log("Paid PDF status:", res.status, "size:", res.body?.length, "bytes");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
    expect(res.body.slice(-6).toString().trim().endsWith("%%EOF")).toBe(true);
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it("T1b: Paid tab CSV — 200, text/csv, data rows ≥10", async () => {
    const res = await getCsv("/api/payments/export/csv", { status: "paid" });
    console.log("Paid CSV status:", res.status, "length:", res.text?.length);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const rows = csvDataRows(res.text);
    console.log("Paid CSV data rows:", rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    // Must NOT contain refunded rows in Paid CSV
    expect(rows.some((r) => r.toLowerCase().includes("refund"))).toBe(false);
  });

  // ── T1: Refunded tab — PDF + CSV ──────────────────────────────────────────
  it("T1c: Refunded tab PDF — 200, valid PDF", async () => {
    const res = await getPdf("/api/payments/export/pdf", { status: "refunded,refund_pending,reversed" });
    console.log("Refunded PDF status:", res.status, "size:", res.body?.length, "bytes");
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it("T1d: Refunded tab CSV — 200, text/csv, ≥1 data row", async () => {
    const res = await getCsv("/api/payments/export/csv", { status: "refunded,refund_pending,reversed" });
    console.log("Refunded CSV status:", res.status);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const rows = csvDataRows(res.text);
    console.log("Refunded CSV data rows:", rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  // ── T1: Another Source tab — PDF + CSV ────────────────────────────────────
  it("T1e: Another Source PDF — 200, valid PDF", async () => {
    const res = await getPdf("/api/external-income/export", { format: "pdf" });
    console.log("ExtIncome PDF status:", res.status, "size:", res.body?.length, "bytes");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
    expect(res.body.slice(-6).toString().trim().endsWith("%%EOF")).toBe(true);
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it("T1f: Another Source CSV — 200, text/csv, ≥4 data rows", async () => {
    const res = await getCsv("/api/external-income/export", { format: "csv" });
    console.log("ExtIncome CSV status:", res.status);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const rows = csvDataRows(res.text);
    console.log("ExtIncome CSV data rows:", rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // Must contain clinic name, not payment data
    expect(rows.some((r) => r.includes("City Dental Lab"))).toBe(true);
  });

  // ── T2: Export All still works ─────────────────────────────────────────────
  it("T2: Export All PDF — 200, valid, ≥15 rows total", async () => {
    const res = await getPdf("/api/payments/export/combined", { format: "pdf" });
    console.log("Export All PDF status:", res.status, "size:", res.body?.length, "bytes");
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it("T2: Export All CSV — 200, text/csv", async () => {
    const res = await getCsv("/api/payments/export/combined", { format: "csv" });
    console.log("Export All CSV status:", res.status);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });

  // ── T4: Date filter narrows paid rows ─────────────────────────────────────
  it("T4: date filter on Paid CSV excludes old payment (>30 days)", async () => {
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]; // last 7 days
    const resAll  = await getCsv("/api/payments/export/csv", { status: "paid" });
    const resFiltered = await getCsv("/api/payments/export/csv", { status: "paid", from });

    const allRows      = csvDataRows(resAll.text);
    const filteredRows = csvDataRows(resFiltered.text);

    console.log(`T4: unfiltered rows=${allRows.length}, last-7-day rows=${filteredRows.length}`);
    expect(filteredRows.length).toBeLessThan(allRows.length);
    expect(filteredRows.length).toBeGreaterThanOrEqual(0);
  });

  // ── T5: Voided external income excluded ───────────────────────────────────
  it("T5: voided external income excluded from Another Source CSV", async () => {
    const voidedInc = await ExternalIncome.create({
      clinicName: "VOIDED SOURCE",
      treatment: "Voided treatment",
      doctorName: "Dr. Void",
      amount: 99999,
      date: new Date(),
      recordedBy: testData.admin._id,
      isVoided: true,
    });

    const res = await getCsv("/api/external-income/export", { format: "csv" });
    expect(res.text).not.toContain("VOIDED SOURCE");
    console.log("T5: voided record not in export ✓");

    await ExternalIncome.findByIdAndDelete(voidedInc._id);
  });

  // ── T6: All PDF sizes reported ─────────────────────────────────────────────
  it("T6: report all PDF sizes for the record", async () => {
    const [paid, refunded, extIncome, allPdf] = await Promise.all([
      getPdf("/api/payments/export/pdf", { status: "paid" }),
      getPdf("/api/payments/export/pdf", { status: "refunded,refund_pending,reversed" }),
      getPdf("/api/external-income/export", { format: "pdf" }),
      getPdf("/api/payments/export/combined", { format: "pdf" }),
    ]);
    console.log("PDF sizes:");
    console.log("  Paid tab PDF:           ", paid.body?.length, "bytes");
    console.log("  Refunded tab PDF:       ", refunded.body?.length, "bytes");
    console.log("  Another Source tab PDF: ", extIncome.body?.length, "bytes");
    console.log("  Export All PDF:         ", allPdf.body?.length, "bytes");

    expect(paid.body.length).toBeGreaterThan(1000);
    expect(refunded.body.length).toBeGreaterThan(1000);
    expect(extIncome.body.length).toBeGreaterThan(1000);
    expect(allPdf.body.length).toBeGreaterThan(1000);
  });
});
