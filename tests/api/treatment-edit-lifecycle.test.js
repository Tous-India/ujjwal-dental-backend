import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("Treatment click-navigation fix + Edit Treatment (active-lifecycle) capability", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): GET /api/appointments/:id (treatment appointment) resolves patient correctly -- previously fell through to the phone-lookup route and returned 'Patient not found'", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: 5000, amount: 5000, total: 5000 }],
      amountPaid: 0,
    });
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "treatment",
      treatmentName: "Root Canal",
      fee: 5000,
      invoice: invoice._id,
      reason: "Root canal",
    });

    // Before the fix, this exact request (GET /api/appointments/<ObjectId>)
    // would match router.get("/:phone", ...) (the only single-segment GET
    // route that existed) and call getAppointmentsByPhone, which does
    // Patient.findOne({ phone: <the ObjectId string> }), finds nothing, and
    // returns 404 "Patient not found".
    const res = await request(app)
      .get(`/api/appointments/${parent._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.message).not.toMatch(/Patient not found/i);
    expect(res.body.data.appointment._id).toBe(String(parent._id));
    expect(res.body.data.appointment.patient).toBeTruthy();
    expect(res.body.data.appointment.patient.name).toBe(testData.patient.name);
    expect(res.body.data.appointment.patient.phone).toBe(testData.patient.phone);

    // Regression check: a real phone-number lookup (10-digit string, not a
    // valid ObjectId) must still fall through to the phone route correctly.
    const phoneRes = await request(app)
      .get(`/api/appointments/${testData.patient.phone}`)
      .set(authHeader(token));
    expect(phoneRes.status).toBe(200);
    expect(Array.isArray(phoneRes.body.data.appointments)).toBe(true);

    await Appointment.deleteOne({ _id: parent._id });
    await Invoice.deleteOne({ _id: invoice._id });
  });

  it("T2 (HARD GATE): editing items/fee on a treatment with sessions delivered + real payment collected -- grandTotal updates, amountPaid untouched, balanceDue reconciles", async () => {
    // Original plan: Root Canal (4000) + Crown (3000) = 7000 subtotal, no
    // discount -> grandTotal 7000. Patient has already paid 4000 against it.
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        { itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: 4000, amount: 4000, total: 4000 },
        { itemType: "treatment", description: "Crown", quantity: 1, unitPrice: 3000, amount: 3000, total: 3000 },
      ],
      amountPaid: 4000,
    });
    expect(invoice.grandTotal).toBe(7000);
    expect(invoice.balanceDue).toBe(3000);

    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:00",
      visitType: "treatment",
      treatmentName: "Root Canal + Crown",
      fee: 7000,
      invoice: invoice._id,
      sessionsPlanned: 3,
      status: "in_progress",
      reason: "Root canal + crown",
    });
    // A session already delivered/booked against this treatment -- the whole
    // point of this capability is that editing must still be allowed here.
    const session = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:30",
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: 2,
      status: "completed",
      invoice: invoice._id,
      reason: "Session 2",
    });

    // Admin adds a new procedure (Filling, 1500) mid-treatment -- new
    // subtotal = 4000 + 3000 + 1500 = 8500, no discount -> grandTotal 8500.
    const res = await request(app)
      .patch(`/api/appointments/${parent._id}/treatment-items`)
      .set(authHeader(token))
      .send({
        treatmentName: "Root Canal + Crown + Filling",
        items: [
          { description: "Root Canal", unitPrice: 4000, itemType: "treatment" },
          { description: "Crown", unitPrice: 3000, itemType: "treatment" },
          { description: "Filling", unitPrice: 1500, itemType: "treatment" },
        ],
        discountPercent: 0,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.warning).toBeFalsy();

    const updatedInvoice = await Invoice.findById(invoice._id).lean();
    // BEFORE: grandTotal 7000, amountPaid 4000, balanceDue 3000
    // AFTER:  grandTotal 8500, amountPaid 4000 (unchanged), balanceDue 4500
    expect(updatedInvoice.grandTotal).toBe(8500);
    expect(updatedInvoice.amountPaid).toBe(4000); // NEVER altered by this edit
    expect(updatedInvoice.balanceDue).toBe(4500); // 8500 - 4000
    expect(updatedInvoice.items).toHaveLength(3);
    expect(updatedInvoice.paymentStatus).toBe("partial");

    const updatedParent = await Appointment.findById(parent._id).lean();
    expect(updatedParent.treatmentName).toBe("Root Canal + Crown + Filling");
    expect(updatedParent.fee).toBe(8500);

    // The already-delivered session is untouched.
    const sessionAfter = await Appointment.findById(session._id).lean();
    expect(sessionAfter.status).toBe("completed");

    await Appointment.deleteMany({ _id: { $in: [parent._id, session._id] } });
    await Invoice.deleteOne({ _id: invoice._id });
  });

  it("T3: edit is rejected with 400 once treatmentStatus is set (closed/completed)", async () => {
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
      timeSlot: "11:00",
      visitType: "treatment",
      treatmentName: "Filling",
      fee: 1000,
      invoice: invoice._id,
      status: "completed",
      treatmentStatus: "completed",
      treatmentClosedAt: new Date(),
      reason: "Filling",
    });

    const res = await request(app)
      .patch(`/api/appointments/${parent._id}/treatment-items`)
      .set(authHeader(token))
      .send({
        treatmentName: "Filling (edited)",
        items: [{ description: "Filling", unitPrice: 1500, itemType: "treatment" }],
        discountPercent: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/closed/i);

    // Nothing changed.
    const unchangedInvoice = await Invoice.findById(invoice._id).lean();
    expect(unchangedInvoice.grandTotal).toBe(1000);
    expect(unchangedInvoice.amountPaid).toBe(1000);
    const unchangedParent = await Appointment.findById(parent._id).lean();
    expect(unchangedParent.treatmentName).toBe("Filling");

    await Appointment.deleteOne({ _id: parent._id });
    await Invoice.deleteOne({ _id: invoice._id });
  });

  it("T4: new grandTotal lower than amountPaid already collected -- save succeeds, amountPaid untouched, response carries a warning", async () => {
    // Original: Root Canal (5000) + Surgery (4000) = 9000 subtotal, no
    // discount -> grandTotal 9000. Patient already paid 8000 (most of it).
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        { itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: 5000, amount: 5000, total: 5000 },
        { itemType: "surgery", description: "Surgery", quantity: 1, unitPrice: 4000, amount: 4000, total: 4000 },
      ],
      amountPaid: 8000,
    });
    expect(invoice.grandTotal).toBe(9000);

    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "12:00",
      visitType: "treatment",
      treatmentName: "Root Canal + Surgery",
      fee: 9000,
      invoice: invoice._id,
      status: "in_progress",
      reason: "Root canal + surgery",
    });

    // Admin removes the Surgery procedure entirely -- new subtotal = 5000,
    // grandTotal 5000, which is LOWER than the 8000 already collected.
    const res = await request(app)
      .patch(`/api/appointments/${parent._id}/treatment-items`)
      .set(authHeader(token))
      .send({
        treatmentName: "Root Canal",
        items: [{ description: "Root Canal", unitPrice: 5000, itemType: "treatment" }],
        discountPercent: 0,
      });

    // Not blocked, not crashed.
    expect(res.status).toBe(200);
    expect(res.body.data.warning).toMatch(/less than the amount already collected/i);

    const updatedInvoice = await Invoice.findById(invoice._id).lean();
    // BEFORE: grandTotal 9000, amountPaid 8000
    // AFTER:  grandTotal 5000, amountPaid 8000 (unchanged), balanceDue floored at 0
    expect(updatedInvoice.grandTotal).toBe(5000);
    expect(updatedInvoice.amountPaid).toBe(8000); // NEVER altered
    expect(updatedInvoice.balanceDue).toBe(0); // max(0, 5000 - 8000)
    expect(updatedInvoice.paymentStatus).toBe("paid"); // amountPaid >= grandTotal

    await Appointment.deleteOne({ _id: parent._id });
    await Invoice.deleteOne({ _id: invoice._id });
  });
});
