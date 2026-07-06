import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { notify } from "../../utils/notifyHelper.js";
import { nextDailyToken, istDateKey } from "./appointmentToken.js";
import Appointment from "./appointment.model.js";
import Patient from "../patients/patient.model.js";
import Payment from "../payments/payment.model.js";
import SystemSettings from "../settings/settings.model.js";
import { TreatmentMaster } from "../treatments/treatment.model.js";
import { generateInvoice } from "../billing/invoice.service.js";
import Invoice from "../billing/invoice.model.js";
import mongoose from "mongoose";
import { sendEmail } from "../../utils/email.js";
import dispatchBookingNotifications from "../../utils/dispatchBookingNotifications.js";

/**
 * APPOINTMENT CONTROLLER
 * Handles appointment booking and management
 */

// Base seats per 30-minute slot (per clinic, per date). Emergency bookings get
// one extra seat on top, so an emergency patient can take the 3rd seat in a slot
// that already has 2 regular bookings. Change these to adjust capacity later.
const SLOT_BASE_CAPACITY = 2;
const EMERGENCY_EXTRA = 1;

/**
 * Effective seats for a slot given the incoming booking type:
 *  - "emergency" → SLOT_BASE_CAPACITY + EMERGENCY_EXTRA (e.g. 3)
 *  - anything else → SLOT_BASE_CAPACITY (e.g. 2)
 */
const slotCapacityFor = (bookingType) =>
  SLOT_BASE_CAPACITY + (bookingType === "emergency" ? EMERGENCY_EXTRA : 0);

/**
 * Validate an appointment's date/timeSlot against the booking rules:
 *  - the date must not be in the past
 *  - if the date is today, the slot must not have already passed
 *  - the slot must have fewer than the effective capacity of active
 *    (non-cancelled) bookings. Capacity is 2 for regular, 3 for emergency.
 *
 * Returns `{ status, message }` when invalid, or `null` when the slot is OK.
 */
const validateAppointmentSlot = async ({ clinic, date, timeSlot, bookingType }) => {
  const requestedDate = new Date(date);
  if (isNaN(requestedDate.getTime())) {
    return { status: 400, message: "Invalid date format" };
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const dayStart = new Date(requestedDate);
  dayStart.setHours(0, 0, 0, 0);

  // 1) No past dates
  if (dayStart < todayStart) {
    return { status: 400, message: "Cannot book an appointment in the past" };
  }

  // 2) No past time slots when booking for today
  const isToday = dayStart.getTime() === todayStart.getTime();
  if (isToday && timeSlot) {
    const [h, m] = String(timeSlot).split(":").map(Number);
    const slotMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (slotMinutes <= nowMinutes) {
      return { status: 400, message: "This time slot has already passed" };
    }
  }

  // 3) Slot capacity — at most `capacity` active bookings per slot (2 regular,
  //    3 when this incoming booking is an emergency).
  const capacity = slotCapacityFor(bookingType);
  const dayEnd = new Date(requestedDate);
  dayEnd.setHours(23, 59, 59, 999);
  const slotCount = await Appointment.countDocuments({
    clinic,
    date: { $gte: dayStart, $lte: dayEnd },
    timeSlot,
    status: { $ne: "cancelled" },
  });
  if (slotCount >= capacity) {
    return {
      status: 409,
      message:
        bookingType === "emergency"
          ? "This time slot is fully booked (no emergency seat left)"
          : "This time slot is fully booked",
    };
  }

  return null;
};

/**
 * @desc    Get all appointments
 * @route   GET /api/appointments?date=&clinic=&status=
 * @access  Admin
 */
export const getAllAppointments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, date, clinic, status, appointmentType, visitType, search } = req.query;

  // 1. Build filter query from params
  const filter = {};

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    filter.clinic = clinic;
  }

  if (status) {
    filter.status = status;
  }

  if (appointmentType) {
    filter.appointmentType = appointmentType;
  }

  if (visitType) {
    filter.visitType = visitType;
  }

  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    filter.date = { $gte: start, $lte: end };
  }

  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matchingPatients = await Patient.find({
      $or: [{ name: searchRegex }, { phone: searchRegex }],
    }).select("_id").lean();
    if (matchingPatients.length === 0) {
      return ApiResponse.paginated(res, [], { page: Number(page), limit: Number(limit), total: 0, totalPages: 0 }, "Appointments fetched");
    }
    filter.patient = { $in: matchingPatients.map((p) => p._id) };
  }

  // 2. Query appointments with pagination
  const skip = (Number(page) - 1) * Number(limit);

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .populate("patient", "name phone")
      .populate("clinic", "name code")
      .populate("treatmentId", "name")
      .populate("invoice", "invoiceNumber grandTotal amountPaid balanceDue paymentStatus")
      .sort({ date: -1, timeSlot: 1 })
      .skip(skip)
      .limit(Number(limit)),
    Appointment.countDocuments(filter),
  ]);

  // 3. Pagination info
  const pagination = {
    page: Number(page),
    limit: Number(limit),
    total,
    totalPages: Math.ceil(total / limit),
  };

  // 4. Return paginated list
  ApiResponse.paginated(res, appointments, pagination, "Appointments fetched");
});

/**
 * @desc    Get today's appointments
 * @route   GET /api/appointments/today?clinic=
 * @access  Admin
 */
export const getTodayAppointments = asyncHandler(async (req, res) => {
  // 1️⃣ Get current date
  const today = new Date();

  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  // 2️⃣ Query appointments for today (FIXED FIELD)
  const appointments = await Appointment.find({
    date: { $gte: startOfDay, $lte: endOfDay }, // ✅ FIX HERE
    status: { $ne: "cancelled" },
  })
    // 3️⃣ Sort by time slot / token
    .sort({ tokenNumber: 1 })
    .populate("patient", "name phone")
    .populate("clinic", "name");

  // 4️⃣ Return list
  ApiResponse.success(res, appointments, "Today's appointments fetched");
});

/**
 * @desc    Get upcoming appointments
 * @route   GET /api/appointments/upcoming
 * @access  Admin
 */
export const getUpcomingAppointments = asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;

  // 1. Get date range (today + days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const futureDate = new Date();
  futureDate.setDate(today.getDate() + Number(days));
  futureDate.setHours(23, 59, 59, 999);

  // 2. Query appointments in range
  const appointments = await Appointment.find({
    date: { $gte: today, $lte: futureDate },
    status: "scheduled",
  })
    .populate("patient", "name phone")
    .populate("clinic", "name")
    .sort({ date: 1, timeSlot: 1 });

  // 3. Return list
  ApiResponse.success(res, appointments, "Upcoming appointments fetched");
});

