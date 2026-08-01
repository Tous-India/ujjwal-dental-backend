import crypto from "crypto";
import mongoose from "mongoose";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Patient from "./patient.model.js";
import MembershipPlan from "../memberships/membership.model.js";
import Appointment from "../appointments/appointment.model.js";
import { Treatment } from "../treatments/treatment.model.js";
import Payment from "../payments/payment.model.js";
import Report from "../reports/report.model.js";
import Invoice from "../billing/invoice.model.js";
import Test from "../tests/test.model.js";

/**
 * PATIENT CONTROLLER
 *
 * Handles all patient related operations:
 * - CRUD operations for patients
 * - Patient search
 * - Patient history (appointments, treatments, payments, reports)
 * - Membership management
 */

/**
 * @desc    Get all patients
 * @route   GET /api/patients
 * @access  Admin
 */
export const getAllPatients = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, isActive, hasMembership } = req.query;

  // Build query
  const query = {};

  // Filter by active status.
  // Default to active-only so soft-deleted (deactivated) patients drop out of
  // the working list; pass ?isActive=false explicitly to view inactive ones.
  if (isActive !== undefined) {
    query.isActive = isActive === "true";
  } else {
    query.isActive = true;
  }

  // Search by name, phone, or email
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  // Filter by membership status
  if (hasMembership === "true") {
    query["membership.status"] = "active";
  } else if (hasMembership === "false") {
    query.$or = [
      { "membership.status": { $ne: "active" } },
      { membership: { $exists: false } },
    ];
  }

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get patients with pagination
  const [patients, total] = await Promise.all([
    Patient.find(query)
      .populate("preferredClinic", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Patient.countDocuments(query),
  ]);

  // Return paginated response
  ApiResponse.paginated(res, patients, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Search patients by name or phone
 * @route   GET /api/patients/search?q=keyword
 * @access  Admin
 */
export const searchPatients = asyncHandler(async (req, res) => {
  const { q, phone, limit = 10 } = req.query;

  // Build search query
  let query = { isActive: true };

  if (phone) {
    // Phone search (partial match)
    query.phone = { $regex: phone, $options: "i" };
  } else if (q) {
    // Search by name or phone
    query.$or = [
      { name: { $regex: q, $options: "i" } },
      { phone: { $regex: q, $options: "i" } },
    ];
  }

  // Get patients
  const patients = await Patient.find(query)
    .select("name phone email membership hasMembership currentDiscount")
    .limit(parseInt(limit))
    .sort({ name: 1 });

  ApiResponse.success(res, { patients }, "Search results");
});

/**
 * @desc    Get patient by ID
 * @route   GET /api/patients/:id
 * @access  Admin
 */
export const getPatientById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find patient by ID
  const patient = await Patient.findById(id).populate(
    "preferredClinic",
    "name code address"
  );

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  ApiResponse.success(res, { patient }, "Patient fetched successfully");
});

/**
 * @desc    Create new patient
 * @route   POST /api/patients
 * @access  Admin
 */
export const createPatient = asyncHandler(async (req, res) => {
  const {
    name,
    phone,
    email,
    gender,
    dateOfBirth,
    age,
    address,
    bloodGroup,
    allergies,
    medicalHistory,
    emergencyContact,
    preferredClinic,
    notes,
  } = req.body;

  // Validate required fields
  if (!name || !phone) {
    return ApiResponse.error(res, "Name and phone are required", 400);
  }

  // Name must not contain digits (letters, spaces and dots only)
  if (/\d/.test(name)) {
    return ApiResponse.error(res, "Name cannot contain numbers", 400);
  }

  // Validate phone format
  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return ApiResponse.error(res, "Please provide a valid 10-digit phone number", 400);
  }

  // Check if phone already exists
  const existingPatient = await Patient.findOne({ phone });
  if (existingPatient) {
    return ApiResponse.error(res, "Patient with this phone number already exists", 409);
  }

  // Check if email already exists (if provided)
  if (email) {
    const emailExists = await Patient.findOne({ email: email.toLowerCase() });
    if (emailExists) {
      return ApiResponse.error(res, "Patient with this email already exists", 409);
    }
  }

  // Create patient — default password set server-side; bcrypt pre-save hook hashes it
  const patient = await Patient.create({
    name,
    phone,
    email: email ? email.toLowerCase() : undefined,
    gender,
    dateOfBirth,
    age,
    address,
    bloodGroup,
    allergies,
    medicalHistory,
    emergencyContact,
    preferredClinic,
    notes,
    password: "account123",
  });

  ApiResponse.created(res, { patient }, "Patient created successfully");
});

