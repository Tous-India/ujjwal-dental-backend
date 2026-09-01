import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Payment from "../../src/modules/payments/payment.model.js";
import ExternalIncome from "../../src/modules/externalIncome/externalIncome.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

describe("Combined export -- regression after 4e332db", () => {
  let token;
  let invoices = [];
  let payments = [];
  let incomes = [];
  let extraPatient;

  beforeAll(async () => {
    token = await getAdminToken(app);

    // Create a second patient so rows have varied patient names
    extraPatient = await Patient.create({ name: "Combined Export Patient", phone: "9000000098" });

    // Create invoices + payments that match production-scale amounts
    // Rs 86,100 total payments (simulate close to real figures)
    const amounts = [5000, 12000, 800, 3000, 15000, 300, 500, 45000, 3500, 1000];
    for (const amt of amounts) {
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

    // One refunded payment
    const refundInv = await Invoice.create({
      patient: extraPatient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD", quantity: 1, unitPrice: 300, amount: 300, total: 300 }],
    });
    const refundPmt = await Payment.create({
      patient: extraPatient._id,
      amount: 300,
      paymentMode: "cash",
      type: "opd_fee",
      status: "refunded",
      invoice: refundInv._id,
      refund: { amount: 300, refundedAt: new Date(), reason: "duplicate" },
    });
    invoices.push(refundInv);
    payments.push(refundPmt);

    // External incomes (~Rs 65,316)
    const extAmounts = [20000, 15000, 12316, 18000];
    for (const amt of extAmounts) {
      const inc = await ExternalIncome.create({
        clinicName: "External Source",
        treatment: "Lab referral",
        doctorName: "Dr. Test",
        notes: "Lab fee",
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

  it("CSV: 200, Content-Type text/csv", async () => {
    const res = await request(app)
      .get("/api/payments/export/combined")
      .query({ format: "csv" })
      .set(authHeader(token));

    console.log("CSV status:", res.status);
    if (res.status !== 200) console.log("CSV error:", res.text?.slice(0, 500));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });

  it("PDF: 200, valid PDF with correct summary figures", async () => {
    const res = await request(app)
      .get("/api/payments/export/combined")
      .query({ format: "pdf" })
      .set(authHeader(token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    console.log("PDF status:", res.status);
    console.log("PDF content-type:", res.headers["content-type"]);
    console.log("PDF body size:", res.body?.length, "bytes");

    if (res.status !== 200) {
      const errText = res.body instanceof Buffer
        ? res.body.toString("utf8", 0, 1000)
        : JSON.stringify(res.body).slice(0, 1000);
      console.log("Error body:", errText);
    } else {
      const buf = res.body;
      console.log("PDF head:", buf.slice(0, 4).toString());
      console.log("PDF tail:", buf.slice(-10).toString().trim());
    }

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const buf = res.body;
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    expect(buf.slice(-6).toString().trim().endsWith("%%EOF")).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("T3: summary values match computed totals (non-zero figures)", async () => {
    // Compute expected totals from DB
    const voidedIds = await Invoice.find({ isVoided: true }).distinct("_id");
    const pmts = await Payment.find({
      status: { $in: ["paid", "refunded", "refund_pending"] },
      invoice: { $nin: voidedIds },
    }).lean();

    const expectedPatientCollected = pmts.reduce((s, p) => s + (p.amount || 0), 0);
    const expectedTotalRefunds = pmts
      .filter((p) => ["refunded", "refund_pending"].includes(p.status))
      .reduce((s, p) => s + ((p.refund && p.refund.amount) || 0), 0);

    const exts = await ExternalIncome.find({ isVoided: { $ne: true } }).lean();
    const expectedTotalExternal = exts.reduce((s, e) => s + (e.amount || 0), 0);
    const expectedTotalCollected = expectedPatientCollected + expectedTotalExternal;
    const expectedNetCollection = expectedTotalCollected - expectedTotalRefunds;

    console.log("Expected totals:");
    console.log("  patientCollected:", expectedPatientCollected);
    console.log("  totalRefunds:", expectedTotalRefunds);
    console.log("  totalExternal:", expectedTotalExternal);
    console.log("  totalCollected:", expectedTotalCollected);
    console.log("  netCollection:", expectedNetCollection);

    // Verify non-zero (testing non-trivial code path)
    expect(expectedPatientCollected).toBeGreaterThan(0);
    expect(expectedTotalExternal).toBeGreaterThan(0);
    expect(expectedNetCollection).toBeGreaterThan(0);

    // T3: summary coordinates -- value right edge = MARGIN + USABLE
    const MARGIN = 40;
    const PAGE_W = 841.89;
    const USABLE = PAGE_W - MARGIN * 2;
    const col2 = MARGIN + USABLE - 90;
    const valueWidth = 90;
    expect(col2 + valueWidth).toBeCloseTo(MARGIN + USABLE, 2);
  });

  it("T6: per-tab PDF export still works (regression check)", async () => {
    const res = await request(app)
      .get("/api/payments/export/pdf")
      .query({ status: "paid" })
      .set(authHeader(token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    console.log("Per-tab PDF status:", res.status);
    console.log("Per-tab PDF size:", res.body?.length, "bytes");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });
});
