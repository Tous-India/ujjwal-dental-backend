import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import { cleanupPatientRecords } from "../helpers/teardown.js";

describe("Invoice Lifecycle", () => {
  let token;
  let invoiceId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  afterAll(async () => {
    await cleanupPatientRecords(testData.patient._id);
  });

  it("POST /api/billing/invoices - creates draft invoice", async () => {
    const res = await request(app)
      .post("/api/billing/invoices")
      .set(authHeader(token))
      .send({
        patient: testData.patient._id.toString(),
        clinic: testData.clinic._id.toString(),
        items: [
          {
            itemType: "treatment",
            description: "Root Canal Treatment",
            quantity: 1,
            unitPrice: 5000,
            taxRate: 0,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const invoice = res.body.data.invoice || res.body.data;
    expect(invoice.status).toBe("draft");
    expect(invoice.invoiceNumber).toMatch(/^INV-/);
    invoiceId = invoice._id;
  });

  it("GET /api/billing/invoices/:id - gets invoice with correct total", async () => {
    const res = await request(app)
      .get(`/api/billing/invoices/${invoiceId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const invoice = res.body.data.invoice || res.body.data;
    expect(invoice.grandTotal).toBe(5000);
  });

  it("POST /api/billing/invoices/:id/issue - issues invoice", async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${invoiceId}/issue`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const invoice = res.body.data.invoice || res.body.data;
    expect(invoice.status).toBe("sent");
  });

  it("POST /api/billing/invoices/:id/payment - records partial payment", async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${invoiceId}/payment`)
      .set(authHeader(token))
      .send({ amount: 2000 });

    expect(res.status).toBe(200);
    const invoice = res.body.data.invoice || res.body.data;
    expect(invoice.paymentStatus).toBe("partial");
    expect(invoice.amountPaid).toBe(2000);
  });

  it("POST /api/billing/invoices/:id/payment - records remaining payment", async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${invoiceId}/payment`)
      .set(authHeader(token))
      .send({ amount: 3000 });

    expect(res.status).toBe(200);
    const invoice = res.body.data.invoice || res.body.data;
    expect(invoice.paymentStatus).toBe("paid");
    expect(invoice.balanceDue).toBe(0);
  });

  it("POST /api/billing/invoices/:id/cancel - cannot cancel paid invoice", async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${invoiceId}/cancel`)
      .set(authHeader(token))
      .send({ reason: "Test cancel" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
