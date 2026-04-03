import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";

describe("Payments", () => {
  let token;
  let paymentId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("GET /api/payments - lists payments (admin auth)", async () => {
    const res = await request(app)
      .get("/api/payments")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it("POST /api/payments - records a payment (admin auth)", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set(authHeader(token))
      .send({
        patient: testData.patient._id.toString(),
        amount: 500,
        paymentMode: "cash",
        clinic: testData.clinic._id.toString(),
        type: "opd_fee",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const payment = res.body.data.payment || res.body.data;
    expect(payment.amount).toBe(500);
    expect(payment.status).toBe("paid");
    paymentId = payment._id;
  });

  it("GET /api/payments/:id - gets single payment (admin auth)", async () => {
    const res = await request(app)
      .get(`/api/payments/${paymentId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const payment = res.body.data.payment || res.body.data;
    expect(payment._id).toBe(paymentId);
    expect(payment.amount).toBe(500);
  });
});
