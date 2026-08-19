import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import ExternalIncome from "./externalIncome.model.js";
import User from "../users/user.model.js";
import mongoose from "mongoose";
import { parseIstDateRange } from "../../utils/istDateRange.js";

/**
 * @desc    List external income records
 * @route   GET /api/external-income
 * @access  checkPermission("external_income","view")
 *
 * Filters: from, to, includeVoided
 * Default: excludes voided records. Pass includeVoided=true to include them.
 */
export const getExternalIncomes = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    from,
    to,
    includeVoided,
  } = req.query;

  const query = {};

  if (includeVoided === "true") {
    // No isVoided filter — return all
  } else {
    query.isVoided = { $ne: true };
  }

  if (from || to) {
    query.date = parseIstDateRange(from, to);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [records, total] = await Promise.all([
    ExternalIncome.find(query)
      .populate("doctor", "name email role")
      .populate("recordedBy", "name email role")
      .populate("voidedBy", "name email role")
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    ExternalIncome.countDocuments(query),
  ]);

  ApiResponse.paginated(
    res,
    records,
    { page: parseInt(page), limit: parseInt(limit), total },
    "External income records fetched successfully"
  );
});

/**
 * @desc    Create an external income record
 * @route   POST /api/external-income
 * @access  checkPermission("external_income","create")
 *
 * recordedBy is always set server-side from req.user._id — any client-sent
 * value is silently ignored (stripped before save).
 */
export const createExternalIncome = asyncHandler(async (req, res) => {
  // Strip recordedBy from body — always server-set
  const { recordedBy: _stripped, isVoided: _v, voidedAt: _va, voidedBy: _vb, voidReason: _vr, ...body } = req.body;

  const { date, amount, doctor, doctorName, clinicName, treatment, notes } = body;

  if (!date) return ApiResponse.error(res, "date is required", 400);
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
    return ApiResponse.error(res, "amount must be a number greater than 0", 400);
  if (!clinicName || !clinicName.trim())
    return ApiResponse.error(res, "clinicName is required", 400);
  if (!treatment || !treatment.trim())
    return ApiResponse.error(res, "treatment is required", 400);

  const hasDoctor = doctor && mongoose.Types.ObjectId.isValid(doctor);
  const hasDoctorName = doctorName && doctorName.trim().length > 0;
  if (!hasDoctor && !hasDoctorName) {
    return ApiResponse.error(
      res,
      "Either doctor (staff ObjectId) or doctorName (free text) must be provided",
      400
    );
  }
  if (doctor && !mongoose.Types.ObjectId.isValid(doctor)) {
    return ApiResponse.error(res, "Invalid doctor user ID", 400);
  }

  const record = await ExternalIncome.create({
    date: new Date(date),
    amount: Number(amount),
    doctor: hasDoctor ? doctor : null,
    doctorName: hasDoctorName ? doctorName.trim() : "",
    clinicName: clinicName.trim(),
    treatment: treatment.trim(),
    notes: notes ? notes.trim() : "",
    recordedBy: req.user._id, // always server-set
  });

  const populated = await ExternalIncome.findById(record._id)
    .populate("doctor", "name email role")
    .populate("recordedBy", "name email role")
    .lean();

  ApiResponse.created(res, { record: populated }, "External income recorded successfully");
});

/**
 * @desc    Update an external income record
 * @route   PUT /api/external-income/:id
 * @access  checkPermission("external_income","edit")
 *
 * Cannot update a voided record. Cannot change recordedBy.
 */
export const updateExternalIncome = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return ApiResponse.error(res, "Invalid external income ID", 400);

  const record = await ExternalIncome.findById(id);
  if (!record) return ApiResponse.error(res, "External income record not found", 404);
  if (record.isVoided)
    return ApiResponse.error(res, "Cannot update a voided record", 400);

  // Strip fields that must never be editable
  const {
    recordedBy: _r,
    isVoided: _v,
    voidedAt: _va,
    voidedBy: _vb,
    voidReason: _vr,
    ...updates
  } = req.body;

  if (updates.doctor && !mongoose.Types.ObjectId.isValid(updates.doctor)) {
    return ApiResponse.error(res, "Invalid doctor user ID", 400);
  }
  if (updates.date) updates.date = new Date(updates.date);
  if (updates.amount !== undefined) {
    if (isNaN(Number(updates.amount)) || Number(updates.amount) <= 0)
      return ApiResponse.error(res, "amount must be a number greater than 0", 400);
    updates.amount = Number(updates.amount);
  }

  Object.assign(record, updates);
  await record.save();

  const populated = await ExternalIncome.findById(id)
    .populate("doctor", "name email role")
    .populate("recordedBy", "name email role")
    .lean();

  ApiResponse.success(res, { record: populated }, "External income updated successfully");
});

/**
 * @desc    Void (soft-delete) an external income record
 * @route   POST /api/external-income/:id/void
 * @access  checkPermission("external_income","delete")
 *
 * Mirrors the expense void pattern. Requires a voidReason of at least 10 chars.
 */
export const voidExternalIncome = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return ApiResponse.error(res, "Invalid external income ID", 400);

  const { voidReason } = req.body;
  if (!voidReason || voidReason.trim().length < 10)
    return ApiResponse.error(res, "A void reason of at least 10 characters is required", 400);

  const record = await ExternalIncome.findById(id);
  if (!record) return ApiResponse.error(res, "External income record not found", 404);
  if (record.isVoided) return ApiResponse.error(res, "Record is already voided", 400);

  await ExternalIncome.updateOne(
    { _id: id },
    {
      $set: {
        isVoided: true,
        voidedAt: new Date(),
        voidedBy: req.user._id,
        voidReason: voidReason.trim(),
      },
    }
  );

  const updated = await ExternalIncome.findById(id)
    .populate("doctor", "name email role")
    .populate("recordedBy", "name email role")
    .populate("voidedBy", "name email role")
    .lean();

  ApiResponse.success(res, { record: updated }, "External income record voided successfully");
});

/**
 * @desc    Summary stats for external income (sum of non-voided records in date range)
 * @route   GET /api/external-income/stats
 * @access  checkPermission("external_income","view")
 */
export const getExternalIncomeStats = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const match = { isVoided: false };
  if (from || to) match.date = parseIstDateRange(from, to);

  const [agg] = await ExternalIncome.aggregate([
    { $match: match },
    { $group: { _id: null, totalAmount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  ApiResponse.success(res, {
    totalAmount: agg?.totalAmount || 0,
    count: agg?.count || 0,
  }, "External income stats fetched successfully");
});

/**
 * @desc    Staff list for the doctor dropdown
 * @route   GET /api/external-income/staff
 * @access  checkPermission("external_income","view")
 */
export const getStaffList = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true })
    .select("name email role")
    .sort({ name: 1 })
    .lean();

  ApiResponse.success(res, { users });
});