/**
 * @desc    Update patient
 * @route   PATCH /api/patients/:id
 * @access  Admin
 */
export const updatePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find patient
  const patient = await Patient.findById(id);

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Check email uniqueness if being updated
  if (req.body.email && req.body.email.toLowerCase() !== patient.email) {
    const emailExists = await Patient.findOne({
      email: req.body.email.toLowerCase(),
      _id: { $ne: id },
    });
    if (emailExists) {
      return ApiResponse.error(res, "Email is already in use", 400);
    }
  }

  // Block deactivation if patient has an active membership
  if (req.body.isActive === false) {
    const hasActiveMembership =
      patient.membership?.status === "active" &&
      patient.membership?.expiryDate &&
      new Date(patient.membership.expiryDate) > new Date();

    if (hasActiveMembership) {
      return ApiResponse.error(
        res,
        "Cannot deactivate a patient with an active membership plan. Please cancel or expire the membership first.",
        400
      );
    }
  }

  // Update allowed fields
  const allowedFields = [
    "name",
    "email",
    "gender",
    "dateOfBirth",
    "age",
    "address",
    "bloodGroup",
    "allergies",
    "medicalHistory",
    "emergencyContact",
    "preferredClinic",
    "notes",
    "isActive",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      if (field === "email" && req.body[field]) {
        patient[field] = req.body[field].toLowerCase();
      } else {
        patient[field] = req.body[field];
      }
    }
  });

  // Save changes
  await patient.save();

  // Return updated patient
  const updatedPatient = await Patient.findById(id).populate(
    "preferredClinic",
    "name code"
  );

  ApiResponse.success(res, { patient: updatedPatient }, "Patient updated successfully");
});

/**
 * @desc    Permanently delete an inactive patient (hard delete)
 * @route   DELETE /api/patients/:id
 * @access  Admin
 */
export const deletePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  const patient = await Patient.findById(id);

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  if (patient.isActive === true) {
    return ApiResponse.error(
      res,
      "Only inactive patients can be permanently deleted. Please deactivate the patient first.",
      400
    );
  }

  if (patient.membership?.status === "active") {
    return ApiResponse.error(
      res,
      "Cannot delete patient with active membership.",
      400
    );
  }

  await Patient.findByIdAndDelete(id);

  ApiResponse.success(
    res,
    { name: patient.name },
    `Patient "${patient.name}" has been permanently deleted.`
  );
});

/**
 * @desc    Reactivate patient
 * @route   PATCH /api/patients/:id/reactivate
 * @access  Admin
 */
export const reactivatePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await Patient.findById(id);

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  patient.isActive = true;
  await patient.save();

  ApiResponse.success(res, { patient }, "Patient reactivated successfully");
});

/**
 * Generate a strong temporary password (no ambiguous chars). Guaranteed to
 * include at least one letter and one digit, length 14, so it passes the
 * strength policy below.
 */
const generateTempPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  let pw = "";
  for (let i = 0; i < 12; i++) pw += chars[bytes[i] % chars.length];
  return `${pw}a7`; // ensures a letter + a digit
};

// New-password policy: min 10 chars, at least one letter and one number
// (matches the patient/admin reset-password flows).
const isStrongPassword = (pw) =>
  typeof pw === "string" &&
  pw.length >= 10 &&
  /[A-Za-z]/.test(pw) &&
  /[0-9]/.test(pw);

/**
 * @desc    Admin: set or reset a patient's password (never view it).
 *          - { generate: true }  → server creates a strong temp password,
 *            hashes & stores it, and returns it ONCE so the admin can share it.
 *          - { newPassword }     → admin sets a specific password (validated).
 *          The password is hashed by the model's pre-save bcrypt hook; the
 *          plaintext is never stored, logged, or returned beyond the one-time
 *          temp value, and the hash is never returned.
 * @route   PATCH /api/patients/:id/reset-password
 * @access  Admin
 */