/**
 * @desc    Get available slots
 * @route   GET /api/appointments/available-slots?clinic=&date=
 * @access  Public
 */
export const getAvailableSlots = asyncHandler(async (req, res) => {
  const { clinic: clinicId, date, bookingType } = req.query;
  // Effective capacity for THIS request: 3 when the patient is booking an
  // emergency (an emergency may take the 3rd seat), else 2. Defaulting to
  // regular keeps existing callers (e.g. admin) on the base capacity.
  const capacity = slotCapacityFor(bookingType);

  if (!clinicId || !date) {
    return ApiResponse.error(res, "Clinic and date are required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(clinicId)) {
    return ApiResponse.error(res, "Invalid clinic ID", 400);
  }

  const requestedDate = new Date(date);
  if (isNaN(requestedDate.getTime())) {
    return ApiResponse.error(res, "Invalid date format", 400);
  }

  // Default clinic hours: 9 AM to 7 PM, 30-min slots
  const SLOT_START_HOUR = 9;
  const SLOT_END_HOUR = 19;
  const SLOT_DURATION_MIN = 30;

  // Generate all possible slots
  const allSlots = [];
  for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_DURATION_MIN) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      allSlots.push(`${hh}:${mm}`);
    }
  }

  // Get booked slots for this date
  const startOfDay = new Date(requestedDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(requestedDate);
  endOfDay.setHours(23, 59, 59, 999);

  const bookedAppointments = await Appointment.find({
    clinic: clinicId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $nin: ["cancelled"] },
  }).select("timeSlot");

  // Count active bookings per slot; a slot is "booked" once it hits capacity.
  const slotCounts = {};
  for (const apt of bookedAppointments) {
    slotCounts[apt.timeSlot] = (slotCounts[apt.timeSlot] || 0) + 1;
  }
  const bookedSlots = Object.keys(slotCounts).filter(
    (slot) => slotCounts[slot] >= capacity
  );

  // A slot is available only if it has not reached the effective capacity.
  let availableSlots = allSlots.filter(
    (slot) => (slotCounts[slot] || 0) < capacity
  );

  // Past dates have no available slots at all.
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (startOfDay < todayStart) {
    availableSlots = [];
  } else if (requestedDate.toDateString() === now.toDateString()) {
    // Today: drop slots that have already passed.
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    availableSlots = availableSlots.filter((slot) => {
      const [h, m] = slot.split(":").map(Number);
      return h * 60 + m > currentMinutes;
    });
  }

  ApiResponse.success(
    res,
    {
      date: requestedDate.toISOString().split("T")[0],
      clinic: clinicId,
      bookingType: bookingType === "emergency" ? "emergency" : "regular",
      capacity,
      totalSlots: allSlots.length,
      bookedSlots: bookedSlots.length,
      availableSlots,
    },
    "Available slots fetched successfully"
  );
});

/**
 * @desc    Get appointment by ID
 * @route   GET /api/appointments/:id
 * @access  Admin
 */
/**
 * @desc    Get appointment by ID
 * @route   GET /api/appointments/:id
 * @access  Admin
 */
/**
 * @desc    Get appointment by ID
 * @route   GET /api/appointments/:id
 * @access  Admin
 */
export const getAppointmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const appointment = await Appointment.findById(id)
    .populate("patient", "name phone email hasMembership currentDiscount")
    .populate("clinic", "name code address")
    .populate("createdBy", "name");

  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  // Find payment linked to this appointment
  const payment = await Payment.findOne({ appointment: id })
    .select("paymentNumber amount paymentMode status paidAt razorpayPaymentId");

  const appointmentData = appointment.toObject();
  appointmentData.payment = payment || null;

  ApiResponse.success(res, { appointment: appointmentData }, "Appointment fetched successfully");
});

/**
 * @desc    Get appointments by phone number
 * @route   GET /api/appointments/phone/:phone
 * @access  Admin
 */
export const getAppointmentsByPhone = asyncHandler(async (req, res) => {
  const { phone } = req.params;

  // 1. Find patient by phone
  const patient = await Patient.findOne({ phone });

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // 2. Find appointments for this patient
  const appointments = await Appointment.find({ patient: patient._id })
    .populate("patient", "name phone")
    .populate("clinic", "name code")
    .populate("createdBy", "name")
    .populate("treatmentId", "name")
    .populate("invoice", "invoiceNumber grandTotal amountPaid balanceDue paymentStatus")
    .sort({ date: -1 });

  ApiResponse.success(res, { appointments: appointments || [] }, appointments.length ? "Appointments fetched successfully" : "No appointments yet");
});

/**
 * @desc    Create new appointment (book)
 * @route   POST /api/appointments
 * @access  Admin / Patient
 */

