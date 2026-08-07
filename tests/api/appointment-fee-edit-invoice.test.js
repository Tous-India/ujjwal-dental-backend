/**
 * Invoice generation on the EDIT path, and custom (non-default) fees.
 *
 * Invoice generation existed only on CREATE. An appointment booked FREE and
 * later edited to a real fee kept the fee change but never got an invoice --
 * so Billing had nothing to list and Collect Payment had nothing to work
 * against. A real Rs200 appointment (UD-2608-0846) hit exactly this.
 *
 * Also pins down the second hypothesis: that any fee other than the default
 * Rs300 might be wrong.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Invoice on fee edit + custom fee amounts", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ patient: testData.patient._id });
  });

  const book = (over = {}) =>
    request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 86400000).toISOString(),
      timeSlot: "10:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Checkup",
      visitType: "opd",
      ...over,
    });

  it("T1 (HARD GATE): editing a FREE appointment to Rs200 generates a linked invoice for exactly 200", async () => {
    const free = await book({ isFree: true, timeSlot: "10:00" });
    expect(free.status).toBe(201);
    const id = free.body.data.appointmentId;

    // Free bookings correctly have no invoice.
    expect(await Invoice.countDocuments({ patient: testData.patient._id })).toBe(0);

    const edit = await request(app)
      .patch(`/api/appointments/${id}`)
      .set(authHeader(token))
      .send({ isFree: false, opdFee: 200, fee: 200 });
    expect(edit.status).toBe(200);
    expect(edit.body.data.warning).toBeUndefined(); // generation succeeded

    const appt = await Appointment.findById(id);
    expect(appt.invoice).toBeTruthy();

    const invoice = await Invoice.findById(appt.invoice);
    expect(invoice.grandTotal).toBe(200); // NOT the 300 clinic default
    expect(invoice.balanceDue).toBe(200);
    expect(invoice.paymentStatus).toBe("unpaid");
    expect(invoice.items[0].unitPrice).toBe(200);
    expect(invoice.items[0].itemType).toBe("opd_fee");

    // And Collect Payment now genuinely works against it, end to end.
    const collect = await request(app)
      .post("/api/payments/admin/collect")
      .set(authHeader(token))
      .send({ invoiceId: String(invoice._id), amount: 200, mode: "cash" });
    expect(collect.status).toBe(200);

    const settled = await Invoice.findById(invoice._id);
    expect(settled.amountPaid).toBe(200);
    expect(settled.paymentStatus).toBe("paid");
  });

  it("T1b: editing free -> chargeable is IDEMPOTENT (a second edit does not create a second invoice)", async () => {
    const free = await book({ isFree: true, timeSlot: "10:30" });
    const id = free.body.data.appointmentId;

    await request(app).patch(`/api/appointments/${id}`).set(authHeader(token))
      .send({ isFree: false, opdFee: 200, fee: 200 });
    await request(app).patch(`/api/appointments/${id}`).set(authHeader(token))
      .send({ opdFee: 250, fee: 250 });

    expect(await Invoice.countDocuments({ patient: testData.patient._id })).toBe(1);

    // The existing invoice is SYNCED to the new fee, not duplicated.
    const appt = await Appointment.findById(id);
    const invoice = await Invoice.findById(appt.invoice);
    expect(invoice.grandTotal).toBe(250);
  });

  it("T2 (HARD GATE): NEW bookings at Rs200 / Rs500 / Rs750 each get an invoice for the EXACT amount", async () => {
    const cases = [
      { fee: 200, slot: "11:00" },
      { fee: 500, slot: "12:30" },
      { fee: 750, slot: "14:00" },
    ];

    for (const { fee, slot } of cases) {
      const res = await book({ opdFee: fee, timeSlot: slot, paymentMethod: "cash", opdFeePaid: false });
      expect(res.status).toBe(201);
      expect(res.body.data.invoiceId).toBeTruthy();

      const invoice = await Invoice.findById(res.body.data.invoiceId);
      expect(invoice.grandTotal).toBe(fee);   // never coerced to the 300 default
      expect(invoice.balanceDue).toBe(fee);
      expect(invoice.items[0].unitPrice).toBe(fee);

      const appt = await Appointment.findById(res.body.data.appointmentId);
      expect(appt.fee).toBe(fee);
      expect(appt.opdFee).toBe(fee);

      await Appointment.deleteMany({ patient: testData.patient._id });
      await Invoice.deleteMany({ patient: testData.patient._id });
    }
  });

  it("T2b: an emergency booking honours its own fee rather than the regular default", async () => {
    const res = await book({ opdFee: 500, bookingType: "emergency", timeSlot: "16:00" });
    expect(res.status).toBe(201);
    const invoice = await Invoice.findById(res.body.data.invoiceId);
    expect(invoice.grandTotal).toBe(500);
  });

  it("T5: regression -- a booking with NO explicit fee still uses the clinic default, and free bookings still get no invoice", async () => {
    const dflt = await book({ timeSlot: "17:00" });
    expect(dflt.status).toBe(201);
    const invoice = await Invoice.findById(dflt.body.data.invoiceId);
    expect(invoice.grandTotal).toBe(300); // the settings default still applies
    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });

    const free = await book({ isFree: true, timeSlot: "18:00" });
    expect(free.status).toBe(201);
    expect(free.body.data.invoiceId).toBeFalsy();
    expect(await Invoice.countDocuments({ patient: testData.patient._id })).toBe(0);
  });

  it("T5b: editing a chargeable appointment that ALREADY has an invoice does not create a second one", async () => {
    const paid = await book({ opdFee: 300, timeSlot: "19:00" });
    const id = paid.body.data.appointmentId;
    expect(await Invoice.countDocuments({ patient: testData.patient._id })).toBe(1);

    await request(app).patch(`/api/appointments/${id}`).set(authHeader(token))
      .send({ opdFee: 400, fee: 400 });

    expect(await Invoice.countDocuments({ patient: testData.patient._id })).toBe(1);
    const appt = await Appointment.findById(id);
    const invoice = await Invoice.findById(appt.invoice);
    expect(invoice.grandTotal).toBe(400);
  });

  it("T5c: editing a free appointment while KEEPING it free still creates no invoice", async () => {
    const free = await book({ isFree: true, timeSlot: "20:00" });
    const id = free.body.data.appointmentId;

    await request(app).patch(`/api/appointments/${id}`).set(authHeader(token))
      .send({ reason: "Updated reason" });

    expect(await Invoice.countDocuments({ patient: testData.patient._id })).toBe(0);
    const appt = await Appointment.findById(id);
    expect(appt.invoice).toBeFalsy();
  });

  it("a FAILED backfill is surfaced, not swallowed (same contract as the create path)", async () => {
    const free = await book({ isFree: true, timeSlot: "21:00" });
    const id = free.body.data.appointmentId;

    vi.spyOn(Invoice, "create").mockRejectedValue(new Error("simulated invoice outage"));

    const edit = await request(app)
      .patch(`/api/appointments/${id}`)
      .set(authHeader(token))
      .send({ isFree: false, opdFee: 200, fee: 200 });

    // The edit still succeeds -- we never lose the fee change...
    expect(edit.status).toBe(200);
    // ...but it must NOT look like a clean success.
    expect(edit.body.data.warning).toMatch(/invoice generation failed/i);
    expect(edit.body.data.invoiceError.message).toMatch(/simulated invoice outage/);

    const appt = await Appointment.findById(id);
    expect(appt.invoiceError?.message).toMatch(/simulated invoice outage/);
    expect(appt.invoice).toBeFalsy();
  });

  it("T4: the unbilled detection flags an appointment left in this state", async () => {
    const free = await book({ isFree: true, timeSlot: "09:30" });
    const id = free.body.data.appointmentId;

    vi.spyOn(Invoice, "create").mockRejectedValue(new Error("simulated outage"));
    await request(app).patch(`/api/appointments/${id}`).set(authHeader(token))
      .send({ isFree: false, opdFee: 200, fee: 200 });
    vi.restoreAllMocks();

    const res = await request(app).get("/api/appointments/unbilled").set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.unbilledAppointments.map((a) => a._id)).toContain(id);
  });
});
