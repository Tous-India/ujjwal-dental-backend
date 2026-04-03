import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Clinic from "./clinic.model.js";
import Appointment from "../appointments/appointment.model.js";

/**
 * CLINIC CONTROLLER
 *
 * Handles clinic locations management
 * Ujjwal Dental has 2 locations: Delhi Road & Parsavnath
 *
 * Features:
 * - CRUD operations for clinics
 * - Operating hours management
 * - Holiday management
 * - Available slot checking
 */

/**
 * @desc    Get all clinics
 * @route   GET /api/clinics
 * @access  Public
 */
export const getAllClinics = asyncHandler(async (req, res) => {
  const { isActive } = req.query;

  // Build query
  const query = {};
  if (isActive !== undefined) {
    query.isActive = isActive === "true";
  }

  // Get all clinics
  const clinics = await Clinic.find(query).sort({ name: 1 });

  ApiResponse.success(res, { clinics }, "Clinics fetched successfully");
});

/**
 * @desc    Get clinic by ID
 * @route   GET /api/clinics/:id
 * @access  Public
 */
export const getClinicById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  ApiResponse.success(res, { clinic }, "Clinic fetched successfully");
});

/**
 * @desc    Create new clinic
 * @route   POST /api/clinics
 * @access  Admin
 */
export const createClinic = asyncHandler(async (req, res) => {
  const { name, address, phone } = req.body;

  // Validate required fields
  if (!name) {
    return ApiResponse.error(res, "Clinic name is required", 400);
  }

  const clinic = await Clinic.create({
    name,
    address,
    phone,
  });

  ApiResponse.created(res, { clinic }, "Clinic created successfully");
});

/**
 * @desc    Update clinic
 * @route   PATCH /api/clinics/:id
 * @access  Admin
 */
export const updateClinic = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find clinic
  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Update allowed fields
  const allowedFields = ["name", "address", "phone", "appointmentSettings", "isActive"];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      clinic[field] = req.body[field];
    }
  });

  // Save changes
  await clinic.save();

  ApiResponse.success(res, { clinic }, "Clinic updated successfully");
});

/**
 * @desc    Delete (deactivate) clinic
 * @route   DELETE /api/clinics/:id
 * @access  Admin
 */
export const removeClinic = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Soft delete
  clinic.isActive = false;
  await clinic.save();

  ApiResponse.success(res, null, "Clinic deactivated successfully");
});

/**
 * @desc    Permanently delete clinic
 * @route   DELETE /api/clinics/:id/permanent
 * @access  Admin
 */
export const permanentDeleteClinic = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const clinic = await Clinic.findById(id);
  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  await Clinic.findByIdAndDelete(id);
  ApiResponse.success(res, null, "Clinic deleted permanently");
});

/**
 * @desc    Get available slots for a date
 * @route   GET /api/clinics/:id/slots?date=2024-01-15
 * @access  Public
 */
export const getAvailableSlots = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  // Validate date
  if (!date) {
    return ApiResponse.error(res, "Date is required", 400);
  }

  const requestedDate = new Date(date);
  if (isNaN(requestedDate.getTime())) {
    return ApiResponse.error(res, "Invalid date format", 400);
  }

  // Check if date is in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (requestedDate < today) {
    return ApiResponse.error(res, "Cannot check slots for past dates", 400);
  }

  // Get available slots using Appointment model's static method
  const slotInfo = await Appointment.getAvailableSlots(id, requestedDate);

  ApiResponse.success(res, slotInfo, "Available slots fetched");
});

/**
 * @desc    Update clinic operating hours
 * @route   PATCH /api/clinics/:id/hours
 * @access  Admin
 */
export const updateOperatingHours = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { operatingHours } = req.body;

  // Validate input
  if (!operatingHours || !Array.isArray(operatingHours)) {
    return ApiResponse.error(res, "Operating hours array is required", 400);
  }

  // Validate each day's hours
  for (const day of operatingHours) {
    if (day.dayOfWeek === undefined || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      return ApiResponse.error(res, "Invalid day of week (must be 0-6)", 400);
    }

    if (day.isOpen && (!day.openTime || !day.closeTime)) {
      return ApiResponse.error(res, "Open and close times are required for open days", 400);
    }
  }

  // Find clinic
  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Update operating hours
  clinic.operatingHours = operatingHours;
  await clinic.save();

  ApiResponse.success(res, { clinic }, "Operating hours updated successfully");
});

/**
 * @desc    Update appointment settings
 * @route   PATCH /api/clinics/:id/settings
 * @access  Admin
 */