export const createAppointment = asyncHandler(async (req, res) => {
  const {
    patientId, name, phone, clinic, date, timeSlot, reason, type,
    isFree, opdFee: requestOpdFee, opdFeePaid, source, notes,
    visitType, treatmentId, treatmentName, fee, feeNotes, appointmentType, bookingType,
    paymentMethod: incomingPaymentMethod,
    parentAppointment, sessionNumber, sessionsPlanned,
    amountPaid: requestAmountPaid,
  } = req.body;

  // Urgency: accept `bookingType` (preferred) or legacy `appointmentType`.
  // Drives the emergency OPD fee AND the slot capacity (2 regular / 3 emergency).
  const urgency = bookingType || appointmentType || "regular";
  if (!["regular", "emergency"].includes(urgency)) {
    return ApiResponse.error(res, "bookingType must be 'regular' or 'emergency'", 400);
  }
  const isEmergency = urgency === "emergency";

  /* =======================
     BASIC VALIDATIONS
  ======================== */

  if (!clinic || !date || !timeSlot || !phone) {
    return ApiResponse.error(
      res,
      "Clinic, date and time slot are required",
      400,
    );
  }

  if (!reason) {
    return ApiResponse.error(res, "Reason for visit is required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(clinic)) {
    return ApiResponse.error(res, "Invalid clinic ID", 400);
  }

  /* =======================
     PATIENT HANDLING
  ======================== */

  let patient;

  // Case 1: Existing patient
  if (patientId) {
    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return ApiResponse.error(res, "Invalid patient ID", 400);
    }

    patient = await Patient.findById(patientId);
    if (!patient) {
      return ApiResponse.error(res, "Patient not found", 404);
    }
  }

  // Case 2: New patient
  if (!patientId) {
    if (!name || !phone) {
      return ApiResponse.error(
        res,
        "Name and phone are required for new patient",
        400,
      );
    }

    patient = await Patient.findOne({ phone });

    if (!patient) {
      patient = await Patient.create({
        name,
        phone,
        registeredBy: req.user?._id,
      });
    }
  }

  /* =======================
     SLOT AVAILABILITY CHECK
     (past date, past time, capacity)
  ======================== */

  const slotError = await validateAppointmentSlot({ clinic, date, timeSlot, bookingType: urgency });
  if (slotError) {
    return ApiResponse.error(res, slotError.message, slotError.status);
  }

  /* =======================
     TREATMENT SESSION BRANCH
     (early return — no fee, no new invoice)
  ======================== */

  if (visitType === "treatment_session") {
    if (!parentAppointment) {
      return ApiResponse.error(res, "parentAppointment is required for treatment session bookings", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(parentAppointment)) {
      return ApiResponse.error(res, "Invalid parentAppointment ID", 400);
    }

    const parent = await Appointment.findById(parentAppointment).lean();
    if (!parent) {
      return ApiResponse.error(res, "Parent appointment not found", 404);
    }
    if (parent.visitType !== "treatment") {
      return ApiResponse.error(res, "Parent appointment must be a treatment appointment (visitType='treatment')", 400);
    }
    if (parent.patient.toString() !== patient._id.toString()) {
      return ApiResponse.error(res, "Session patient must match parent appointment patient", 400);
    }

    // Auto-calc sessionNumber using MAX of existing sessions + 1.
    // Parent appointment is implicitly Session 1, so first child = 2.
    let finalSessionNumber = sessionNumber ? Number(sessionNumber) : null;
    if (!finalSessionNumber) {
      const lastSession = await Appointment.findOne({
        parentAppointment: parent._id,
        status: { $ne: "cancelled" },
      })
        .sort({ sessionNumber: -1 })
        .select("sessionNumber")
        .lean();
      finalSessionNumber = (lastSession?.sessionNumber || 1) + 1;
    }

    const sessionAppt = await Appointment.create({
      patient: parent.patient,
      clinic: parent.clinic,
      date,
      timeSlot,
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: finalSessionNumber,
      treatmentName: parent.treatmentName || "",
      fee: 0,
      opdFee: 0,
      isFree: true,
      opdFeePaid: false,
      paymentStatus: "free",
      paymentMethod: "free",
      invoice: parent.invoice || null,
      status: "scheduled",
      notes,
      reason: reason || `Session ${finalSessionNumber}: ${parent.treatmentName || "Treatment"}`,
      source: source || "walk_in",
      type: type || "regular",
      appointmentType: isEmergency ? "emergency" : "regular",
      createdBy: req.user?._id,
    });

    dispatchBookingNotifications(sessionAppt._id);

    const populated = await Appointment.findById(sessionAppt._id)
      .populate("patient", "name phone email")
      .populate("clinic", "name")
      .populate("parentAppointment", "treatmentName date")
      .populate("invoice", "invoiceNumber grandTotal amountPaid balanceDue paymentStatus")
      .lean();

    return ApiResponse.created(res, populated, "Treatment session appointment created");
  }

  /* =======================
     OPD FEE CALCULATION
  ======================== */

  let appointmentIsFree = isFree || false;
  let appointmentOpdFeePaid = opdFeePaid || false;

  // Visit type: "treatment" shows treatment fee; otherwise OPD/consultation.
  const appointmentVisitType = visitType === "treatment" ? "treatment" : "opd";

  let resolvedFee; // base fee stored on the appointment (pre membership discount)
  let lineItemType; // invoice line-item category
  let lineItemDescription;
  let treatmentDoc = null;

  // "Other" = one-off custom treatment: store a name string + manual fee, no
  // Treatment Master lookup. The frontend sends treatmentId === "other".
  const isCustomTreatment = appointmentVisitType === "treatment" && treatmentId === "other";
  const customTreatmentName = (treatmentName || "").trim();
  if (isCustomTreatment && !customTreatmentName) {
    return ApiResponse.error(res, "A treatment name is required for a custom treatment", 400);
  }

  if (appointmentIsFree) {
    // Free appointment — no fee, no invoice, marked paid
    resolvedFee = 0;
    appointmentOpdFeePaid = true;
    lineItemType = appointmentVisitType === "treatment" ? "treatment" : "opd_fee";
    lineItemDescription =
      appointmentVisitType === "treatment"
        ? isCustomTreatment
          ? customTreatmentName
          : "Treatment"
        : "OPD Consultation";
  } else if (appointmentVisitType === "treatment") {
    if (isCustomTreatment) {
      // Custom treatment — fee is entered manually (no preset price).
      resolvedFee =
        fee !== undefined && fee !== null && fee !== "" ? Number(fee) : 0;
      if (!resolvedFee || resolvedFee <= 0) {
        return ApiResponse.error(res, "A valid treatment fee is required", 400);
      }
      lineItemType = "treatment";
      lineItemDescription = customTreatmentName;
    } else {
      // Treatment visit — fee from the treatment price, admin-editable override
      if (!treatmentId || !mongoose.Types.ObjectId.isValid(treatmentId)) {
        return ApiResponse.error(res, "A treatment is required for a treatment visit", 400);
      }
      treatmentDoc = await TreatmentMaster.findById(treatmentId);
      if (!treatmentDoc) {
        return ApiResponse.error(res, "Treatment not found", 404);
      }
      resolvedFee =
        fee !== undefined && fee !== null && fee !== ""
          ? Number(fee)
          : Number(treatmentDoc.price) || 0;
      if (!resolvedFee || resolvedFee <= 0) {
        return ApiResponse.error(res, "A valid treatment fee is required", 400);
      }
      lineItemType = "treatment";
      lineItemDescription = treatmentDoc.name;
    }
  } else {
    // OPD / consultation — fee from admin override or settings (regular/emergency)
    if (requestOpdFee !== undefined && requestOpdFee !== null && requestOpdFee !== "") {
      resolvedFee = Number(requestOpdFee);
    } else {
      const settings = await SystemSettings.getSettings();
      const feeSettings = settings.feeSettings || { opdFeeRegular: 300, opdFeeEmergency: 500 };
      resolvedFee = isEmergency ? feeSettings.opdFeeEmergency : feeSettings.opdFeeRegular;
    }
    lineItemType = "opd_fee";
    lineItemDescription = "OPD Consultation";
  }

  // Server-side guard: cannot claim payment collected if there is no fee
  if (appointmentOpdFeePaid && !appointmentIsFree && resolvedFee <= 0) {
    return ApiResponse.error(res, "Cannot mark payment as collected for a zero-fee appointment", 400);
  }

  /* =======================
     CREATE APPOINTMENT
     (NO status, NO tokenNumber)
     → schema handles them
  ======================== */

  const appointment = await Appointment.create({
    patient: patient._id,
    clinic,
    date,
    timeSlot,
    reason,
    type,
    appointmentType: isEmergency ? "emergency" : "regular",
    visitType: appointmentVisitType,
    // Normal treatment → store the catalog ref; custom "Other" → store the name
    // string only (never cast the "other" sentinel into the ObjectId field).
    ...(appointmentVisitType === "treatment"
      ? isCustomTreatment
        ? { treatmentName: customTreatmentName }
        : { treatmentId }
      : {}),
    ...(appointmentVisitType === "treatment" && sessionsPlanned
      ? { sessionsPlanned: Number(sessionsPlanned) }
      : {}),
    fee: resolvedFee,
    feeNotes: feeNotes || undefined,
    // opdFee kept in sync for backward-compatibility with existing views
    opdFee: resolvedFee,
    isFree: appointmentIsFree,
    opdFeePaid: appointmentOpdFeePaid,
    paymentMethod: appointmentIsFree ? "free" : (incomingPaymentMethod === "online" ? "online" : "cash"),
    paymentStatus: appointmentIsFree ? "free" : (appointmentOpdFeePaid ? "paid" : "unpaid"),
    source: source || "walk_in",
    notes,
    createdBy: req.user?._id,
    // ❌ DO NOT set status
    // ❌ DO NOT set tokenNumber
  });

  /* =======================
     AUTO-INVOICE (pay at clinic, unpaid)
     Skipped for free appointments. Membership discount, if any, is applied
     server-side inside generateInvoice.
  ======================== */

  let invoiceId = null;
  if (!appointmentIsFree && resolvedFee > 0) {
    try {
      const invoice = await generateInvoice({
        patient, // pass the loaded doc (has hasMembership/currentDiscount virtuals)
        clinic,
        appointment: appointment._id,
        items: [
          {
            itemType: lineItemType,
            description: lineItemDescription,
            unitPrice: resolvedFee,
          },
        ],
        amountPaid: 0,
        paymentMethod: appointmentOpdFeePaid
          ? (incomingPaymentMethod === "online" ? "online" : "cash")
          : "pay-at-clinic",
        createdBy: req.user?._id,
      });
      invoiceId = invoice._id;
      appointment.invoice = invoice._id;
      await appointment.save();

      if (appointmentOpdFeePaid) {
        try {
          await Payment.create({
            patient: patient._id ?? patient,
            clinic,
            appointment: appointment._id,
            invoice: invoice._id,
            type: appointmentVisitType === "treatment" ? "treatment" : "opd_fee",
            amount: requestAmountPaid ?? resolvedFee,
            paymentMode: ["cash", "card", "upi"].includes(incomingPaymentMethod)
              ? incomingPaymentMethod
              : "cash",
            status: "paid",
            receivedBy: req.user?._id,
            notes: appointmentVisitType === "treatment"
              ? `Treatment payment collected at booking — ${lineItemDescription}`
              : "OPD fee collected at admin walk-in booking",
          });
        } catch (payErr) {
          // Log but do NOT fail the booking — the invoice already reflects the collection
          console.error("[createAppointment] Failed to create Payment doc for OPD fee:", payErr?.message);
        }
      }
    } catch (err) {
      // Don't fail the booking if invoice generation hiccups; log for follow-up.
      console.error("Auto-invoice for appointment failed:", err.message);
    }
  }

  /* =======================
     RESPONSE
  ======================== */

  dispatchBookingNotifications(appointment._id);

  return ApiResponse.created(
    res,
    {
      appointmentId: appointment._id,
      appointmentNumber: appointment.appointmentNumber,
      tokenNumber: appointment.tokenNumber,
      status: appointment.status,
      visitType: appointment.visitType,
      appointmentType: appointment.appointmentType,
      fee: appointment.fee,
      opdFee: appointment.opdFee,
      isFree: appointment.isFree,
      opdFeePaid: appointment.opdFeePaid,
      invoiceId,
      patient: {
        id: patient._id,
        name: patient.name,
        phone: patient.phone,
      },
    },
    "Appointment created successfully",
  );
});

/**
 * @desc    Book appointment after payment verification
 * @route   POST /api/appointments/book-with-payment
 * @access  Public
 */
export const bookAppointmentWithPayment = asyncHandler(async (req, res) => {
  const {
    paymentId,
    name,
    phone,
    email,
    clinic,
    date,
    timeSlot,
    reason,
    type,
    appointmentType,
    bookingType,
    captchaToken,
  } = req.body;

  // Urgency: accept `bookingType` (preferred) or legacy `appointmentType`.
  // Drives the stored appointmentType and the slot capacity (2 regular / 3 emergency).
  const urgency = bookingType || appointmentType || "regular";
  if (!["regular", "emergency"].includes(urgency)) {
    return ApiResponse.error(res, "bookingType must be 'regular' or 'emergency'", 400);
  }

  /* =======================
     VERIFY reCAPTCHA
  ======================== */

  // reCAPTCHA was already validated in step 2 (patient details).
  // Skip here since token may expire during Razorpay checkout.
  if (process.env.RECAPTCHA_SECRET_KEY && captchaToken) {
    try {
      const captchaRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${captchaToken}`,
      });
      const captchaData = await captchaRes.json();
      if (!captchaData.success) {
        console.log("[reCAPTCHA] Token expired/invalid in booking step, skipping (was validated earlier)");
      }
    } catch (err) {
      console.error("[reCAPTCHA] Verification error:", err.message);
    }
  }

  /* =======================
     VALIDATE PAYMENT
  ======================== */

  if (!paymentId) {
    return ApiResponse.error(res, "Payment ID is required", 400);
  }

  const payment = await Payment.findById(paymentId);

  if (!payment) {
    console.log(`[BookWithPayment] Payment not found: ${paymentId}`);
    return ApiResponse.error(res, "Payment not found", 404);
  }

  console.log(`[BookWithPayment] Payment ${paymentId} status: ${payment.status}`);

  if (payment.status !== "paid") {
    return ApiResponse.error(res, `Payment not completed. Current status: ${payment.status}. Please try again.`, 400);
  }

  // Check if payment is already used for an appointment
  if (payment.appointment) {
    return ApiResponse.error(res, "Payment already used for an appointment", 400);
  }

  /* =======================
     BASIC VALIDATIONS
  ======================== */

  if (!clinic || !date || !timeSlot || !phone) {
    return ApiResponse.error(res, "Clinic, date, time slot and phone are required", 400);
  }

  if (!reason) {
    return ApiResponse.error(res, "Reason for visit is required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(clinic)) {
    return ApiResponse.error(res, "Invalid clinic ID", 400);
  }

  /* =======================
     PATIENT HANDLING
  ======================== */

  // Try to find patient by phone or email
  let patient = await Patient.findOne({ phone });
  if (!patient && email) {
    patient = await Patient.findOne({ email: email.toLowerCase() });
  }

  let isNewPatient = false;
  if (!patient) {
    if (!name) {
      return ApiResponse.error(res, "Name is required for new patient", 400);
    }

    // No password is set here — new patients log in passwordless via email OTP.
    // (Doctor-set passwords remain supported separately via login-password.)
    patient = await Patient.create({
      name,
      phone,
      email: email?.toLowerCase() || undefined,
    });
    isNewPatient = true;

    // Send a welcome email that directs the patient to passwordless OTP login.
    if (email) {
      const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/login`;
      sendEmail({
        to: email,
        subject: "Welcome to Ujjwal Dental Clinic - Access Your Portal",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
            <p>Hello ${name},</p>
            <p>Welcome! Your patient portal account has been created.</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 4px 0;">To log in, open the <a href="${loginUrl}">Patient Portal</a> and choose <strong>"Login with OTP"</strong>.</p>
              <p style="margin: 4px 0;">Enter this email (<strong>${email}</strong>) and we'll send you a one-time code — no password needed.</p>
            </div>
            <p>You can view your appointments, payments, and reports there.</p>
            <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
            <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Patient Portal</p>
          </div>
        `,
        text: `Hello ${name}, your patient portal account has been created. To log in, go to ${loginUrl}, choose "Login with OTP", and enter ${email} to receive a one-time code (no password needed).`,
      }).catch((err) => console.error("[Appointment] Failed to send welcome email:", err));
    }
  } else if (email && !patient.email) {
    // Update existing patient with email if they didn't have one
    patient.email = email.toLowerCase();
    await patient.save();
  }

  /* =======================
     SLOT AVAILABILITY CHECK
  ======================== */

  const slotError = await validateAppointmentSlot({ clinic, date, timeSlot, bookingType: urgency });
  if (slotError) {
    return ApiResponse.error(res, slotError.message, slotError.status);
  }

  /* =======================
     CREATE APPOINTMENT (PAID)
  ======================== */

  const appointment = await Appointment.create({
    patient: patient._id,
    clinic,
    date,
    timeSlot,
    reason,
    type: type || "regular",
    appointmentType: urgency,
    opdFee: payment.amount,
    opdFeePaid: true,
    paymentMethod: "online",
    paymentStatus: "paid",
    source: "online",
  });

  /* =======================
     LINK PAYMENT TO APPOINTMENT
  ======================== */

  payment.appointment = appointment._id;
  payment.patient = patient._id;
  await payment.save();

  /* =======================
     AUTO-INVOICE (already paid via Razorpay)
     Mirrors the auto-invoice block in createAppointment, but this booking
     is already paid in full, so amountPaid = the payment amount and the
     invoice is created already marked paid.
  ======================== */

  let invoiceId = null;
  try {
    const invoice = await generateInvoice({
      patient,
      clinic,
      appointment: appointment._id,
      items: [
        {
          itemType: "opd_fee",
          description: "OPD Consultation",
          unitPrice: payment.amount,
        },
      ],
      amountPaid: payment.amount,
      paymentMethod: "online",
    });
    invoiceId = invoice._id;
    appointment.invoice = invoice._id;
    await appointment.save();
  } catch (err) {
    // Don't fail the booking if invoice generation hiccups; log for follow-up.
    console.error("Auto-invoice for online-paid appointment failed:", err.message);
  }

  dispatchBookingNotifications(appointment._id);

  /* =======================
     RESPONSE
  ======================== */

  return ApiResponse.created(
    res,
    {
      appointmentId: appointment._id,
      appointmentNumber: appointment.appointmentNumber,
      tokenNumber: appointment.tokenNumber,
      status: appointment.status,
      opdFee: appointment.opdFee,
      opdFeePaid: true,
      invoiceId,
      patient: {
        id: patient._id,
        name: patient.name,
        phone: patient.phone,
      },
    },
    "Appointment booked successfully",
  );

  notify({ recipientId: patient._id, recipientModel: "Patient", type: "appointment_confirmation", title: "Appointment Confirmed", message: `Your appointment #${appointment.appointmentNumber} has been booked successfully. Token: ${appointment.tokenNumber}`, sendEmail: true, appointment: appointment._id });
});

/**
 * @desc    Book a free OPD appointment for a logged-in patient with an active membership.
 *          Membership status is re-read from DB on every request — never trusts client flags.
 * @route   POST /api/appointments/book-free
 * @access  Patient (patientProtect)
 */
export const bookAppointmentFree = asyncHandler(async (req, res) => {
  // patientProtect already loaded req.patient fresh from DB
  const patient = req.patient;

  // Server-authoritative membership check
  if (!patient.hasMembership) {
    return ApiResponse.error(
      res,
      "An active membership is required to book a free OPD appointment",
      403,
    );
  }

  const { clinic, date, timeSlot, reason, type, bookingType } = req.body;

  const urgency = bookingType || "regular";
  if (!["regular", "emergency"].includes(urgency)) {
    return ApiResponse.error(res, "bookingType must be 'regular' or 'emergency'", 400);
  }

  if (!clinic || !date || !timeSlot) {
    return ApiResponse.error(res, "Clinic, date, and time slot are required", 400);
  }

  if (!reason) {
    return ApiResponse.error(res, "Reason for visit is required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(clinic)) {
    return ApiResponse.error(res, "Invalid clinic ID", 400);
  }

  const slotError = await validateAppointmentSlot({ clinic, date, timeSlot, bookingType: urgency });
  if (slotError) {
    return ApiResponse.error(res, slotError.message, slotError.status);
  }

  const appointment = await Appointment.create({
    patient: patient._id,
    clinic,
    date,
    timeSlot,
    reason,
    type: type || "regular",
    appointmentType: urgency,
    visitType: "opd",
    opdFee: 0,
    fee: 0,
    isFree: true,
    opdFeePaid: true,
    paymentMethod: "free",
    paymentStatus: "free",
    source: "online",
  });

  dispatchBookingNotifications(appointment._id);

  return ApiResponse.created(
    res,
    {
      appointmentId: appointment._id,
      appointmentNumber: appointment.appointmentNumber,
      tokenNumber: appointment.tokenNumber,
      status: appointment.status,
      opdFee: 0,
      isFree: true,
      opdFeePaid: true,
      patient: {
        id: patient._id,
        name: patient.name,
        phone: patient.phone,
      },
    },
    "Appointment booked successfully",
  );
});

/**
 * @desc    Update appointment details
 * @route   PATCH /api/appointments/:id
 * @access  Admin
 */
export const updateAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  // 1️⃣ Find appointment
  const appointment = await Appointment.findById(id);
  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  const {
    patient,
    clinic,
    date,
    timeSlot,
    type,
    appointmentType,
    visitType,
    treatmentId,
    treatmentName,
    fee,
    isFree,
    status,
    reason,
    notes,
    opdFee,
    opdFeePaid,
    source,
    checkInTime,
    startTime,
    endTime,
    paymentMethod,
    paymentStatus,
  } = req.body;

  /* =======================
     SLOT CONFLICT CHECK
     (only if date or timeSlot changes)
  ======================== */
  if (date || timeSlot) {
    const newDate = date || appointment.date;
    const newTimeSlot = timeSlot || appointment.timeSlot;

    const startOfDay = new Date(newDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(newDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Use incoming urgency (or existing) to determine the effective capacity
    const urgency = appointmentType || appointment.appointmentType || "regular";
    const capacity = slotCapacityFor(urgency);
    const slotCount = await Appointment.countDocuments({
      _id: { $ne: appointment._id },
      clinic: appointment.clinic,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: newTimeSlot,
      status: { $ne: "cancelled" },
    });

    if (slotCount >= capacity) {
      return ApiResponse.error(res, "This time slot is fully booked", 409);
    }

    appointment.date = newDate;
    appointment.timeSlot = newTimeSlot;
  }

  /* =======================
     DIRECT FIELD UPDATES
     (Appointment only)
  ======================== */
  if (patient !== undefined) appointment.patient = patient;
  if (clinic !== undefined) appointment.clinic = clinic;
  if (type !== undefined) appointment.type = type;
  if (status !== undefined) appointment.status = status;
  if (reason !== undefined) appointment.reason = reason;
  if (notes !== undefined) appointment.notes = notes;
  if (opdFeePaid !== undefined) appointment.opdFeePaid = opdFeePaid;
  if (source !== undefined) appointment.source = source;

  if (checkInTime !== undefined) appointment.checkInTime = checkInTime;
  if (startTime !== undefined) appointment.startTime = startTime;
  if (endTime !== undefined) appointment.endTime = endTime;

  if (appointmentType !== undefined) appointment.appointmentType = appointmentType;
  if (visitType !== undefined) {
    appointment.visitType = visitType;
    if (visitType === "opd") {
      appointment.treatmentId = null;
      appointment.treatmentName = "";
    }
  }
  if (fee !== undefined) {
    appointment.fee = Number(fee);
    appointment.opdFee = Number(fee);
  }
  if (opdFee !== undefined) {
    appointment.opdFee = Number(opdFee);
    appointment.fee = Number(opdFee);
  }
  if (treatmentId !== undefined) appointment.treatmentId = treatmentId || null;
  if (treatmentName !== undefined) appointment.treatmentName = treatmentName || "";
  if (isFree !== undefined) {
    appointment.isFree = isFree;
    // Auto-derive paymentStatus unless an explicit override arrives later in body
    if (!paymentStatus) {
      if (isFree) {
        appointment.paymentStatus = "free";
        appointment.opdFeePaid = true;
      } else if (appointment.paymentStatus === "free") {
        appointment.paymentStatus = "unpaid";
        appointment.opdFeePaid = false;
      }
    }
  }

  if (paymentMethod !== undefined) appointment.paymentMethod = paymentMethod;
  if (paymentStatus !== undefined) appointment.paymentStatus = paymentStatus;

  /* =======================
     SYNC LINKED INVOICE
     — fee change: update item unitPrice → recalculate grandTotal
     — payment change: set amountPaid based on new paymentStatus
     Both are handled in a single invoice load to avoid double saves.
  ======================== */
  const invoiceNeedsSync =
    fee !== undefined || opdFee !== undefined ||
    paymentStatus !== undefined || paymentMethod !== undefined || isFree !== undefined;

  if (invoiceNeedsSync && appointment.invoice) {
    const invoice = await Invoice.findById(appointment.invoice);
    if (invoice) {
      let invoiceDirty = false;

      // Update invoice line-item price when fee changes
      if ((fee !== undefined || opdFee !== undefined) && invoice.items?.length > 0) {
        const effectiveFee = fee !== undefined ? Number(fee) : Number(opdFee);
        invoice.items[0].unitPrice = appointment.isFree ? 0 : effectiveFee;
        invoice.calculateTotals(); // recalculate grandTotal in memory before setting amountPaid
        invoiceDirty = true;
      }

      // Sync amountPaid to the (possibly recalculated) grandTotal
      if (paymentStatus !== undefined || paymentMethod !== undefined || isFree !== undefined) {
        const newPS = appointment.paymentStatus;
        if (newPS === "free") {
          invoice.amountPaid = invoice.grandTotal;
          invoice.paymentMethod = "free";
        } else if (newPS === "paid") {
          invoice.amountPaid = invoice.grandTotal;
        } else {
          invoice.amountPaid = 0;
        }
        invoiceDirty = true;
      }

      if (invoiceDirty) {
        await invoice.save(); // pre-save hook re-runs calculateTotals and sets paymentStatus
      }
    }
  }

  /* =======================
     SAVE
  ======================== */
  await appointment.save();

  /* =======================
     RESPONSE
  ======================== */
  const updatedAppointment = await Appointment.findById(id)
    .populate("patient")
    .populate("clinic")
    .populate("createdBy", "name");

  ApiResponse.success(
    res,
    updatedAppointment,
    "Appointment updated successfully",
  );
});

/**
 * @desc    Update appointment status
 * @route   PATCH /api/appointments/:id/status
 * @access  Admin
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  // Allowed transitions
  const allowedTransitions = {
    scheduled: ["confirmed", "cancelled"],
    confirmed: ["checked_in", "cancelled", "no_show"],
    checked_in: ["in_progress", "cancelled"],
    in_progress: ["completed"],
    completed: [],
    cancelled: [],
    no_show: [],
  };

  if (!allowedTransitions[appointment.status]?.includes(status)) {
    return ApiResponse.error(
      res,
      `Invalid status transition from ${appointment.status} to ${status}`,
      400,
    );
  }

  appointment.status = status;

  appointment.statusHistory.push({
    status,
    reason,
    changedBy: req.user?._id,
  });

  await appointment.save();

  ApiResponse.success(
    res,
    appointment,
    "Appointment status updated successfully",
  );
});

/**
 * @desc    Check-in patient
 * @route   POST /api/appointments/:id/check-in
 * @access  Admin
 */
export const checkIn = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  // Must be confirmed or scheduled
  if (!["scheduled", "confirmed"].includes(appointment.status)) {
    return ApiResponse.error(res, "Appointment cannot be checked in", 400);
  }

  // Verify appointment is today
  const today = new Date();
  const start = new Date(today.setHours(0, 0, 0, 0));
  const end = new Date(today.setHours(23, 59, 59, 999));

  if (appointment.date < start || appointment.date > end) {
    return ApiResponse.error(
      res,
      "Check-in allowed only for today's appointments",
      400,
    );
  }

  appointment.status = "checked_in";
  appointment.checkInTime = new Date();

  appointment.statusHistory.push({
    status: "checked_in",
    reason: "Patient arrived",
    changedBy: req.user?._id,
  });

  await appointment.save();

  ApiResponse.success(res, appointment, "Patient checked in successfully");
});

/**
 * @desc    Start appointment (begin treatment)
 * @route   POST /api/appointments/:id/start
 * @access  Admin
 */
export const startAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  if (appointment.status !== "checked_in") {
    return ApiResponse.error(res, "Patient must be checked in first", 400);
  }

  appointment.status = "in_progress";
  appointment.startTime = new Date();

  appointment.statusHistory.push({
    status: "in_progress",
    reason: "Treatment started",
    changedBy: req.user?._id,
  });

  await appointment.save();

  ApiResponse.success(res, { appointment }, "Appointment started successfully");
});

/**
 * @desc    Complete appointment
 * @route   POST /api/appointments/:id/complete
 * @access  Admin
 */
export const completeAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { clinicalNotes, prescriptions } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  if (!["in_progress", "checked_in"].includes(appointment.status)) {
    return ApiResponse.error(res, "Appointment cannot be completed", 400);
  }

  appointment.status = "completed";
  appointment.endTime = new Date();

  // Store clinical info in notes (appointment-only rule)
  appointment.notes = [
    clinicalNotes && `Clinical Notes: ${clinicalNotes}`,
    prescriptions && `Prescriptions: ${prescriptions}`,
  ]
    .filter(Boolean)
    .join("\n");

  appointment.statusHistory.push({
    status: "completed",
    reason: "Treatment completed",
    changedBy: req.user?._id,
  });

  await appointment.save();

  ApiResponse.success(res, appointment, "Appointment completed successfully");
});

