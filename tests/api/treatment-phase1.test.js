import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("Treatment Phase 1: no more auto-complete, Reopen Treatment, editable sessionsPlanned, OPD-link field", () => {
  let token;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString();

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): booking session 2/2 + collecting full balance no longer auto-completes the treatment", async () => {
    // originatingOpdAppointmentId is now mandatory for new treatment bookings (Bug 2 fix).
    const t1Opd = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "08:00",
      visitType: "opd",
      fee: 300,
      reason: "Initial consult",
    });
    const parentRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "09:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Root canal",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal",
        fee: 5000,
        sessionsPlanned: 2,
        originatingOpdAppointmentId: String(t1Opd._id),
      });
    expect(parentRes.status).toBe(201);
    const parentId = parentRes.body.data.appointmentId;

    const sessionRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "09:30",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Root canal session 2",
        visitType: "treatment_session",
        parentAppointment: parentId,
      });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.appointmentId;

    // Collect the full outstanding balance via the admin payment path (the
    // other former trigger point for auto-complete).
    const payRes = await request(app)
      .post("/api/payments/admin/record-payment")
      .set(authHeader(token))
      .send({ patientId: testData.patient._id, amount: 5000, mode: "cash" });
    expect(payRes.status).toBe(200);

    const parentAfter = await Appointment.findById(parentId).lean();
    expect(parentAfter.treatmentStatus).toBeFalsy(); // stays null/unset -- no auto-complete
    expect(parentAfter.treatmentClosedAt).toBeFalsy();

    await Appointment.deleteMany({ _id: { $in: [parentId, sessionId, t1Opd._id] } });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("T2: manually closing a treatment via Close Treatment Plan logs a 'closed' treatmentHistory entry", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Filling", quantity: 1, unitPrice: 1000, amount: 1000, total: 1000 }],
      amountPaid: 1000,
    });
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:00",
      visitType: "treatment",
      treatmentName: "Filling",
      fee: 1000,
      invoice: invoice._id,
      status: "in_progress",
      reason: "Filling",
    });

    const res = await request(app)
      .post(`/api/appointments/${parent._id}/close-treatment`)
      .set(authHeader(token))
      .send({ resolution: "completed", reason: "All sessions done" });
    expect(res.status).toBe(200);

    const updated = await Appointment.findById(parent._id).lean();
    expect(updated.treatmentStatus).toBe("completed");
    expect(updated.treatmentHistory).toHaveLength(1);
    expect(updated.treatmentHistory[0].action).toBe("closed");
    expect(updated.treatmentHistory[0].resolution).toBe("completed");
    expect(updated.treatmentHistory[0].reason).toBe("All sessions done");

    // Stash for T3
    global.__t3ParentId = String(parent._id);
    global.__t3InvoiceId = String(invoice._id);
  });

  it("T3 (HARD GATE): reopening that same treatment clears status/closedAt and preserves BOTH history entries", async () => {
    const parentId = global.__t3ParentId;

    const res = await request(app)
      .post(`/api/appointments/${parentId}/reopen-treatment`)
      .set(authHeader(token))
      .send({ reason: "Patient needs an additional session" });
    expect(res.status).toBe(200);

    const updated = await Appointment.findById(parentId).lean();
    expect(updated.treatmentStatus).toBeFalsy();
    expect(updated.treatmentClosedAt).toBeFalsy();
    expect(updated.treatmentHistory).toHaveLength(2);
    expect(updated.treatmentHistory[0].action).toBe("closed"); // original entry preserved
    expect(updated.treatmentHistory[1].action).toBe("reopened");
    expect(updated.treatmentHistory[1].reason).toBe("Patient needs an additional session");

    await Appointment.deleteOne({ _id: parentId });
    await Invoice.deleteOne({ _id: global.__t3InvoiceId });
  });

  it("T4: reopen without a reason is rejected with a validation error", async () => {
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "11:00",
      visitType: "treatment",
      treatmentName: "Crown",
      fee: 3000,
      status: "completed",
      treatmentStatus: "completed",
      treatmentClosedAt: new Date(),
      reason: "Crown",
    });

    const res = await request(app)
      .post(`/api/appointments/${parent._id}/reopen-treatment`)
      .set(authHeader(token))
      .send({});
    expect(res.status).toBe(400);

    const unchanged = await Appointment.findById(parent._id).lean();
    expect(unchanged.treatmentStatus).toBe("completed"); // untouched

    await Appointment.deleteOne({ _id: parent._id });
  });

  it("T5: sessionsPlanned is editable (5 -> 8), but rejected below sessionsBooked", async () => {
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "12:00",
      visitType: "treatment",
      treatmentName: "Braces",
      fee: 20000,
      sessionsPlanned: 5,
      reason: "Braces",
    });
    // 2 already-booked sessions + the parent itself = 3 sessionsBooked
    const s1 = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "12:30",
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: 2,
      reason: "Session 2",
    });

    const upRes = await request(app)
      .patch(`/api/appointments/${parent._id}`)
      .set(authHeader(token))
      .send({ sessionsPlanned: 8 });
    expect(upRes.status).toBe(200);
    let updated = await Appointment.findById(parent._id).lean();
    expect(updated.sessionsPlanned).toBe(8);

    const belowRes = await request(app)
      .patch(`/api/appointments/${parent._id}`)
      .set(authHeader(token))
      .send({ sessionsPlanned: 1 }); // below sessionsBooked (2)
    expect(belowRes.status).toBe(400);
    updated = await Appointment.findById(parent._id).lean();
    expect(updated.sessionsPlanned).toBe(8); // unchanged, not silently clamped

    await Appointment.deleteMany({ _id: { $in: [parent._id, s1._id] } });
  });

  it("T6: originatingOpdAppointmentId is stored when provided (valid, same patient, real OPD visit)", async () => {
    // As of the Bug 2 fix (tests/api/treatment-opd-link-required.test.js),
    // this field is mandatory for new treatment bookings -- the "stays null
    // when omitted at create-time" case moved there. This test now covers
    // just the storage/validation half of Phase 1's original field.
    const opdAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "13:00",
      visitType: "opd",
      fee: 300,
      reason: "Initial consult",
    });

    const withLinkRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "13:30",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Follow-up treatment",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal",
        fee: 5000,
        originatingOpdAppointmentId: String(opdAppt._id),
      });
    expect(withLinkRes.status).toBe(201);
    const withLinkId = withLinkRes.body.data.appointmentId;
    const withLinkSaved = await Appointment.findById(withLinkId).lean();
    expect(String(withLinkSaved.originatingOpdAppointment)).toBe(String(opdAppt._id));

    await Appointment.deleteMany({ _id: { $in: [opdAppt._id, withLinkId] } });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });
});
