import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../../app.js";
import Payment from "../../src/modules/payments/payment.model.js";
import MembershipPlan from "../../src/modules/memberships/membership.model.js";

// Mock the Razorpay SDK so create-order/verify never hit the live API.
// orders.create echoes back the amount it was called with so we can assert the
// server used its own price (not the client-sent one).
vi.mock("razorpay", () => ({
  default: class RazorpayMock {
    constructor() {
      this.orders = {
        create: async ({ amount, currency }) => ({
          id: "order_mock_123",
          amount,
          currency: currency || "INR",
        }),
        fetch: async () => ({ amount_paid: 0 }),
      };
    }
  },
}));

describe("Razorpay webhook security", () => {
  const WEBHOOK_BODY = {
    event: "payment.captured",
    payload: { payment: { entity: { order_id: "order_nonexistent", amount: 100 } } },
  };

  afterAll(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it("rejects with 403 when RAZORPAY_WEBHOOK_SECRET is not set (fail closed)", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const res = await request(app)
      .post("/api/payments/razorpay/webhook")
      .send(WEBHOOK_BODY);

    expect(res.status).toBe(403);
  });

  it("rejects with 400 when the signature is invalid", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

    const res = await request(app)
      .post("/api/payments/razorpay/webhook")
      .set("x-razorpay-signature", "deadbeefdeadbeef")
      .send(WEBHOOK_BODY);

    expect(res.status).toBe(400);
  });

  it("accepts a request whose signature matches the raw body (HMAC over raw bytes)", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

    // supertest serializes the object with JSON.stringify and sends those exact
    // bytes; the server verifies the HMAC over req.rawBody (the same bytes).
    const raw = JSON.stringify(WEBHOOK_BODY);
    const signature = crypto
      .createHmac("sha256", "test_webhook_secret")
      .update(raw)
      .digest("hex");

    const res = await request(app)
      .post("/api/payments/razorpay/webhook")
      .set("x-razorpay-signature", signature)
      .send(WEBHOOK_BODY);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

describe("Razorpay create-order amount integrity", () => {
  beforeAll(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_dummy";
    process.env.RAZORPAY_KEY_SECRET = "dummy_secret";
  });

  it("ignores the client-sent amount and uses the server-side plan price", async () => {
    const plan = await MembershipPlan.create({
      name: "Security Test Plan",
      code: "SEC001",
      type: "individual",
      tier: "silver",
      price: 2000,
      discountPercentage: 10,
    });

    const res = await request(app)
      .post("/api/payments/razorpay/create-order")
      .send({
        type: "membership",
        planId: plan._id.toString(),
        amount: 1, // bogus client value — must be ignored
        isOnlineBooking: true,
      });

    expect(res.status).toBe(200);
    // Server price 2000 → 200000 paise, NOT the client-sent 1 (100 paise)
    expect(res.body.data.order.amount).toBe(200000);

    const payment = await Payment.findById(res.body.data.paymentId);
    expect(payment.amount).toBe(2000);
  });
});