export const resetPatientPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword, generate } = req.body;

  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  let plaintext;
  if (generate) {
    plaintext = generateTempPassword();
  } else {
    if (!isStrongPassword(newPassword)) {
      return ApiResponse.error(
        res,
        "Password must be at least 10 characters and include at least one letter and one number",
        400,
      );
    }
    plaintext = newPassword;
  }

  // The pre-save hook hashes `password` with bcrypt (cost 12).
  patient.password = plaintext;
  await patient.save();

  // Return only the patient id, plus the temp password ONCE when generated.
  // Never return the hash; never log the plaintext.
  return ApiResponse.success(
    res,
    {
      patientId: patient._id,
      ...(generate ? { temporaryPassword: plaintext } : {}),
    },
    generate ? "Temporary password generated" : "Password updated successfully",
  );
});

/**
 * @desc    Get patient's appointments
 * @route   GET /api/patients/:id/appointments
 * @access  Admin
 */
export const getPatientAppointments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, page = 1, limit = 10 } = req.query;

  // Verify patient exists
  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Build query
  const query = { patient: id };
  if (status) {
    query.status = status;
  }

  // Get appointments
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [appointments, total] = await Promise.all([
    Appointment.find(query)
      .populate("clinic", "name code")
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Appointment.countDocuments(query),
  ]);

  ApiResponse.paginated(res, appointments, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get patient's treatments
 * @route   GET /api/patients/:id/treatments
 * @access  Admin
 */
/**
 * Maps an Appointment's treatmentStatus (null/completed/closed_early/abandoned)
 * onto the patient portal's older status vocabulary (planned/in_progress/
 * completed/cancelled/on_hold) so the existing frontend table needs no changes.
 */
const treatmentStatusToPortalStatus = (treatmentStatus) => {
  if (!treatmentStatus) return "in_progress";
  if (treatmentStatus === "completed") return "completed";
  return "cancelled"; // closed_early / abandoned -- both read as "not completed, no longer active"
};

export const getPatientTreatments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, page = 1, limit = 10 } = req.query;

  // Verify patient exists
  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Treatments now live as Appointment documents (visitType: "treatment") --
  // the standalone Treatment collection this endpoint used to read from is
  // no longer written to by any booking path (admin or patient), so it was
  // silently empty for every patient regardless of how many real treatments
  // they had. Reconnected to the real data source; deliberately separate
  // from admin's getAllAppointments (Treatments-tab collapse) query logic,
  // which has its own filtering semantics for a different (admin) need.
  const query = { patient: id, visitType: "treatment" };

  // The portal's status filter maps onto treatmentStatus AFTER reshaping
  // (see treatmentStatusToPortalStatus below), not a raw Mongo field -- so
  // when a status filter is present, fetch all matching appointments and
  // paginate in-memory after filtering, rather than skip/limit at the DB
  // level (which would paginate before the filter and miscount `total`).
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const baseQuery = Appointment.find(query)
    .populate("treatmentId", "name category price")
    .populate("clinic", "name code")
    .populate("invoice", "grandTotal amountPaid balanceDue")
    .sort({ createdAt: -1 });

  let appointments, total;
  if (status) {
    appointments = await baseQuery.lean();
    total = null; // computed after filtering below
  } else {
    [appointments, total] = await Promise.all([
      baseQuery.skip(skip).limit(parseInt(limit)).lean(),
      Appointment.countDocuments(query),
    ]);
  }

  const appointmentIds = appointments.map((a) => a._id);
  const sessions = appointmentIds.length
    ? await Appointment.find({
        parentAppointment: { $in: appointmentIds },
        visitType: "treatment_session",
      })
        .select("parentAppointment status")
        .lean()
    : [];
  const sessionsByParent = {};
  for (const s of sessions) {
    const key = String(s.parentAppointment);
    (sessionsByParent[key] ||= []).push({ status: s.status });
  }

  let treatments = appointments.map((a) => ({
    _id: a._id,
    name: a.treatmentName || a.treatmentId?.name || "Treatment",
    treatmentType: a.treatmentId
      ? { name: a.treatmentId.name, category: a.treatmentId.category, price: a.treatmentId.price }
      : null,
    clinic: a.clinic,
    startDate: a.createdAt,
    createdAt: a.createdAt,
    // Parent appointment is implicitly the first session (same convention
    // used admin-side), plus every linked treatment_session child.
    sessions: [{ status: a.status }, ...(sessionsByParent[String(a._id)] || [])],
    sessionsPlanned: a.sessionsPlanned || null,
    cost: a.invoice?.grandTotal ?? a.fee ?? 0,
    status: treatmentStatusToPortalStatus(a.treatmentStatus),
  }));

  if (status) {
    treatments = treatments.filter((t) => t.status === status);
    total = treatments.length;
    treatments = treatments.slice(skip, skip + parseInt(limit));
  }

  ApiResponse.paginated(res, treatments, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get patient's payments
 * @route   GET /api/patients/:id/payments
 * @access  Admin
 */
export const getPatientPayments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 10 } = req.query;

  // Verify patient exists
  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Get payments
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [payments, total] = await Promise.all([
    Payment.find({ patient: id })
      .populate("invoice", "invoiceNumber grandTotal")
      .populate("treatmentType", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Payment.countDocuments({ patient: id }),
  ]);

  // Get payment summary
  const summary = await Payment.getPatientPaymentSummary(id);

  ApiResponse.paginated(
    res,
    { payments, summary },
    {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    }
  );
});

