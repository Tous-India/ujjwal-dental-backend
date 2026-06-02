import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { TestMaster, Test } from "./test.model.js";
import Patient from "../patients/patient.model.js";
import mongoose from "mongoose";

/**
 * TEST CONTROLLER
 *
 * Handles:
 * - Test Master (catalog of available tests)
 * - Test Instances (actual tests ordered for patients)
 */

// ==================== TEST MASTER (Catalog) ====================

/**
 * @desc    Get all test types (catalog)
 * @route   GET /api/tests/master
 * @access  Admin/Staff
 */
export const getAllTestTypes = asyncHandler(async (req, res) => {
  const { active = "true", category, sort = "name", order = "asc" } = req.query;

  // Build filter
  const filter = {};
    if (active === "true") {
    filter.isActive = true;
  }
  if (active === "false") {
    filter.isActive = false;
  }

  if (category) {
    filter.category = category;
  }

  // Sort options
  const sortOptions = {};
  const sortOrder = order === "desc" ? -1 : 1;
  const allowedSortFields = ["name", "price", "createdAt"];

  if (allowedSortFields.includes(sort)) {
    sortOptions[sort] = sortOrder;
  } else {
    sortOptions.name = 1;
  }

  // Query database
  const testTypes = await TestMaster.find(filter).sort(sortOptions);

  ApiResponse.success(res, { testTypes }, "Test types fetched successfully");
});

/**
 * @desc    Get test type by ID
 * @route   GET /api/tests/master/:id
 * @access  Admin/Staff
 */
export const getTestTypeById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test type ID", 400);
  }

  const testType = await TestMaster.findById(id);

  if (!testType) {
    return ApiResponse.error(res, "Test type not found", 404);
  }

  ApiResponse.success(res, { testType }, "Test type fetched successfully");
});

/**
 * @desc    Create new test type
 * @route   POST /api/tests/master
 * @access  Admin
 */
export const createTestType = asyncHandler(async (req, res) => {
  let { name, code, category, description, price, isInHouse, referredLab, turnaroundTime } = req.body;

  // Validation
  if (!name || !code || !category || price === undefined) {
    return ApiResponse.error(res, "Name, code, category and price are required", 400);
  }

  // Normalize
  name = name.trim();
  code = code.trim().toUpperCase();
  category = category.trim().toLowerCase();
  price = Number(price);

  if (Number.isNaN(price)) {
    return ApiResponse.error(res, "Price must be a number", 400);
  }

  // Check duplicate code
  const existing = await TestMaster.findOne({ code });
  if (existing) {
    return ApiResponse.error(res, "Test type with this code already exists", 409);
  }

  // Create test type
  const testType = await TestMaster.create({
    name,
    code,
    category,
    description,
    price,
    isInHouse: isInHouse !== false,
    referredLab,
    turnaroundTime: turnaroundTime ? Number(turnaroundTime) : 24,
  });

  ApiResponse.created(res, { testType }, "Test type created successfully");
});

/**
 * @desc    Update test type
 * @route   PATCH /api/tests/master/:id
 * @access  Admin
 */
export const updateTestType = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test type ID", 400);
  }

  const testType = await TestMaster.findById(id);

  if (!testType) {
    return ApiResponse.error(res, "Test type not found", 404);
  }

  // Update allowed fields
  const allowedFields = ["name", "description", "price", "isInHouse", "referredLab", "turnaroundTime", "isActive"];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      testType[field] = req.body[field];
    }
  });

  await testType.save();

  ApiResponse.success(res, { testType }, "Test type updated successfully");
});

/**
 * @desc    Delete (deactivate) test type
 * @route   DELETE /api/tests/master/:id
 * @access  Admin
 */
export const deleteTestType = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test type ID", 400);
  }

  const testType = await TestMaster.findById(id);

  if (!testType) {
    return ApiResponse.error(res, "Test type not found", 404);
  }

  // Soft delete
  testType.isActive = false;
  await testType.save();

  ApiResponse.success(res, null, "Test type deactivated successfully");
});

// ==================== TEST INSTANCES ====================

/**
 * @desc    Get all test instances
 * @route   GET /api/tests?patient=&status=&clinic=
 * @access  Admin
 */
export const getAllTests = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, patient, status, clinic } = req.query;

  // Build query
  const query = {};

  if (patient && mongoose.Types.ObjectId.isValid(patient)) {
    query.patient = patient;
  }

  if (status) {
    query.status = status;
  }

  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    query.clinic = clinic;
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [tests, total] = await Promise.all([
    Test.find(query)
      .populate("patient", "name phone")
      .populate("testType", "name code category price")
      .populate("clinic", "name code")
      .populate("orderedBy", "name")
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
 * @desc    Get test by ID
 * @route   GET /api/tests/:id
 * @access  Admin
 */
export const getTestById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test ID", 400);
  }

  const test = await Test.findById(id)
    .populate("patient", "name phone email hasMembership currentDiscount")
    .populate("testType", "name code category price turnaroundTime")
    .populate("clinic", "name code")
    .populate("appointment")
    .populate("treatment")
    .populate("report")
    .populate("orderedBy", "name");

  if (!test) {
    return ApiResponse.error(res, "Test not found", 404);
  }

  ApiResponse.success(res, { test }, "Test fetched successfully");
});

