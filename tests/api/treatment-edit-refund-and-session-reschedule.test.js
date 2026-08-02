/**
 * Real API-level tests backing tonight's build:
 *
 *  - Items 3+4: the admin Treatment Name dropdown's "Other" option is purely
 *    a frontend construct -- the backend contract it relies on (custom
 *    treatmentId="other" + free-text treatmentName, both at booking AND via
 *    the treatment-items edit endpoint) must still round-trip exactly.
 *
 *  - Item 5: session reschedule reuses the existing generic
 *    POST /:id/reschedule endpoint end-to-end, including a same-day
 *    reschedule (which was broken by a pre-existing `now is not defined`
 *    bug in rescheduleAppointment, fixed alongside this feature) and normal
 *    slot-capacity / backdating validation.
 *
 *  - Item 6: the "edit a treatment's fee down below amountPaid" scenario,
 *    proven against BOTH shapes a treatment's payments can take in this
 *    app -- a booking-time payment (Payment.invoice singular, refund-
 *    eligible) and per-session "Collect Payment" payments (settledInvoices[],
 *    void-only) -- confirming the real gap identified during investigation:
 *    when ALL of a treatment's payments were collected via the per-session
 *    flow, none of them are refund-eligible.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Patient from "../../src/modules/patients/patient.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Items 3+4 -- custom 'Other' treatment name round-trips", () => {
  let token;
  let patient;
  let opdAppointmentId;

  beforeAll(async () => {
    token = await getAdminToken(app);
    patient = await Patient.create({ name: "Other-Name Patient", phone: "9111100001" });

    const opdRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        timeSlot: "11:00",
        reason: "Checkup",
        visitType: "opd",
      });
    expect(opdRes.status).toBe(201);
    opdAppointmentId = opdRes.body.data.appointmentId;
  });

  it("POST /api/appointments -- a custom treatment name (treatmentId='other') round-trips exactly", async () => {
    const customName = "Custom Gum Recontouring";
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        timeSlot: "12:00",
        reason: customName,
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: customName,
        fee: 2000,
        items: [{ description: customName, unitPrice: 2000, itemType: "treatment" }],
        originatingOpdAppointmentId: opdAppointmentId,
      });

    expect(res.status).toBe(201);
    const saved = await Appointment.findById(res.body.data.appointmentId).lean();
    expect(saved.treatmentName).toBe(customName);
    expect(saved.treatmentId).toBeUndefined();
  });

  it("PATCH /api/appointments/:id/treatment-items -- a custom treatment name round-trips exactly", async () => {
    const createRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        timeSlot: "13:00",
        reason: "Initial Name",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Initial Name",
        fee: 1500,
        items: [{ description: "Initial Name", unitPrice: 1500, itemType: "treatment" }],
        originatingOpdAppointmentId: opdAppointmentId,
      });
    const apptId = createRes.body.data.appointmentId;

    const renamedTo = "Renamed Via Other Field";
    const editRes = await request(app)
      .patch(`/api/appointments/${apptId}/treatment-items`)
      .set(authHeader(token))
      .send({
        treatmentName: renamedTo,
        items: [{ description: renamedTo, unitPrice: 1500, itemType: "treatment" }],
        discountPercent: 0,
      });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.appointment.treatmentName).toBe(renamedTo);

    const saved = await Appointment.findById(apptId).lean();
    expect(saved.treatmentName).toBe(renamedTo);
  });
});

describe("Item 6 -- edit treatment fee down below amountPaid (overpaid scenario)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  const bookTreatmentAndOpd = async (patient, fee, opdFeePaid) => {
    const opdRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        timeSlot: "09:00",
        reason: "Checkup",
        visitType: "opd",
      });
    const opdId = opdRes.body.data.appointmentId;

    const treatRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        timeSlot: "09:30",
        reason: "RCT",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal Treatment (RCT)",
        fee,
        items: [{ description: "Root Canal Treatment (RCT)", unitPrice: fee, itemType: "treatment" }],
        originatingOpdAppointmentId: opdId,
        opdFeePaid,
        paymentMethod: "cash",
        amountPaid: opdFeePaid ? fee : undefined,
      });
    expect(treatRes.status).toBe(201);
    return treatRes.body.data.appointmentId;
  };

  it("scenario A: fully paid at booking (singular-invoice payment) -- overpaid edit is graceful AND a refund-eligible payment exists", async () => {
    const patient = await Patient.create({ name: "Overpaid Booking Patient", phone: "9111100002" });
    const apptId = await bookTreatmentAndOpd(patient, 4000, true);

    const appt = await Appointment.findById(apptId).lean();
    const invoiceBefore = await Invoice.findById(appt.invoice).lean();
    expect(invoiceBefore.amountPaid).toBe(4000);
    expect(invoiceBefore.grandTotal).toBe(4000);

    // Switch to extraction at ₹3,000 -- new total is below what's collected.
    const editRes = await request(app)
      .patch(`/api/appointments/${apptId}/treatment-items`)
      .set(authHeader(token))
      .send({
        treatmentName: "Wisdom Teeth",
        items: [{ description: "Wisdom Teeth", unitPrice: 3000, itemType: "treatment" }],
        discountPercent: 0,
      });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.warning).toMatch(/less than the amount already collected/i);

    const invoiceAfter = await Invoice.findById(appt.invoice).lean();
    // amountPaid must be EXACTLY what was really collected -- never touched.
    expect(invoiceAfter.amountPaid).toBe(4000);
    expect(invoiceAfter.grandTotal).toBe(3000);
    // balanceDue must be floored at 0, never negative.
    expect(invoiceAfter.balanceDue).toBe(0);
    expect(invoiceAfter.balanceDue).toBeGreaterThanOrEqual(0);

    // Confirm a refund-eligible payment (singular `invoice` field, no
    // settledInvoices) tied to this exact invoice actually exists -- this is
    // what TreatmentPlanDetailModal's "Refund the difference" connector
    // looks for.
    const payments = await Payment.find({ invoice: appt.invoice, status: "paid" }).lean();
    const refundEligible = payments.filter((p) => !p.settledInvoices?.length);
    expect(refundEligible.length).toBeGreaterThan(0);
    expect(refundEligible[0].amount).toBeGreaterThanOrEqual(1000);
  });

  it("scenario B: paid entirely via per-session Collect Payment (settledInvoices) -- overpaid edit is still graceful, but NO refund-eligible payment exists (confirmed gap)", async () => {
    const patient = await Patient.create({ name: "Overpaid Session-Collected Patient", phone: "9111100003" });
    const apptId = await bookTreatmentAndOpd(patient, 4000, false); // nothing collected at booking

    const appt = await Appointment.findById(apptId).lean();

    // Collect the full ₹4,000 across 3 separate "Collect Payment" calls,
    // mirroring the realistic pay-per-session workflow (same endpoint
    // TreatmentPlanDetailModal's session-row Collect Payment button uses).
    for (const amount of [1500, 1500, 1000]) {
      const collectRes = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: appt.invoice.toString(), amount, mode: "cash" });
      expect(collectRes.status).toBe(200);
    }

    const invoiceBefore = await Invoice.findById(appt.invoice).lean();
    expect(invoiceBefore.amountPaid).toBe(4000);

    // Switch to extraction at ₹3,000.
    const editRes = await request(app)
      .patch(`/api/appointments/${apptId}/treatment-items`)
      .set(authHeader(token))
      .send({
        treatmentName: "Wisdom Teeth",
        items: [{ description: "Wisdom Teeth", unitPrice: 3000, itemType: "treatment" }],
        discountPercent: 0,
      });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.warning).toMatch(/less than the amount already collected/i);

    const invoiceAfter = await Invoice.findById(appt.invoice).lean();
    expect(invoiceAfter.amountPaid).toBe(4000); // never touched
    expect(invoiceAfter.grandTotal).toBe(3000);
    expect(invoiceAfter.balanceDue).toBe(0); // floored, not negative

    // The confirmed gap: every payment against this invoice went through
    // settledInvoices[], so NONE are refund-eligible -- Refund Payment isn't
    // usable for any of them, only full-reversal Void is.
    const payments = await Payment.find({ status: "paid" }).lean();
    const tiedToInvoice = payments.filter((p) =>
      (p.settledInvoices || []).some((s) => s.invoiceId.toString() === appt.invoice.toString())
    );
    expect(tiedToInvoice.length).toBe(3);
    const refundEligible = tiedToInvoice.filter((p) => !p.settledInvoices?.length);
    expect(refundEligible.length).toBe(0);
    const singularInvoiceMatch = payments.filter((p) => p.invoice?.toString() === appt.invoice.toString());
    expect(singularInvoiceMatch.length).toBe(0);
  });
});

describe("Item 5 -- session reschedule reuses the shared endpoint + validation", () => {
  let token;
  let patient;
  let parentTreatmentId;
  let sessionApptId;

  const dateStr = (daysFromNow) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().split("T")[0];
  };

  beforeAll(async () => {
    token = await getAdminToken(app);
    patient = await Patient.create({ name: "Reschedule Session Patient", phone: "9111100004" });

    const opdRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: dateStr(1),
        timeSlot: "14:00",
        reason: "Checkup",
        visitType: "opd",
      });
    const opdId = opdRes.body.data.appointmentId;

    const parentRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: dateStr(1),
        timeSlot: "14:30",
        reason: "RCT",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal Treatment (RCT)",
        fee: 4000,
        items: [{ description: "Root Canal Treatment (RCT)", unitPrice: 4000, itemType: "treatment" }],
        originatingOpdAppointmentId: opdId,
        sessionsPlanned: 3,
      });
    parentTreatmentId = parentRes.body.data.appointmentId;

    const sessionRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: patient._id.toString(),
        phone: patient.phone,
        clinic: testData.clinic._id.toString(),
        date: dateStr(2),
        timeSlot: "15:00",
        visitType: "treatment_session",
        parentAppointment: parentTreatmentId,
        sessionNumber: 2,
        reason: "Session 2",
      });
    expect(sessionRes.status).toBe(201);
    sessionApptId = sessionRes.body.data._id;
  });

  it("valid case: reschedules the session to a new future date/time -- date/timeSlot update on the correct appointment doc", async () => {
    const res = await request(app)
      .post(`/api/appointments/${sessionApptId}/reschedule`)
      .set(authHeader(token))
      .send({ newDate: dateStr(3), newTimeSlot: "16:00", reason: "Patient requested" });

    expect(res.status).toBe(200);

    const updated = await Appointment.findById(sessionApptId).lean();
    expect(updated.timeSlot).toBe("16:00");
    expect(new Date(updated.date).toISOString().split("T")[0]).toBe(dateStr(3));
    // Sanity: the PARENT treatment appointment must be untouched.
    const parent = await Appointment.findById(parentTreatmentId).lean();
    expect(parent.timeSlot).toBe("14:30");
  });

  it("valid case: same-day reschedule works (confirms the pre-existing 'now is not defined' bug is fixed)", async () => {
    // A future slot later today -- rounded to the half hour, ~4 hours ahead
    // so the suite has headroom regardless of time of day it runs.
    const slotDate = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const futureSlot = `${String(slotDate.getHours()).padStart(2, "0")}:${
      slotDate.getMinutes() < 30 ? "00" : "30"
    }`;
    const todayStr = new Date().toISOString().split("T")[0];

    const res = await request(app)
      .post(`/api/appointments/${sessionApptId}/reschedule`)
      .set(authHeader(token))
      .send({ newDate: todayStr, newTimeSlot: futureSlot });

    // Before the fix this threw a ReferenceError (`now is not defined`),
    // surfaced as a 500. Must now succeed normally.
    expect(res.status).toBe(200);
    const updated = await Appointment.findById(sessionApptId).lean();
    expect(updated.timeSlot).toBe(futureSlot);
  });

  it("invalid case: rejects a reschedule beyond the 10-day backdate window", async () => {
    const tooFarPast = new Date();
    tooFarPast.setDate(tooFarPast.getDate() - 11);
    const tooFarPastStr = tooFarPast.toISOString().split("T")[0];

    const res = await request(app)
      .post(`/api/appointments/${sessionApptId}/reschedule`)
      .set(authHeader(token))
      .send({ newDate: tooFarPastStr, newTimeSlot: "10:00" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("invalid case: rejects a reschedule into a slot that is already at capacity", async () => {
    const fullDate = dateStr(5);
    const fullSlot = "11:00";
    const fillers = await Patient.create([
      { name: "Filler A", phone: "9111100005" },
      { name: "Filler B", phone: "9111100006" },
    ]);
    // Seed the 2 filler appointments directly (capacity = 2 for regular
    // bookings) rather than through the create endpoint -- this test is
    // about the reschedule capacity check, not appointment creation, and
    // sidesteps a separate pre-existing, unrelated flake in this app's
    // appointmentNumber generator when two bookings land in the same second.
    // Explicit, distinct appointmentNumbers -- sidesteps a separate,
    // pre-existing, unrelated flake where this app's appointmentNumber
    // pre-save hook (second-granularity) collides when two documents are
    // created within the same second.
    await Appointment.create(
      fillers.map((p, i) => ({
        appointmentNumber: `TEST-CAP-${i}`,
        patient: p._id,
        clinic: testData.clinic._id,
        date: new Date(fullDate),
        timeSlot: fullSlot,
        reason: "Filler booking",
        visitType: "opd",
        appointmentType: "regular",
        status: "scheduled",
        opdFee: 0,
        fee: 0,
      }))
    );

    const res = await request(app)
      .post(`/api/appointments/${sessionApptId}/reschedule`)
      .set(authHeader(token))
      .send({ newDate: fullDate, newTimeSlot: fullSlot });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);

    await Patient.deleteMany({ _id: { $in: fillers.map((p) => p._id) } });
  });
});
