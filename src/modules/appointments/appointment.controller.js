import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { notify } from "../../utils/notifyHelper.js";
import Appointment from "./appointment.model.js";
import Patient from "../patients/patient.model.js";
import Payment from "../payments/payment.model.js";
import SystemSettings from "../settings/settings.model.js";
import mongoose from "mongoose";
import { sendEmail } from "../../utils/email.js";

/**
 * APPOINTMENT CONTROLLER
 * Handles appointment booking and management
 */

// Maximum bookings allowed per 30-minute slot (per clinic, per date).
const SLOT_CAPACITY = 2;

/**
 * Validate an appointment's date/timeSlot against the booking rules:
 *  - the date must not be in the past
 *  - if the date is today, the slot must not have already passed
 *  - the slot must have fewer than SLOT_CAPACITY active (non-cancelled) bookings
 *
 * Returns `{ status, message }` when invalid, or `null` when the slot is OK.
 */
const validateAppointmentSlot = async ({ clinic, date, timeSlot }) => {
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

  // 3) Slot capacity — at most SLOT_CAPACITY active bookings per slot
  const dayEnd = new Date(requestedDate);
  dayEnd.setHours(23, 59, 59, 999);
  const slotCount = await Appointment.countDocuments({
    clinic,
    date: { $gte: dayStart, $lte: dayEnd },
    timeSlot,
    status: { $ne: "cancelled" },
  });
  if (slotCount >= SLOT_CAPACITY) {
    return { status: 409, message: "This time slot is fully booked" };
  }

  return null;
};

/**
 * @desc    Get all appointments
 * @route   GET /api/appointments?date=&clinic=&status=
 * @access  Admin
 */
