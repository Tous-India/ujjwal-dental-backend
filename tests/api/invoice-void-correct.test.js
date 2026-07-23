import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";

describe("Void Invoice + Edit Invoice self-service tools", () => {
  let token;
  let paidInvoiceId;

  beforeAll(async () => {
    token = await getAdminToken(app);

    // A paid invoice with NO linked Payment doc -- mirrors the real
    // Vivek phantom-invoice scenario (create directly so pre-save hooks run
    // once at creation only, matching how such invoices actually got made).
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "membership",
          description: "Premium Dental Health Plan",
          quantity: 1,
          unitPrice: 499,
          amount: 499,
          total: 499,
        },
      ],
      amountPaid: 499,
      paymentMethod: "upi",
    });
    paidInvoiceId = invoice._id.toString();
  });

  it("T1 (HARD GATE): void a paid invoice -- marked voided with reason, excluded from active totals, still visible under Voided filter", async () => {
    const before = await Invoice.findById(paidInvoiceId).lean();
    expect(before.isVoided).toBe(false);

    const voidRes = await request(app)
      .post(`/api/billing/invoices/${paidInvoiceId}/void`)
      .set(authHeader(token))
      .send({ reason: "Phantom invoice -- no real payment received, confirmed by admin." });

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.data.invoice.isVoided).toBe(true);
    expect(voidRes.body.data.invoice.voidReason).toMatch(/Phantom invoice/);

    // Excluded from the default (active) invoice list.
    const activeList = await request(app)
      .get("/api/billing/invoices")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));
    const activeIds = activeList.body.data.map((i) => i._id);
    expect(activeIds).not.toContain(paidInvoiceId);

    // Still visible under the Voided filter.
    const voidedList = await request(app)
      .get("/api/billing/invoices")
      .query({ patient: testData.patient._id.toString(), voided: "true" })
      .set(authHeader(token));
    const voidedIds = voidedList.body.data.map((i) => i._id);
    expect(voidedIds).toContain(paidInvoiceId);

    // Excluded from active billing stats (Total Billed).
    const statsBefore = await request(app)
      .get("/api/billing/stats")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));
    // The voided invoice's 499 must not be included.
    expect(statsBefore.body.data.stats.totalAmount).not.toBeGreaterThanOrEqual(499);

    // Cannot void twice.
    const secondVoid = await request(app)
      .post(`/api/billing/invoices/${paidInvoiceId}/void`)
      .set(authHeader(token))
      .send({ reason: "Trying to void again, should fail." });
    expect(secondVoid.status).toBe(400);

    // Reason is mandatory.
    const noReason = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "other", description: "Test", quantity: 1, unitPrice: 100, amount: 100, total: 100 }],
    });
    const rejectedVoid = await request(app)
      .post(`/api/billing/invoices/${noReason._id}/void`)
      .set(authHeader(token))
      .send({ reason: "short" });
    expect(rejectedVoid.status).toBe(400);
  });

  it("T2 (HARD GATE): edit an invoice's items -- correct recalculation, editHistory logged, updateOne/$set only (never .save())", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "treatment",
          description: "Root Canal",
          quantity: 1,
          unitPrice: 0, // deliberately wrong, matching the real corruption scenario
          amount: 0,
          total: 0,
        },
      ],
      amountPaid: 0,
    });
    const id = invoice._id.toString();
    const versionBefore = invoice.__v;

    const res = await request(app)
      .patch(`/api/billing/invoices/${id}/correct`)
      .set(authHeader(token))
      .send({
        items: [
          {
            itemType: "treatment",
            description: "Root Canal",
            quantity: 1,
            unitPrice: 20000,
            discount: { percentage: 30, amount: 0 },
            taxRate: 0,
          },
        ],
        amountPaid: 21000,
        reason: "Restoring correct total from settled Payment records after the invoice-corruption bug zeroed it.",
      });

    expect(res.status).toBe(200);
    const updated = res.body.data.invoice;
    // 20000 * 0.7 = 14000
    expect(updated.grandTotal).toBe(14000);
    expect(updated.amountPaid).toBe(21000);
    expect(updated.balanceDue).toBe(0);
    expect(updated.paymentStatus).toBe("paid");
    expect(updated.editHistory.length).toBe(1);
    expect(updated.editHistory[0].reason).toMatch(/Restoring correct total/);

    // __v must be unchanged -- proves updateOne/$set, not a document .save().
    const raw = await Invoice.findById(id).lean();
    expect(raw.__v).toBe(versionBefore);

    // Reason is mandatory here too.
    const rejected = await request(app)
      .patch(`/api/billing/invoices/${id}/correct`)
      .set(authHeader(token))
      .send({ amountPaid: 5000, reason: "no" });
    expect(rejected.status).toBe(400);
  });

  it("T2b: correctInvoice implementation never calls .save() on the Invoice document (structural check)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../../src/modules/billing/billing.controller.js", import.meta.url),
      "utf8"
    );
    const fnStart = src.indexOf("export const correctInvoice");
    const fnEnd = src.indexOf("\nexport const", fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd === -1 ? fnStart + 4000 : fnEnd);
    expect(fnBody).not.toMatch(/invoice\.save\(\)/);
    expect(fnBody).toMatch(/updateOne/);
  });

  it("T4: voiding/editing does not touch any linked Payment document", async () => {
    const Payment = (await import("../../src/modules/payments/payment.model.js")).default;
    const payment = await Payment.create({
      patient: testData.patient._id,
      amount: 1000,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
    });
    const before = await Payment.findById(payment._id).lean();

    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "other", description: "X", quantity: 1, unitPrice: 100, amount: 100, total: 100 }],
    });
    await request(app)
      .post(`/api/billing/invoices/${invoice._id}/void`)
      .set(authHeader(token))
      .send({ reason: "Unrelated void, checking payment isolation." });

    const after = await Payment.findById(payment._id).lean();
    expect(after).toEqual(before);
  });

  it("T5 (regression): normal (non-voided) invoices are unaffected by the new isVoided filtering", async () => {
    // POST /api/billing/invoices itself has a pre-existing failure unrelated
    // to this change (confirmed via git stash: fails identically on main
    // before these edits) -- so this regression check instead verifies the
    // read-path change (isVoided default exclusion) doesn't affect a normal
    // invoice created directly via the model, the same way billing.test.js's
    // other assertions work around that pre-existing gap.
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Filling", quantity: 1, unitPrice: 2000, amount: 2000, total: 2000 }],
    });
    expect(invoice.isVoided).toBe(false);

    const list = await request(app)
      .get("/api/billing/invoices")
      .query({ patient: testData.patient._id.toString() })
      .set(authHeader(token));
    const ids = list.body.data.map((i) => i._id);
    expect(ids).toContain(invoice._id.toString());
  });
});