/**
 * @desc    Cancel appointment
 * @route   POST /api/appointments/:id/cancel
 * @access  Admin / Patient
 */
export const cancelAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  // 1️⃣ Find appointment by ID
  const appointment = await Appointment.findById(id)
    .populate("patient", "name phone email")
    .populate("clinic", "name");

  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  // 2️⃣ Check if can be cancelled
  if (appointment.status === "cancelled") {
    return ApiResponse.error(res, "Appointment already cancelled", 400);
  }

  // 3️⃣ Update status to 'cancelled'
  appointment.status = "cancelled";

  // 4️⃣ Add cancellation reason
  appointment.cancellationReason = reason || "Cancelled by clinic";

  await appointment.save();

  // 5️⃣ Send cancellation notification via email
  if (appointment.patient?.email) {
    const appointmentDate = appointment.date
      ? new Date(appointment.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "N/A";

    sendEmail({
      to: appointment.patient.email,
      subject: "Appointment Cancelled - Ujjwal Dental Clinic",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
          <p>Hello ${appointment.patient.name || "Patient"},</p>
          <p>Your appointment has been <strong style="color: #f44336;">cancelled</strong>.</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Date:</strong> ${appointmentDate}</p>
            <p style="margin: 4px 0;"><strong>Time:</strong> ${appointment.timeSlot || "N/A"}</p>
            <p style="margin: 4px 0;"><strong>Clinic:</strong> ${appointment.clinic?.name || "N/A"}</p>
            ${appointment.cancellationReason ? `<p style="margin: 4px 0;"><strong>Reason:</strong> ${appointment.cancellationReason}</p>` : ""}
          </div>
          <p>If you'd like to reschedule, please visit our patient portal or contact the clinic.</p>
          <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
          <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Patient Portal</p>
        </div>
      `,
      text: `Hello ${appointment.patient.name || "Patient"}, Your appointment on ${appointmentDate} at ${appointment.timeSlot || "N/A"} has been cancelled. Reason: ${appointment.cancellationReason || "N/A"}. Contact the clinic to reschedule.`,
    }).catch((err) => console.error("[Appointment] Failed to send cancellation email:", err));
  }

  // 6️⃣ Return success
  ApiResponse.success(res, appointment, "Appointment cancelled successfully");

  notify({ recipientId: appointment.patient._id || appointment.patient, recipientModel: "Patient", type: "appointment_cancellation", title: "Appointment Cancelled", message: `Your appointment #${appointment.appointmentNumber} has been cancelled.${appointment.cancellationReason ? ` Reason: ${appointment.cancellationReason}` : ""}`, sendEmail: true, appointment: appointment._id });
});

/**
 * @desc    Reschedule appointment (admin/staff only)
 * @route   POST /api/appointments/:id/reschedule
 * @access  Admin
 */
export const rescheduleAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newDate, newTimeSlot, reason } = req.body;

  /* =======================
     BASIC VALIDATION
  ======================== */

  if (!newDate || !newTimeSlot) {
    return ApiResponse.error(res, "New date and new time slot are required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  /* =======================
     1. FIND APPOINTMENT
  ======================== */

  const appointment = await Appointment.findById(id).populate("patient", "_id name");

  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  if (["cancelled", "completed"].includes(appointment.status)) {
    return ApiResponse.error(res, "This appointment cannot be rescheduled", 400);
  }

  /* =======================
     2. VALIDATE NEW DATE / TIME
  ======================== */

  const requestedDate = new Date(newDate);
  if (isNaN(requestedDate.getTime())) {
    return ApiResponse.error(res, "Invalid date format", 400);
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const dayStart = new Date(requestedDate);
  dayStart.setHours(0, 0, 0, 0);

  if (dayStart < todayStart) {
    return ApiResponse.error(res, "Cannot reschedule to a past date", 400);
  }

  if (dayStart.getTime() === todayStart.getTime()) {
    const [h, m] = String(newTimeSlot).split(":").map(Number);
    const slotMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (slotMinutes <= nowMinutes) {
      return ApiResponse.error(res, "This time slot has already passed", 400);
    }
  }

  /* =======================
     3. SLOT CAPACITY CHECK
     Exclude this appointment from the count (it is moving, not adding).
     Capacity: 2 for regular bookings, 3 for emergency (same rule as create).
  ======================== */

  const dayEnd = new Date(requestedDate);
  dayEnd.setHours(23, 59, 59, 999);
  const capacity = slotCapacityFor(appointment.appointmentType);
  const slotCount = await Appointment.countDocuments({
    _id: { $ne: appointment._id },
    clinic: appointment.clinic,
    date: { $gte: dayStart, $lte: dayEnd },
    timeSlot: newTimeSlot,
    status: { $ne: "cancelled" },
  });

  if (slotCount >= capacity) {
    return ApiResponse.error(res, "This time slot is fully booked", 409);
  }

  /* =======================
     4. RECORD OLD VALUES FOR AUDIT TRAIL
  ======================== */

  const oldDateStr = new Date(appointment.date).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const oldTimeSlot = appointment.timeSlot;

  /* =======================
     5. UPDATE DATE, TIME, STATUS
  ======================== */

  appointment.date = newDate;
  appointment.timeSlot = newTimeSlot;
  appointment.status = "scheduled";

  /* =======================
     6. REGENERATE TOKEN FOR NEW DATE
     The pre-save hook only runs for new documents, so we regenerate manually.
     istDateKey() converts the new appointment date to an IST date string (YYYY-MM-DD)
     so the token series resets correctly at IST midnight for the new date.
  ======================== */

  const newDateKey = istDateKey(new Date(newDate));
  appointment.tokenDateKey = newDateKey;
  appointment.tokenNumber = await nextDailyToken(appointment.clinic, newDateKey);

  /* =======================
     7. APPEND AUDIT TRAIL (preserve existing notes)
  ======================== */

  const newDateStr = new Date(newDate).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const rescheduleNote = `Rescheduled from ${oldDateStr} ${oldTimeSlot} to ${newDateStr} ${newTimeSlot}${reason ? ` — Reason: ${reason}` : ""}`;
  appointment.notes = appointment.notes
    ? `${appointment.notes}\n${rescheduleNote}`
    : rescheduleNote;

  await appointment.save();

  /* =======================
     8. NOTIFY PATIENT (in-app only)
  ======================== */

  const patientId = appointment.patient?._id || appointment.patient;
  notify({
    recipientId: patientId,
    recipientModel: "Patient",
    type: "appointment_reschedule",
    title: "Appointment Rescheduled",
    message: `Your appointment #${appointment.appointmentNumber} has been rescheduled to ${newDateStr} at ${newTimeSlot}.`,
    sendEmail: false,
    appointment: appointment._id,
  });

  /* =======================
     9. RESPONSE
  ======================== */

  ApiResponse.success(res, appointment, "Appointment rescheduled successfully");
});

/**
 * @desc    Delete appointment permanently
 * @route   DELETE /api/appointments/:id
 * @access  Admin
 */
export const deleteAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const appointment = await Appointment.findById(id);

  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  if (appointment.status !== "cancelled") {
    return ApiResponse.error(res, "Please cancel the appointment before deleting", 400);
  }

  await Appointment.findByIdAndDelete(id);

  ApiResponse.success(res, null, "Appointment deleted permanently");
});

