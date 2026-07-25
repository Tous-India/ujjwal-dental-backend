import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Report from "./report.model.js";
import { Test } from "../tests/test.model.js";
import Patient from "../patients/patient.model.js";
import { deleteFromCloudinary, getSignedUrl } from "../../middlewares/upload.middleware.js";
import mongoose from "mongoose";

/**
 * REPORT CONTROLLER
 *
 * Handles:
 * - File uploads (X-rays, OPG, lab reports, prescriptions)
 * - Report management
 * - Patient report access
 */

/**
 * @desc    Get all reports
 * @route   GET /api/reports?patient=&category=&test=&treatment=
 * @access  Admin
 */
export const getAllReports = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, patient, category, test, treatment, clinic } = req.query;

  // Build query
  const query = { isActive: true };

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    query.patient = patient;
  }

  if (category) {
    query.category = category;
  }

  if (test && mongoose.Types.ObjectId.isValid(test)) {
    query.test = test;
  }

  if (treatment && mongoose.Types.ObjectId.isValid(treatment)) {
    query.treatment = treatment;
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    query.clinic = clinic;
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [reports, total] = await Promise.all([
    Report.find(query)
      .populate("patient", "name phone")
      .populate("clinic", "name code")
      .populate("uploadedBy", "name")
      .populate("test", "testNumber")
      .populate("treatment", "treatmentNumber")
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
 * @desc    Get report by ID
 * @route   GET /api/reports/:id
 * @access  Admin / Patient (own visible reports)
 */
export const getReportById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  const report = await Report.findById(id)
    .populate("patient", "name phone email")
    .populate("clinic", "name code")
    .populate("appointment")
    .populate("test")
    .populate("treatment")
    .populate("uploadedBy", "name");

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  // Check if patient is trying to access (they can only see their visible reports)
  if (req.patient) {
    if (report.patient._id.toString() !== req.patient._id.toString()) {
      return ApiResponse.error(res, "Access denied", 403);
    }
    if (!report.isVisibleToPatient) {
      return ApiResponse.error(res, "Report not available", 403);
    }
  }

  ApiResponse.success(res, { report }, "Report fetched successfully");
});

/**
 * @desc    Get report by report number
 * @route   GET /api/reports/number/:reportNumber
 * @access  Admin
 */
export const getReportByNumber = asyncHandler(async (req, res) => {
  const { reportNumber } = req.params;

  const report = await Report.findOne({ reportNumber })
    .populate("patient", "name phone")
    .populate("clinic", "name code")
    .populate("uploadedBy", "name");

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  ApiResponse.success(res, { report }, "Report fetched successfully");
});

/**
 * @desc    Upload new report
 * @route   POST /api/reports
 * @access  Admin
 *
 * Note: This endpoint uses uploadSingle('file') middleware
 * File is uploaded to Cloudinary and URL is stored in database
 */
export const uploadReport = asyncHandler(async (req, res) => {
  const {
    patient,
    clinic,
    appointment,
    test,
    treatment,
    title,
    description,
    category,
    reportDate,
    isVisibleToPatient,
    notes,
    tags,
    descriptions,
  } = req.body;

  // Validation
  if (!patient || !title || !category) {
    return ApiResponse.error(res, "Patient, title and category are required", 400);
  }

  // Check if at least one file was uploaded
  if (!req.uploadedFiles || req.uploadedFiles.length === 0) {
    return ApiResponse.error(res, "At least one file is required", 400);
  }

  // Verify patient exists
  const patientDoc = await Patient.findById(patient);
  if (!patientDoc) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // descriptions may arrive as a JSON string (FormData) or an array, one per uploaded file
  let descriptionsArr = [];
  if (descriptions) {
    try {
      descriptionsArr = Array.isArray(descriptions) ? descriptions : JSON.parse(descriptions);
    } catch {
      descriptionsArr = [];
    }
  }

  const files = req.uploadedFiles.map((f, index) => ({
    url: f.url,
    publicId: f.publicId,
    fileName: f.fileName,
    fileSize: f.fileSize,
    fileType: f.fileType,
    thumbnailUrl: f.thumbnailUrl,
    description: descriptionsArr[index] || "",
  }));

  // Create report
  const report = await Report.create({
    patient,
    clinic,
    appointment,
    test,
    treatment,
    title: title.trim(),
    description,
    category,
    reportDate: reportDate ? new Date(reportDate) : new Date(),
    isVisibleToPatient: isVisibleToPatient !== "false",
    notes,
    tags: tags ? (Array.isArray(tags) ? tags : tags.split(",").map((t) => t.trim())) : [],
    files,
    uploadedBy: req.user._id,
  });

  // If linked to a test, update the test's report field
  if (test) {
    await Test.findByIdAndUpdate(test, { report: report._id });
  }

  // Populate for response
  const populatedReport = await Report.findById(report._id)
    .populate("patient", "name phone")
    .populate("clinic", "name code")
    .populate("uploadedBy", "name");

  ApiResponse.created(res, { report: populatedReport }, "Report uploaded successfully");
});

/**
 * @desc    Update report details
 * @route   PATCH /api/reports/:id
 * @access  Admin
 */
export const updateReport = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  const report = await Report.findById(id);

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  // Update allowed fields
  const allowedFields = ["title", "category", "description", "isVisibleToPatient", "notes", "tags", "reportDate"];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      report[field] = req.body[field];
    }
  });

  await report.save();

  const updatedReport = await Report.findById(id)
    .populate("patient", "name phone")
    .populate("uploadedBy", "name");

  ApiResponse.success(res, { report: updatedReport }, "Report updated successfully");
});