export const getAllAppointments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, date, clinic, status } = req.query;

  // 1. Build filter query from params
  const filter = {};

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    filter.clinic = clinic;
  }

  if (status) {
    filter.status = status;
  }

  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    filter.date = { $gte: start, $lte: end };
  }

  // 2. Query appointments with pagination
  const skip = (Number(page) - 1) * Number(limit);

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .populate("patient", "name phone")
      .populate("clinic", "name code")
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
  const { clinic: clinicId, date } = req.query;

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
    (slot) => slotCounts[slot] >= SLOT_CAPACITY
  );

  // A slot is available only if it has not reached capacity.
  let availableSlots = allSlots.filter(
    (slot) => (slotCounts[slot] || 0) < SLOT_CAPACITY
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
    isFree, opdFee: requestOpdFee, opdFeePaid, source, notes
  } = req.body;

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

  const slotError = await validateAppointmentSlot({ clinic, date, timeSlot });
  if (slotError) {
    return ApiResponse.error(res, slotError.message, slotError.status);
  }

  /* =======================
     OPD FEE CALCULATION
  ======================== */

  let opdFee;
  let appointmentIsFree = isFree || false;
  let appointmentOpdFeePaid = opdFeePaid || false;

  // If marked as free appointment, set fee to 0 and mark as paid
  if (appointmentIsFree) {
    opdFee = 0;
    appointmentOpdFeePaid = true;
  } else if (requestOpdFee !== undefined) {
    // Use provided OPD fee from admin
    opdFee = requestOpdFee;
  } else {
    // Calculate from settings
    const settings = await SystemSettings.getSettings();
    const feeSettings = settings.feeSettings || { opdFeeRegular: 300, opdFeeEmergency: 500 };
    opdFee = type === "emergency" ? feeSettings.opdFeeEmergency : feeSettings.opdFeeRegular;
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
    opdFee,
    isFree: appointmentIsFree,
    opdFeePaid: appointmentOpdFeePaid,
    source: source || "walk_in",
    notes,
    createdBy: req.user?._id,
    // ❌ DO NOT set status
    // ❌ DO NOT set tokenNumber
  });

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
      isFree: appointment.isFree,
      opdFeePaid: appointment.opdFeePaid,
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
    captchaToken,
  } = req.body;

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

    // Auto-generate password: first 4 letters of name + phone last 4 digits
    const autoPassword = (name.replace(/\s/g, "").slice(0, 4) + phone.slice(-4)) || "Patient@123";

    patient = await Patient.create({
      name,
      phone,
      email: email?.toLowerCase() || undefined,
      password: autoPassword,
    });
    isNewPatient = true;

    // Send welcome email with login credentials
    if (email) {
      sendEmail({
        to: email,
        subject: "Welcome to Ujjwal Dental Clinic - Your Portal Login",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
            <p>Hello ${name},</p>
            <p>Welcome! Your patient portal account has been created.</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
              <p style="margin: 4px 0;"><strong>Password:</strong> ${autoPassword}</p>
              <p style="margin: 4px 0;"><strong>Login:</strong> <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/login">Patient Portal</a></p>
            </div>
            <p>You can use these credentials to view your appointments, payments, and reports.</p>
            <p style="color: #f44336; font-size: 13px;">Please change your password after first login.</p>
            <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
            <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Patient Portal</p>
          </div>
        `,
        text: `Hello ${name}, Your patient portal account has been created. Email: ${email}, Password: ${autoPassword}. Login at ${process.env.FRONTEND_URL || "http://localhost:5173"}/login`,
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

  const slotError = await validateAppointmentSlot({ clinic, date, timeSlot });
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
    opdFee: payment.amount,
    opdFeePaid: true,
    source: "online",
  });

  /* =======================
     LINK PAYMENT TO APPOINTMENT
  ======================== */

  payment.appointment = appointment._id;
  payment.patient = patient._id;
  await payment.save();

  // Send booking confirmation email
  if (patient.email) {
    const apptDate = appointment.date
      ? new Date(appointment.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "N/A";

    sendEmail({
      to: patient.email,
      subject: "Appointment Confirmed - Ujjwal Dental Clinic",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
          <p>Hello ${patient.name || "Patient"},</p>
          <p>Your appointment has been <strong style="color: #4caf50;">confirmed</strong>!</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Token #:</strong> ${appointment.tokenNumber || "N/A"}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${apptDate}</p>
            <p style="margin: 4px 0;"><strong>Time:</strong> ${appointment.timeSlot || "N/A"}</p>
            <p style="margin: 4px 0;"><strong>Appointment #:</strong> ${appointment.appointmentNumber || "N/A"}</p>
          </div>
          <p>Please arrive 10 minutes before your scheduled time.</p>
          <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
          <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Patient Portal</p>
        </div>
      `,
      text: `Hello ${patient.name}, Your appointment is confirmed. Token: ${appointment.tokenNumber}, Date: ${apptDate}, Time: ${appointment.timeSlot}. Please arrive 10 minutes early.`,
    }).catch((err) => console.error("[Appointment] Failed to send confirmation email:", err));
  }

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
    status,
    reason,
    notes,
    opdFee,
    opdFeePaid,
    source,
    checkInTime,
    startTime,
    endTime,
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

    const conflict = await Appointment.findOne({
      _id: { $ne: appointment._id },
      clinic: appointment.clinic,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: newTimeSlot,
      status: { $ne: "cancelled" },
    });

    if (conflict) {
      return ApiResponse.error(res, "Time slot already booked", 409);
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
  if (opdFee !== undefined) appointment.opdFee = opdFee;
  if (opdFeePaid !== undefined) appointment.opdFeePaid = opdFeePaid;
  if (source !== undefined) appointment.source = source;

  if (checkInTime !== undefined) appointment.checkInTime = checkInTime;
  if (startTime !== undefined) appointment.startTime = startTime;
  if (endTime !== undefined) appointment.endTime = endTime;

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
 * @desc    Reschedule appointment
 * @route   POST /api/appointments/:id/reschedule
 * @access  Admin / Patient
 */
export const rescheduleAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newDate, newTimeSlot, reason } = req.body;

  /* =======================
     BASIC VALIDATION
  ======================== */

  if (!newDate || !newTimeSlot) {
    return ApiResponse.error(
      res,
      "New date and new time slot are required",
      400,
    );
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid appointment ID", 400);
  }

  /* =======================
     1. FIND APPOINTMENT
  ======================== */

  const appointment = await Appointment.findById(id);

  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  if (
    appointment.status === "cancelled" ||
    appointment.status === "completed"
  ) {
    return ApiResponse.error(
      res,
      "This appointment cannot be rescheduled",
      400,
    );
  }

  /* =======================
     2. CHECK SLOT AVAILABILITY
  ======================== */

  const startOfDay = new Date(newDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(newDate);
  endOfDay.setHours(23, 59, 59, 999);

  const slotAlreadyBooked = await Appointment.findOne({
    _id: { $ne: appointment._id }, // exclude same appointment
    clinic: appointment.clinic,
    date: { $gte: startOfDay, $lte: endOfDay },
    timeSlot: newTimeSlot,
    status: { $ne: "cancelled" },
  });

  if (slotAlreadyBooked) {
    return ApiResponse.error(res, "Selected time slot is already booked", 409);
  }

  /* =======================
     3. UPDATE DATE & TIME
  ======================== */

  appointment.date = newDate;
  appointment.timeSlot = newTimeSlot;
  appointment.status = "scheduled"; // reset to scheduled

  if (reason) {
    appointment.notes = `Rescheduled: ${reason}`;
  }

  await appointment.save(); // pre-save will regenerate tokenNumber

  /* =======================
     4. RESPONSE
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

  await Appointment.findByIdAndDelete(id);

  ApiResponse.success(res, null, "Appointment deleted permanently");
});
