import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";

describe("Invoice PDF Download", () => {
  let token;
  let invoiceId;

  beforeAll(async () => {
    token = await getAdminToken(app);

    // Create an invoice to use for PDF tests
    const res = await request(app)
      .post("/api/billing/invoices")
      .set(authHeader(token))
      .send({
        patient: testData.patient._id.toString(),
        clinic: testData.clinic._id.toString(),
        items: [
          {
            itemType: "treatment",
            description: "Dental Cleaning",
            quantity: 1,
            unitPrice: 2000,
            taxRate: 0,
          },
        ],
      });

    const invoice = res.body.data.invoice || res.body.data;
    invoiceId = invoice._id;
  });

  it("GET /api/billing/invoices/:id/pdf - downloads invoice as PDF", async () => {
    const res = await request(app)
      .get(`/api/billing/invoices/${invoiceId}/pdf`)
      .set(authHeader(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("GET /api/billing/invoices/invalidid/pdf - returns 400 for invalid ID", async () => {
    const res = await request(app)
      .get("/api/billing/invoices/invalidid/pdf")
      .set(authHeader(token));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