/**
 * @desc    Add tags to report
 * @route   POST /api/reports/:id/tags
 * @access  Admin
 */
export const addTags = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  if (!tags || !Array.isArray(tags)) {
    return ApiResponse.error(res, "Tags array is required", 400);
  }

  const report = await Report.findById(id);

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  await report.addTags(tags);

  ApiResponse.success(res, { report }, "Tags added successfully");
});

/**
 * @desc    Toggle report visibility to patient
 * @route   PATCH /api/reports/:id/visibility
 * @access  Admin
 */
export const toggleVisibility = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isVisible } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  const report = await Report.findById(id);

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  if (isVisible === true || isVisible === "true") {
    await report.showToPatient();
  } else {
    await report.hideFromPatient();
  }

  ApiResponse.success(
    res,
    { report },
    `Report is now ${report.isVisibleToPatient ? "visible" : "hidden"} to patient`
  );
});

/**
 * @desc    Delete report (soft delete)
 * @route   DELETE /api/reports/:id
 * @access  Admin
 */
export const deleteReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { hardDelete } = req.query;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  const report = await Report.findById(id);

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  if (hardDelete === "true") {
    // Hard delete - remove from Cloudinary and database
    try {
      await deleteFromCloudinary(report.file.publicId);
    } catch (cloudinaryError) {
      console.error("Failed to delete from Cloudinary:", cloudinaryError);
      // Continue with database deletion even if Cloudinary fails
    }

    await Report.findByIdAndDelete(id);

    ApiResponse.success(res, null, "Report permanently deleted");
  } else {
    // Soft delete
    await report.softDelete();

    ApiResponse.success(res, null, "Report deleted successfully");
  }
});

/**
 * @desc    Download report
 * @route   GET /api/reports/:id/download
 * @access  Admin / Patient (own visible reports)
 */
export const downloadReport = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  const report = await Report.findById(id);

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  // Check if patient is trying to access
  if (req.patient) {
    if (report.patient.toString() !== req.patient._id.toString()) {
      return ApiResponse.error(res, "Access denied", 403);
    }
    if (!report.isVisibleToPatient) {
      return ApiResponse.error(res, "Report not available", 403);
    }
  }

  // Generate signed URL for secure access
  // Files are uploaded as 'image' resource type in Cloudinary (including PDFs)
  const signedUrl = report.file.publicId
    ? getSignedUrl(report.file.publicId, false)
    : report.file.url;

  ApiResponse.success(
    res,
    {
      downloadUrl: signedUrl,
      fileName: report.file.fileName,
      fileType: report.file.fileType,
    },
    "Download URL generated"
  );
});

/**
 * @desc    Get patient's reports
 * @route   GET /api/reports/patient/:patientId
 * @access  Admin / Patient (own reports)
 */
export const getPatientReports = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { category, isPatient } = req.query;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  // Check if patient is trying to access someone else's reports
  if (req.patient && req.patient._id.toString() !== patientId) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  const options = {
    isPatient: req.patient !== undefined || isPatient === "true",
    category,
  };

  const reports = await Report.getPatientReports(patientId, options);

  ApiResponse.success(res, { reports }, "Patient reports fetched successfully");
});

/**
 * @desc    Get patient's reports grouped by category
 * @route   GET /api/reports/patient/:patientId/by-category
 * @access  Admin
 */
export const getPatientReportsByCategory = asyncHandler(async (req, res) => {
  const { patientId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  const reportsByCategory = await Report.getReportsByCategory(patientId);

  ApiResponse.success(res, { reportsByCategory }, "Reports grouped by category fetched successfully");
});

/**
 * @desc    Replace report file
 * @route   PUT /api/reports/:id/file
 * @access  Admin
 *
 * Note: Uses uploadSingle('file') middleware
 */
export const replaceReportFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid report ID", 400);
  }

  if (!req.uploadedFile) {
    return ApiResponse.error(res, "New file is required", 400);
  }

  const report = await Report.findById(id);

  if (!report) {
    return ApiResponse.error(res, "Report not found", 404);
  }

  // Delete old file from Cloudinary
  try {
    await deleteFromCloudinary(report.file.publicId);
  } catch (cloudinaryError) {
    console.error("Failed to delete old file from Cloudinary:", cloudinaryError);
  }

  // Update with new file
  report.file = {
    url: req.uploadedFile.url,
    publicId: req.uploadedFile.publicId,
    fileName: req.uploadedFile.fileName,
    fileSize: req.uploadedFile.fileSize,
    fileType: req.uploadedFile.fileType,
    thumbnailUrl: req.uploadedFile.thumbnailUrl,
  };

  await report.save();

  const updatedReport = await Report.findById(id)
    .populate("patient", "name phone")
    .populate("uploadedBy", "name");

  ApiResponse.success(res, { report: updatedReport }, "Report file replaced successfully");
});