export const updateAppointmentSettings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { slotDuration, maxDailyAppointments, opdFee, emergencyOpdFee } = req.body;

  // Find clinic
  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Update settings
  if (slotDuration !== undefined) {
    clinic.appointmentSettings.slotDuration = slotDuration;
  }
  if (maxDailyAppointments !== undefined) {
    clinic.appointmentSettings.maxDailyAppointments = maxDailyAppointments;
  }
  if (opdFee !== undefined) {
    clinic.appointmentSettings.opdFee = opdFee;
  }
  if (emergencyOpdFee !== undefined) {
    clinic.appointmentSettings.emergencyOpdFee = emergencyOpdFee;
  }

  await clinic.save();

  ApiResponse.success(res, { clinic }, "Appointment settings updated successfully");
});

/**
 * @desc    Add holiday to clinic
 * @route   POST /api/clinics/:id/holidays
 * @access  Admin
 */
export const addHoliday = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { date, reason } = req.body;

  // Validate input
  if (!date) {
    return ApiResponse.error(res, "Holiday date is required", 400);
  }

  const holidayDate = new Date(date);
  if (isNaN(holidayDate.getTime())) {
    return ApiResponse.error(res, "Invalid date format", 400);
  }

  // Find clinic
  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Check if holiday already exists
  const existingHoliday = clinic.holidays.find(
    (h) => h.date.toDateString() === holidayDate.toDateString()
  );

  if (existingHoliday) {
    return ApiResponse.error(res, "Holiday already exists for this date", 409);
  }

  // Add holiday
  clinic.holidays.push({ date: holidayDate, reason: reason || "Holiday" });
  await clinic.save();

  ApiResponse.created(
    res,
    { holidays: clinic.holidays },
    "Holiday added successfully"
  );
});

/**
 * @desc    Remove holiday from clinic
 * @route   DELETE /api/clinics/:id/holidays/:holidayId
 * @access  Admin
 */
export const removeHoliday = asyncHandler(async (req, res) => {
  const { id, holidayId } = req.params;

  // Find clinic
  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Find and remove holiday
  const holidayIndex = clinic.holidays.findIndex(
    (h) => h._id.toString() === holidayId
  );

  if (holidayIndex === -1) {
    return ApiResponse.error(res, "Holiday not found", 404);
  }

  clinic.holidays.splice(holidayIndex, 1);
  await clinic.save();

  ApiResponse.success(res, { holidays: clinic.holidays }, "Holiday removed successfully");
});

/**
 * @desc    Get clinic holidays
 * @route   GET /api/clinics/:id/holidays
 * @access  Public
 */
export const getHolidays = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { year } = req.query;

  // Find clinic
  const clinic = await Clinic.findById(id);

  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  let holidays = clinic.holidays;

  // Filter by year if provided
  if (year) {
    const yearInt = parseInt(year);
    holidays = holidays.filter(
      (h) => new Date(h.date).getFullYear() === yearInt
    );
  }

  // Sort by date
  holidays.sort((a, b) => new Date(a.date) - new Date(b.date));

  ApiResponse.success(res, { holidays }, "Holidays fetched successfully");
});

/**
 * @desc    Get today's appointments for a clinic
 * @route   GET /api/clinics/:id/today
 * @access  Admin
 */
export const getTodayAppointments = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify clinic exists
  const clinic = await Clinic.findById(id);
  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Get today's appointments
  const appointments = await Appointment.getTodayAppointments(id);

  // Get summary
  const summary = {
    total: appointments.length,
    scheduled: appointments.filter((a) => a.status === "scheduled").length,
    checkedIn: appointments.filter((a) => a.status === "checked_in").length,
    inProgress: appointments.filter((a) => a.status === "in_progress").length,
    completed: appointments.filter((a) => a.status === "completed").length,
  };

  ApiResponse.success(res, { appointments, summary }, "Today's appointments fetched");
});

/**
 * @desc    Get clinic statistics
 * @route   GET /api/clinics/:id/stats
 * @access  Admin
 */
export const getClinicStats = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  // Verify clinic exists
  const clinic = await Clinic.findById(id);
  if (!clinic) {
    return ApiResponse.error(res, "Clinic not found", 404);
  }

  // Date range
  const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1)); // Start of month
  const end = endDate ? new Date(endDate) : new Date();

  // Get appointment stats
  const appointmentStats = await Appointment.aggregate([
    {
      $match: {
        clinic: clinic._id,
        date: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  // Format stats
  const stats = {
    appointments: {
      total: 0,
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    },
    dateRange: { start, end },
  };

  appointmentStats.forEach((stat) => {
    stats.appointments.total += stat.count;
    switch (stat._id) {
      case "scheduled":
      case "confirmed":
      case "checked_in":
      case "in_progress":
        stats.appointments.scheduled += stat.count;
        break;
      case "completed":
        stats.appointments.completed = stat.count;
        break;
      case "cancelled":
        stats.appointments.cancelled = stat.count;
        break;
      case "no_show":
        stats.appointments.noShow = stat.count;
        break;
    }
  });

  ApiResponse.success(res, { stats }, "Clinic statistics fetched");
});
