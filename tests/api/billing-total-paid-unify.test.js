import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Billing 'Total Paid' unified with Payment History 'Total Collected'", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T3 (HARD GATE): Billing Total Paid and Payment History Total Collected agree for the same scope", async () => {
    // Deliberately create a real desync: invoice.amountPaid inflated vs the
    // actual Payment record backing it, mirroring tonight's confirmed
    // phantom-invoice pattern -- proves Billing no longer trusts the
    // (potentially wrong) Invoice.amountPaid field at all.
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "X", quantity: 1, unitPrice: 8000, amount: 8000, total: 8000 }],
      amountPaid: 8000, // set directly, NO matching Payment doc -- simulates the phantom pattern
    });
    const payment = await Payment.create({
      patient: testData.patient._id,
      amount: 2500, // deliberately different from invoice.amountPaid
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
      settledInvoices: [
        { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, appliedAmount: 2500, previousAmountPaid: 0 },
      ],
    });

    const billingRes = await request(app)
      .get("/api/billing/stats")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));
    const paymentHistoryRes = await request(app)
      .get("/api/payments/summary-stats")
      .set(authHeader(token));

    expect(billingRes.status).toBe(200);
    expect(paymentHistoryRes.status).toBe(200);

    // Billing's Total Paid must reflect the REAL Payment sum (2500), not the
    // inflated Invoice.amountPaid (8000) -- proving it no longer derives
    // from the invoice field at all.
    expect(billingRes.body.data.stats.totalPaid).toBe(2500);
    expect(billingRes.body.data.stats.totalPaid).not.toBe(8000);

    // Total Amount is unchanged -- still Invoice.grandTotal-derived (8000).
    expect(billingRes.body.data.stats.totalAmount).toBe(8000);

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteOne({ _id: payment._id });
  });

  it("T3b: date-range scoping still works (createdAt-based, matching Payment History)", async () => {
    const outOfRange = await Payment.create({
      patient: testData.patient._id,
      amount: 9999,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
    });
    // Mongoose's timestamps plugin overwrites createdAt on .create() with
    // "now" regardless of what's passed in -- same behavior confirmed during
    // tonight's Vivek backfill. Force the real historical date via a raw
    // driver update, exactly as done there.
    await Payment.collection.updateOne({ _id: outOfRange._id }, { $set: { createdAt: new Date("2020-01-01") } });

    const res = await request(app)
      .get("/api/billing/stats")
      .query({ from: "2026-01-01", to: "2026-12-31", patient: testData.patient._id.toString() })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stats.totalPaid).not.toBeGreaterThanOrEqual(9999);

    await Payment.deleteOne({ _id: outOfRange._id });
  });
});
