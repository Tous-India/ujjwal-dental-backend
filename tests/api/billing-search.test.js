import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Patient from "../../src/modules/patients/patient.model.js";
import Clinic from "../../src/modules/clinics/clinic.model.js";

describe("GET /api/billing/invoices - search", () => {
  let token;
  let disha, other, clinic;

  beforeAll(async () => {
    token = await getAdminToken(app);
    clinic = await Clinic.findOne();

    disha = await Patient.create({ name: "Disha Search Test", phone: "9992221111" });
    other = await Patient.create({ name: "Someone Else", phone: "9998887777" });

    await Invoice.create({
      patient: disha._id,
      clinic: clinic._id,
      items: [{ itemType: "other", description: "X", quantity: 1, unitPrice: 100, amount: 100, total: 100 }],
    });
    await Invoice.create({
      patient: other._id,
      clinic: clinic._id,
      items: [{ itemType: "other", description: "Y", quantity: 1, unitPrice: 200, amount: 200, total: 200 }],
    });
  });

  it("T1 (HARD GATE): search 'disha' returns ONLY Disha's invoices", async () => {
    const res = await request(app)
      .get("/api/billing/invoices")
      .query({ search: "disha" })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const patientIds = res.body.data.map((i) => i.patient?._id || i.patient);
    expect(patientIds.every((id) => String(id) === String(disha._id))).toBe(true);
  });

  it("also matches by invoice number", async () => {
    const inv = await Invoice.findOne({ patient: disha._id });
    const res = await request(app)
      .get("/api/billing/invoices")
      .query({ search: inv.invoiceNumber })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.map((i) => i._id)).toContain(inv._id.toString());
  });
});
