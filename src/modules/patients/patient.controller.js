import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Patient from "./patient.model.js";
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
    .select("name phone email hasMembership")
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

  // Create patient
  const patient = await Patient.create({
    name,
    phone,
    email: email ? email.toLowerCase() : undefined,
    gender,
    dateOfBirth,
    address,
    bloodGroup,
    allergies,
    medicalHistory,
    emergencyContact,
    preferredClinic,
    notes,
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

  // Update allowed fields
  const allowedFields = [
    "name",
    "email",
    "gender",
    "dateOfBirth",
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
 * @desc    Delete (deactivate) patient
 * @route   DELETE /api/patients/:id
 * @access  Admin
 */
export const deletePatient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find patient
  const patient = await Patient.findById(id);

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Soft delete
  patient.isActive = false;
  await patient.save();

  ApiResponse.success(res, null, "Patient deactivated successfully");
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
export const getPatientTreatments = asyncHandler(async (req, res) => {
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

  // Get treatments
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [treatments, total] = await Promise.all([
    Treatment.find(query)
      .populate("treatmentType", "name category price")
      .populate("clinic", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Treatment.countDocuments(query),
  ]);

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

  // Find patient
  const patient = await Patient.findById(id);

  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  ApiResponse.success(
    res,
    {
      currentMembership: patient.membership || null,
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