/**
 * @desc    Get patient's reports
 * @route   GET /api/patients/:id/reports
 * @access  Admin
 */
export const getPatientReports = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { category, page = 1, limit = 10 } = req.query;

  // Verify patient exists
  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Build query
  const query = { patient: id, isActive: true };
  if (category) {
    query.category = category;
  }

  // Get reports
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [reports, total] = await Promise.all([
    Report.find(query)
      .populate("uploadedBy", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Report.countDocuments(query),
  ]);

  ApiResponse.paginated(res, reports, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get patient's tests
 * @route   GET /api/patients/:id/tests
 * @access  Admin
 */
export const getPatientTests = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, page = 1, limit = 10 } = req.query;

  // Verify patient exists
  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Build query
  const query = { patient: id };
  if (status) {
    query.status = status;
  }

  // Get tests
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [tests, total] = await Promise.all([
    Test.find(query)
      .populate("testType", "name code category price")
      .populate("clinic", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Test.countDocuments(query),
  ]);

  ApiResponse.paginated(res, tests, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get patient's invoices
 * @route   GET /api/patients/:id/invoices
 * @access  Admin
 */
export const getPatientInvoices = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, page = 1, limit = 10 } = req.query;

  // Verify patient exists
  const patient = await Patient.findById(id);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Build query
  const query = { patient: id };
  if (status) {
    query.status = status;
  }

  // Get invoices
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [invoices, total] = await Promise.all([
    Invoice.find(query)
      .populate("clinic", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Invoice.countDocuments(query),
  ]);

  ApiResponse.paginated(res, invoices, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get patient's membership details
 * @route   GET /api/patients/:id/membership
 * @access  Admin
 */
export const getPatientMembership = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Populate the plan ref inside the embedded membership sub-document
  const patient = await Patient.findById(id).populate("membership.plan");

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Build the membership object for the response.
  // If membership.plan is still null after populate (custom/manual assignment with no planId),
  // fall back to a name-based lookup so price, duration, features, and benefits are available.
  let currentMembership = patient.membership ? patient.membership.toObject() : null;
  if (currentMembership && !currentMembership.plan && currentMembership.planName) {
    const planByName = await MembershipPlan.findOne({ name: currentMembership.planName }).lean();
    if (planByName) {
      currentMembership.plan = planByName;
    }
  }

  ApiResponse.success(
    res,
    {
      currentMembership,
      membershipHistory: patient.membershipHistory || [],
      hasMembership: patient.hasMembership,
      currentDiscount: patient.currentDiscount,
    },
    "Patient membership fetched"
  );
});

/**
 * @desc    Get patient's complete profile with summary
 * @route   GET /api/patients/:id/profile
 * @access  Admin
 */
export const getPatientProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find patient
  const patient = await Patient.findById(id).populate(
    "preferredClinic",
    "name code"
  );

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Get counts for summary
  const [appointmentCount, treatmentCount, invoiceCount] = await Promise.all([
    Appointment.countDocuments({ patient: id }),
    Treatment.countDocuments({ patient: id }),
    Invoice.countDocuments({ patient: id }),
  ]);

  // Get pending balance
  const pendingInvoices = await Invoice.find({
    patient: id,
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: { $ne: "cancelled" },
  });

  const pendingBalance = pendingInvoices.reduce(
    (sum, inv) => sum + inv.balanceDue,
    0
  );

  // Get last visit
  const lastAppointment = await Appointment.findOne({
    patient: id,
    status: "completed",
  }).sort({ date: -1 });

  ApiResponse.success(
    res,
    {
      patient,
      summary: {
        totalAppointments: appointmentCount,
        totalTreatments: treatmentCount,
        totalInvoices: invoiceCount,
        pendingBalance,
        lastVisit: lastAppointment ? lastAppointment.date : null,
      },
    },
    "Patient profile fetched"
  );
});

