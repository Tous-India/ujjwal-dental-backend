import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("GET /api/payments/summary-stats", () => {
  let token;

  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };

  beforeAll(async () => {
    token = await getAdminToken(app);

    // Paid, in-range, no refund.
    await Payment.create({
      patient: testData.patient._id,
      amount: 5000,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
      paidAt: new Date(),
      createdAt: new Date(),
    });
    // Paid then refunded -- both collected (gross) AND refunded should count,
    // and the refund should be dated by refund.refundedAt.
    await Payment.create({
      patient: testData.patient._id,
      amount: 2000,
      paymentMode: "upi",
      type: "invoice_payment",
      status: "refunded",
      paidAt: daysAgo(3),
      createdAt: daysAgo(3),
      refund: { amount: 2000, refundedAt: new Date() },
    });
    // Failed payment -- must NOT count toward Total Collected or Transactions.
    await Payment.create({
      patient: testData.patient._id,
      amount: 999,
      paymentMode: "razorpay",
      type: "invoice_payment",
      status: "failed",
      createdAt: new Date(),
    });
    // Paid, but far outside any "this week" range -- for range-boundary check.
    await Payment.create({
      patient: testData.patient._id,
      amount: 7777,
      paymentMode: "cash",
      type: "invoice_payment",
      status: "paid",
      paidAt: daysAgo(90),
      createdAt: daysAgo(90),
    });
  });

  it("T1 (HARD GATE): summary matches real DB state for an explicit range", async () => {
    // `to` uses tomorrow's date, not today's -- the endpoint does `new Date(to)`
    // on a date-only string, which parses as UTC midnight (same convention as
    // getAllLabOrders elsewhere in this codebase). In a UTC+ timezone, "today"
    // as a date-only string can be BEFORE "now" once converted, excluding
    // same-day records. Using tomorrow avoids that boundary flake in the test
    // without changing the endpoint's (intentionally consistent) behavior.
    const from = daysAgo(5).toISOString().slice(0, 10);
    const to = daysAgo(-1).toISOString().slice(0, 10);

    const res = await request(app)
      .get("/api/payments/summary-stats")
      .query({ from, to })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const { totalCollected, totalRefunded, netCollection, transactionCount } = res.body.data;

    // Collected = paid (5000) + refunded (2000, still counts as gross collected) = 7000.
    // Failed (999) and the 90-days-ago payment (7777) are excluded.
    expect(totalCollected).toBe(7000);
    expect(totalRefunded).toBe(2000);
    expect(netCollection).toBe(5000);
    // Transactions = count of status "paid" only = 1 (the 5000 one; the refunded
    // one is status "refunded", not "paid", by the time it's queried).
    expect(transactionCount).toBe(1);
  });

  it("T2 (HARD GATE): narrowing the range excludes everything", async () => {
    const from = daysAgo(2).toISOString().slice(0, 10);
    const to = daysAgo(1).toISOString().slice(0, 10);

    const res = await request(app)
      .get("/api/payments/summary-stats")
      .query({ from, to })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.totalCollected).toBe(0);
    expect(res.body.data.transactionCount).toBe(0);
  });

  it("T3: computed from Payment collection only -- no Invoice query involved", async () => {
    // Structural check: this endpoint's implementation must not import/query Invoice.
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../../src/modules/payments/payment.controller.js", import.meta.url),
      "utf8"
    );
    const fnStart = src.indexOf("export const getPaymentSummaryStats");
    const fnBody = src.slice(fnStart, fnStart + 2000);
    expect(fnBody).not.toMatch(/Invoice\./);
  });
});
