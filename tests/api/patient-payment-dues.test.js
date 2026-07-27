import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

// The patient-login endpoint is a pre-existing broken test-infra path
// (one of tonight's known baseline failures, unrelated to this fix) --
// generating a real JWT matching patientProtect's exact expected payload
// shape ({ id, type: "patient" }) instead, so the endpoint itself is still
// exercised through its real auth middleware, not bypassed/mocked.
const patientToken = () =>
  jwt.sign({ id: String(testData.patient._id), type: "patient" }, process.env.JWT_SECRET, { expiresIn: "1h" });

describe("Patient Payment History -- running Dues balance from settledInvoices", () => {
  it("T1 (HARD GATE): Dues correctly DECREASES across chronological payments on the SAME invoice", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: 20000, amount: 20000, total: 20000 }],
      amountPaid: 15000,
    });

    // First payment: previousAmountPaid=0, appliedAmount=10000 -> due = 20000-10000 = 10000
    const payment1 = await Payment.create({
      patient: testData.patient._id,
      amount: 10000,
      paymentMode: "cash",
      type: "treatment",
      status: "paid",
      settledInvoices: [{ invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, appliedAmount: 10000, previousAmountPaid: 0 }],
    });
    await Payment.collection.updateOne({ _id: payment1._id }, { $set: { createdAt: new Date("2026-07-01") } });

    // Second (later) payment: previousAmountPaid=10000, appliedAmount=5000 -> due = 20000-15000 = 5000
    const payment2 = await Payment.create({
      patient: testData.patient._id,
      amount: 5000,
      paymentMode: "cash",
      type: "treatment",
      status: "paid",
      settledInvoices: [{ invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, appliedAmount: 5000, previousAmountPaid: 10000 }],
    });
    await Payment.collection.updateOne({ _id: payment2._id }, { $set: { createdAt: new Date("2026-07-10") } });

    const res = await request(app)
      .get("/api/billing/invoices/my-payment-history")
      .set("Authorization", `Bearer ${patientToken()}`);
    expect(res.status).toBe(200);

    const row1 = res.body.data.find((p) => p._id === String(payment1._id));
    const row2 = res.body.data.find((p) => p._id === String(payment2._id));
    expect(row1.dueAfterThisPayment).toBe(10000);
    expect(row2.dueAfterThisPayment).toBe(5000);
    // Confirms the DECREASING running-balance pattern across chronological rows
    expect(row2.dueAfterThisPayment).toBeLessThan(row1.dueAfterThisPayment);

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteMany({ _id: { $in: [payment1._id, payment2._id] } });
  });

  it("T2: a standalone payment with no settledInvoices shows null (frontend renders '-')", async () => {
    const payment = await Payment.create({
      patient: testData.patient._id,
      amount: 500,
      paymentMode: "cash",
      type: "other",
      status: "paid",
    });

    const res = await request(app)
      .get("/api/billing/invoices/my-payment-history")
      .set("Authorization", `Bearer ${patientToken()}`);
    const row = res.body.data.find((p) => p._id === String(payment._id));
    expect(row.dueAfterThisPayment).toBeNull();

    await Payment.deleteOne({ _id: payment._id });
  });

  it("T3: a fully-paid OPD fee (Rs300 total, Rs300 paid) shows Dues = Rs0", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD Consultation", quantity: 1, unitPrice: 300, amount: 300, total: 300 }],
      amountPaid: 300,
    });
    const payment = await Payment.create({
      patient: testData.patient._id,
      amount: 300,
      paymentMode: "cash",
      type: "opd_fee",
      status: "paid",
      settledInvoices: [{ invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, appliedAmount: 300, previousAmountPaid: 0 }],
    });

    const res = await request(app)
      .get("/api/billing/invoices/my-payment-history")
      .set("Authorization", `Bearer ${patientToken()}`);
    const row = res.body.data.find((p) => p._id === String(payment._id));
    expect(row.dueAfterThisPayment).toBe(0);

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteOne({ _id: payment._id });
  });
});
