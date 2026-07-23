import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Billing Balance Due -- per-invoice clamped, never aggregate-subtracted", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1/T2 (HARD GATE): reproduces Sunny's exact scenario -- one big real due + standalone/orphaned money that must NOT erase it", async () => {
    // Invoice A: genuinely owes 15,400 (mirrors Nisha's real case) -- no
    // Payment at all backing it yet.
    const bigDueInvoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Ortho", quantity: 1, unitPrice: 36400, amount: 36400, total: 36400 }],
      amountPaid: 21000,
    });

    // A standalone payment with NO invoice link at all -- must not "erase"
    // invoice A's real due when netted at the aggregate level.
    const standalone = await Payment.create({
      patient: testData.patient._id,
      amount: 9999,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
    });

    // A payment whose settledInvoices references an invoice id that doesn't exist.
    const orphaned = await Payment.create({
      patient: testData.patient._id,
      amount: 4000,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
      settledInvoices: [
        { invoiceId: new (await import("mongoose")).default.Types.ObjectId(), invoiceNumber: "GHOST-0001", appliedAmount: 4000, previousAmountPaid: 0 },
      ],
    });

    const res = await request(app)
      .get("/api/billing/stats")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const { totalDue } = res.body.data.stats;

    // T2: total Balance Due must be >= the single invoice's own real due
    // (36400 - 21000 = 15400), regardless of the unrelated 9999+4000 in
    // other Payment records for this patient.
    expect(totalDue).toBeGreaterThanOrEqual(15400);
    // The old (broken) aggregate-subtraction formula would have produced
    // something far lower than 15400 here (totalAmount - flat totalPaid
    // would net out the standalone+orphaned money against this invoice's
    // due) -- explicitly assert we do NOT reproduce that.
    expect(totalDue).not.toBeLessThan(15400);

    await Invoice.deleteOne({ _id: bigDueInvoice._id });
    await Payment.deleteOne({ _id: standalone._id });
    await Payment.deleteOne({ _id: orphaned._id });
  });

  it("T3: table row's Due column matches the summary card's per-invoice logic (live-computed, not stale stored field)", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Crown", quantity: 1, unitPrice: 5000, amount: 5000, total: 5000 }],
      amountPaid: 5000, // stored as fully paid, but NO real Payment doc backs it
    });

    const listRes = await request(app)
      .get("/api/billing/invoices")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));

    expect(listRes.status).toBe(200);
    const row = listRes.body.data.find((i) => i._id === invoice._id.toString());
    expect(row).toBeTruthy();
    // Live-computed: real paid is 0 (no Payment doc), so balanceDue should
    // reflect that -- NOT the stale stored amountPaid=5000/balanceDue=0.
    expect(row.amountPaid).toBe(0);
    expect(row.balanceDue).toBe(5000);
    expect(row.paymentStatus).toBe("unpaid");

    // Now back it with a real, correctly-linked payment and confirm the row updates live.
    const payment = await Payment.create({
      patient: testData.patient._id,
      amount: 5000,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
      settledInvoices: [{ invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, appliedAmount: 5000, previousAmountPaid: 0 }],
    });

    const listRes2 = await request(app)
      .get("/api/billing/invoices")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));
    const row2 = listRes2.body.data.find((i) => i._id === invoice._id.toString());
    expect(row2.amountPaid).toBe(5000);
    expect(row2.balanceDue).toBe(0);
    expect(row2.paymentStatus).toBe("paid");

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteOne({ _id: payment._id });
  });
});
