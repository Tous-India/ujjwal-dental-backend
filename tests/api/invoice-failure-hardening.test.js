/**
 * Invoice-failure hardening (Part B).
 *
 * Regression cover for the real incident where patient "Swati"
 * (UD-2608-1201) ended up with a completed, chargeable appointment and NO
 * invoice: generateInvoice() threw, appointment.controller.js swallowed it to
 * a console.error, and the API still returned 201 "success".
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Invoice-failure hardening", () => {
  let token;
  beforeAll(async () => { token = await getAdminToken(app); });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ patient: testData.patient._id });
  });

  const book = () =>
    request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 86400000).toISOString(),
      timeSlot: "15:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Checkup",
      visitType: "opd",
      opdFee: 300,
      paymentMethod: "cash",
      opdFeePaid: false,
    });

  it("T3: Invoice.createSafe retries on a duplicate invoiceNumber (E11000)", async () => {
    const dupErr = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
      keyPattern: { invoiceNumber: 1 },
    });
    // Fail the first attempt, succeed on the retry.
    const spy = vi.spyOn(Invoice, "create")
      .mockRejectedValueOnce(dupErr)
      .mockResolvedValueOnce({ _id: "fake", invoiceNumber: "INV-RETRY-0001" });

    const result = await Invoice.createSafe({ patient: testData.patient._id, items: [] });
    expect(spy).toHaveBeenCalledTimes(2);       // proves it retried
    expect(result.invoiceNumber).toBe("INV-RETRY-0001");
  });

  it("T3b: createSafe does NOT swallow a non-duplicate error", async () => {
    vi.spyOn(Invoice, "create").mockRejectedValue(new Error("validation exploded"));
    await expect(Invoice.createSafe({ patient: testData.patient._id, items: [] }))
      .rejects.toThrow("validation exploded");
  });

  it("T2: invoice failure -> booking still succeeds, but warning returned AND invoiceError persisted", async () => {
    vi.spyOn(Invoice, "create").mockRejectedValue(new Error("simulated invoice outage"));

    const res = await book();

    // Booking is deliberately preserved...
    expect(res.status).toBe(201);
    expect(res.body.data.appointmentId).toBeTruthy();

    // ...but it must NOT look like a clean success any more.
    expect(res.body.data.invoiceId).toBeFalsy();
    expect(res.body.data.invoiceError).toBeTruthy();
    expect(res.body.data.invoiceError.message).toMatch(/simulated invoice outage/);
    expect(res.body.data.warning).toMatch(/invoice generation failed/i);

    // Persisted on the appointment for the Dashboard alert.
    const appt = await Appointment.findById(res.body.data.appointmentId);
    expect(appt.invoiceError?.message).toMatch(/simulated invoice outage/);
    expect(appt.invoiceError?.failedAt).toBeTruthy();
    expect(appt.invoice).toBeFalsy();
  });

  it("T2b: healthy booking sets NO warning and NO invoiceError", async () => {
    const res = await book();
    expect(res.status).toBe(201);
    expect(res.body.data.invoiceId).toBeTruthy();
    expect(res.body.data.warning).toBeUndefined();
    expect(res.body.data.invoiceError).toBeFalsy();
    const appt = await Appointment.findById(res.body.data.appointmentId);
    expect(appt.invoiceError?.message).toBeFalsy();
  });

  it("detection endpoint surfaces the unbilled appointment, and not healthy ones", async () => {
    vi.spyOn(Invoice, "create").mockRejectedValue(new Error("simulated invoice outage"));
    const broken = await book();
    vi.restoreAllMocks();

    const res = await request(app).get("/api/appointments/unbilled").set(authHeader(token));
    expect(res.status).toBe(200);

    const numbers = res.body.data.unbilledAppointments.map((a) => a._id);
    expect(numbers).toContain(broken.body.data.appointmentId);
    expect(res.body.data.count).toBeGreaterThan(0);

    // A healthy (invoiced) booking must NOT be flagged. Booked on a DIFFERENT
    // day -- the same patient can't book twice within the minimum-gap window.
    const healthy = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 5 * 86400000).toISOString(),
      timeSlot: "16:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Checkup", visitType: "opd", opdFee: 300,
      paymentMethod: "cash", opdFeePaid: false,
    });
    expect(healthy.status).toBe(201);
    const res2 = await request(app).get("/api/appointments/unbilled").set(authHeader(token));
    expect(res2.body.data.unbilledAppointments.map((a) => a._id))
      .not.toContain(healthy.body.data.appointmentId);
  });

  it("free appointments are never flagged as unbilled", async () => {
    await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 86400000).toISOString(),
      timeSlot: "17:30",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Free follow-up", visitType: "opd", isFree: true,
    });
    const res = await request(app).get("/api/appointments/unbilled").set(authHeader(token));
    const flaggedFree = res.body.data.unbilledAppointments.filter((a) => a.isFree);
    expect(flaggedFree).toHaveLength(0);
  });
});