/**
 * @desc    Close a treatment plan — cancels remaining sessions, reconciles invoice
 * @route   POST /api/appointments/:id/close-treatment
 * @access  Admin
 */
export const closeTreatmentPlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { resolution, reason } = req.body;

  if (!reason || !reason.trim()) {
    return ApiResponse.error(res, "Reason is required to close a treatment plan", 400);
  }
  if (!["completed", "write_off", "refund"].includes(resolution)) {
    return ApiResponse.error(res, "resolution must be completed, write_off, or refund", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  const parent = await Appointment.findById(id).populate("invoice");
  if (!parent) return ApiResponse.error(res, "Appointment not found", 404);
  if (parent.visitType !== "treatment") {
    return ApiResponse.error(res, "Can only close treatment appointments", 400);
  }
  if (["completed", "closed_early", "abandoned"].includes(parent.treatmentStatus)) {
    return ApiResponse.error(res, "Treatment is already closed", 400);
  }
  if (parent.status === "cancelled") {
    return ApiResponse.error(res, "Cannot close a cancelled appointment", 400);
  }

  // Step 1: Cancel all remaining scheduled session appointments
  const cancelledSessions = await Appointment.updateMany(
    { parentAppointment: parent._id, status: "scheduled" },
    { $set: { status: "cancelled", cancellationReason: `Treatment plan closed: ${reason.trim()}` } },
  );

  // Step 2: Set parent treatment status
  const statusMap = { completed: "completed", write_off: "abandoned", refund: "closed_early" };
  parent.treatmentStatus = statusMap[resolution];
  parent.treatmentClosedAt = new Date();
  parent.treatmentClosedReason = reason.trim();
  await parent.save();

  // Step 3: Reconcile invoice (write_off and completed → zero out balance)
  if (parent.invoice && (resolution === "completed" || resolution === "write_off")) {
    const invoice = parent.invoice;
    if (invoice.balanceDue > 0) {
      const originalBalance = invoice.balanceDue;
      // Set amountPaid = grandTotal so the pre-save calculateTotals hook
      // derives balanceDue=0 and paymentStatus="paid" correctly.
      invoice.amountPaid = invoice.grandTotal;
      invoice.notes =
        (invoice.notes ? invoice.notes + "\n" : "") +
        `[${new Date().toISOString()}] Treatment closed (${resolution}): ${reason.trim()}. Outstanding ₹${originalBalance} written off.`;
      await invoice.save();
    }
  }
  // resolution === "refund" → invoice left untouched; admin processes refund via Payment History.

  // Step 4: Summary counts
  const sessionsCompleted = await Appointment.countDocuments({
    parentAppointment: parent._id,
    status: "completed",
  });
  const sessionsCancelled = cancelledSessions.modifiedCount;

  return ApiResponse.success(
    res,
    {
      treatmentStatus: parent.treatmentStatus,
      sessionsCancelled,
      sessionsCompleted,
      invoiceStatus: parent.invoice?.paymentStatus || null,
    },
    "Treatment plan closed",
  );
});