/**
 * @desc    Return active treatment plans with outstanding invoices for a patient
 * @route   GET /api/patients/:id/active-context
 * @access  Admin
 */
export const getPatientActiveContext = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  // Get all non-cancelled treatment appointments for this patient
  const treatmentAppts = await Appointment.find({
    patient: id,
    visitType: "treatment",
    status: { $ne: "cancelled" },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!treatmentAppts.length) {
    return ApiResponse.success(res, { activeTreatments: [] });
  }

  // Get all relevant invoices (unpaid, partial, and paid) for this patient
  const relevantInvoices = await Invoice.find({
    patient: id,
    paymentStatus: { $in: ["unpaid", "partial", "paid"] },
  })
    .select("invoiceNumber grandTotal amountPaid balanceDue paymentStatus appointment createdAt")
    .lean();

  if (!relevantInvoices.length) {
    return ApiResponse.success(res, { activeTreatments: [] });
  }

  // For each treatment appointment, find its best matching invoice:
  //   1. Direct: invoice._id === appointment.invoice (appointment stores the ref)
  //   2. Reverse: invoice.appointment === appointment._id (invoice stores the ref)
  //   3. Fallback: any unused invoice for the patient (handles ghost refs)
  const usedInvoiceIds = new Set();
  const enriched = await Promise.all(
    treatmentAppts.map(async (t) => {
      const apptIdStr = t._id.toString();
      const apptInvStr = t.invoice?.toString();

      let invoice =
        relevantInvoices.find((inv) => apptInvStr && inv._id.toString() === apptInvStr) ||
        relevantInvoices.find((inv) => inv.appointment?.toString() === apptIdStr) ||
        relevantInvoices.find((inv) => !usedInvoiceIds.has(inv._id.toString()));

      if (!invoice) return null;
      usedInvoiceIds.add(invoice._id.toString());

      const sessionsCount = await Appointment.countDocuments({
        parentAppointment: t._id,
        status: { $ne: "cancelled" },
      });

      const sessionsBooked = sessionsCount + 1; // parent = Session 1, children counted additionally
      const sessionsPlanned = t.sessionsPlanned || null;
      const sessionsRemaining = sessionsPlanned ? Math.max(0, sessionsPlanned - sessionsBooked) : null;

      const isComplete =
        sessionsPlanned !== null &&
        sessionsBooked >= sessionsPlanned &&
        invoice.balanceDue === 0;
      if (isComplete) return null;

      return {
        parentAppointmentId: t._id,
        treatmentName: t.treatmentName || t.customTreatmentName || "Treatment",
        parentDate: t.date,
        parentTimeSlot: t.timeSlot,
        createdAt: t.createdAt,
        invoice: {
          _id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          grandTotal: invoice.grandTotal,
          amountPaid: invoice.amountPaid,
          balanceDue: invoice.balanceDue,
          paymentStatus: invoice.paymentStatus,
        },
        sessionsBooked,
        sessionsPlanned,
        sessionsRemaining,
        nextSessionNumber: sessionsCount + 2, // parent = Session 1, so next child = count + 2
        isPaidInFull: invoice.paymentStatus === "paid",
        suggestedPaymentPerSession:
          sessionsPlanned && invoice.balanceDue > 0 && sessionsRemaining > 0
            ? Math.ceil(invoice.balanceDue / sessionsRemaining)
            : null,
      };
    }),
  );

  // Paid treatments: only show if created within last 90 days OR have recent session activity
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - NINETY_DAYS);

  const finalTreatments = [];
  for (const t of enriched.filter(Boolean)) {
    if (!t.isPaidInFull) {
      finalTreatments.push(t);
      continue;
    }
    const parentCreatedRecently = new Date(t.createdAt) > cutoff;
    const recentSession = await Appointment.findOne({
      parentAppointment: t.parentAppointmentId,
      status: { $ne: "cancelled" },
      createdAt: { $gt: cutoff },
    }).lean();
    if (parentCreatedRecently || recentSession) {
      finalTreatments.push(t);
    }
  }

  return ApiResponse.success(res, { activeTreatments: finalTreatments });
});