/**
 * @desc    Order test for patient
 * @route   POST /api/tests
 * @access  Admin
 */
export const createTest = asyncHandler(async (req, res) => {
  const { testType, patient, clinic, appointment, treatment, price, notes } = req.body;

  // Validation
  if (!testType || !patient || !clinic) {
    return ApiResponse.error(res, "Test type, patient and clinic are required", 400);
  }

  // Verify test type exists
  const testMaster = await TestMaster.findById(testType);
  if (!testMaster) {
    return ApiResponse.error(res, "Test type not found", 404);
  }

  // Verify patient exists
  const patientDoc = await Patient.findById(patient);
  if (!patientDoc) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Calculate price with membership discount
  let finalPrice = price || testMaster.price;
  let discountPercentage = 0;
  let discountReason = "";

  if (patientDoc.hasMembership) {
    discountPercentage = patientDoc.currentDiscount || 0;
    discountReason = "Membership discount";
  }

  // Create test
  const test = await Test.create({
    testType,
    patient,
    clinic,
    appointment,
    treatment,
    price: finalPrice,
    discount: {
      percentage: discountPercentage,
      reason: discountReason,
    },
    notes,
    orderedBy: req.user?._id,
  });

  // Populate for response
  const populatedTest = await Test.findById(test._id)
    .populate("testType", "name code")
    .populate("patient", "name phone");

  ApiResponse.created(res, { test: populatedTest }, "Test ordered successfully");
});

/**
 * @desc    Update test instance
 * @route   PATCH /api/tests/:id
 * @access  Admin
 */
export const updateTest = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test ID", 400);
  }

  const test = await Test.findById(id);

  if (!test) {
    return ApiResponse.error(res, "Test not found", 404);
  }

  // Update allowed fields
  const allowedFields = ["notes", "price", "discount"];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      test[field] = req.body[field];
    }
  });

  await test.save();

  const updatedTest = await Test.findById(id)
    .populate("testType", "name code")
    .populate("patient", "name phone");

  ApiResponse.success(res, { test: updatedTest }, "Test updated successfully");
});

/**
 * @desc    Update test status
 * @route   PATCH /api/tests/:id/status
 * @access  Admin
 */
export const updateTestStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test ID", 400);
  }

  if (!status) {
    return ApiResponse.error(res, "Status is required", 400);
  }

  const validStatuses = ["ordered", "sample_collected", "processing", "completed", "cancelled"];
  if (!validStatuses.includes(status)) {
    return ApiResponse.error(res, "Invalid status", 400);
  }

  const test = await Test.findById(id);

  if (!test) {
    return ApiResponse.error(res, "Test not found", 404);
  }

  // Update status using model methods
  switch (status) {
    case "sample_collected":
      await test.collectSample();
      break;
    case "processing":
      await test.startProcessing();
      break;
    case "completed":
      return ApiResponse.error(res, "Use /api/tests/:id/complete endpoint to complete with results", 400);
    case "cancelled":
      return ApiResponse.error(res, "Use /api/tests/:id/cancel endpoint to cancel", 400);
    default:
      test.status = status;
      await test.save();
  }

  ApiResponse.success(res, { test }, "Test status updated successfully");
});

/**
 * @desc    Complete test with results
 * @route   POST /api/tests/:id/complete
 * @access  Admin
 */
export const completeTest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { resultSummary, resultValues, reportId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test ID", 400);
  }

  const test = await Test.findById(id);

  if (!test) {
    return ApiResponse.error(res, "Test not found", 404);
  }

  if (test.status === "completed") {
    return ApiResponse.error(res, "Test is already completed", 400);
  }

  if (test.status === "cancelled") {
    return ApiResponse.error(res, "Cannot complete a cancelled test", 400);
  }

  // Complete test with results
  await test.complete({
    summary: resultSummary,
    values: resultValues,
    reportId,
  });

  const updatedTest = await Test.findById(id)
    .populate("testType", "name code")
    .populate("patient", "name phone")
    .populate("report");

  ApiResponse.success(res, { test: updatedTest }, "Test completed successfully");
});

/**
 * @desc    Cancel test
 * @route   POST /api/tests/:id/cancel
 * @access  Admin
 */
export const cancelTest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test ID", 400);
  }

  const test = await Test.findById(id);

  if (!test) {
    return ApiResponse.error(res, "Test not found", 404);
  }

  if (test.status === "completed") {
    return ApiResponse.error(res, "Cannot cancel a completed test", 400);
  }

  await test.cancel(reason || "Cancelled by admin");

  ApiResponse.success(res, { test }, "Test cancelled successfully");
});

/**
 * @desc    Link report to test
 * @route   PATCH /api/tests/:id/report
 * @access  Admin
 */
export const linkReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reportId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid test ID", 400);
  }

  if (!reportId || !mongoose.Types.ObjectId.isValid(reportId)) {
    return ApiResponse.error(res, "Valid report ID is required", 400);
  }

  const test = await Test.findById(id);

  if (!test) {
    return ApiResponse.error(res, "Test not found", 404);
  }

  test.report = reportId;
  await test.save();

  const updatedTest = await Test.findById(id)
    .populate("testType", "name code")
    .populate("report");

  ApiResponse.success(res, { test: updatedTest }, "Report linked successfully");
});
