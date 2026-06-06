import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Lab from "./lab.model.js";
import mongoose from "mongoose";

/**
 * LAB CONTROLLER (admin-only)
 * Manage dental labs and their procedure price lists.
 */

/**
 * @desc    List labs (optionally filter by status)
 * @route   GET /api/labs?status=active
 * @access  Admin
 */
export const getAllLabs = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = {};
  if (status) query.status = status;

  const labs = await Lab.find(query).sort({ name: 1 });

  ApiResponse.success(res, { labs }, "Labs fetched successfully");
});

/**
 * @desc    Get a single lab
 * @route   GET /api/labs/:id
 * @access  Admin
 */
export const getLabById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid lab ID", 400);
  }

  const lab = await Lab.findById(id);
  if (!lab) {
    return ApiResponse.error(res, "Lab not found", 404);
  }

  ApiResponse.success(res, { lab }, "Lab fetched successfully");
});

/**
 * @desc    Create a lab
 * @route   POST /api/labs
 * @access  Admin
 */
export const createLab = asyncHandler(async (req, res) => {
  const { name, contactPerson, phone, address, status, procedures } = req.body;

  if (!name || !name.trim()) {
    return ApiResponse.error(res, "Lab name is required", 400);
  }

  const lab = await Lab.create({
    name: name.trim(),
    contactPerson,
    phone,
    address,
    status: status === "inactive" ? "inactive" : "active",
    procedures: Array.isArray(procedures) ? procedures : [],
  });

  ApiResponse.created(res, { lab }, "Lab created successfully");
});

/**
 * @desc    Update a lab (details and/or full procedures list)
 * @route   PATCH /api/labs/:id
 * @access  Admin
 */
export const updateLab = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid lab ID", 400);
  }

  const lab = await Lab.findById(id);
  if (!lab) {
    return ApiResponse.error(res, "Lab not found", 404);
  }

  const allowed = ["name", "contactPerson", "phone", "address", "status", "procedures"];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) {
      lab[field] = req.body[field];
    }
  });

  await lab.save();

  ApiResponse.success(res, { lab }, "Lab updated successfully");
});

/**
 * @desc    Soft-delete a lab (mark inactive — never removes data)
 * @route   DELETE /api/labs/:id
 * @access  Admin
 */
export const deleteLab = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid lab ID", 400);
  }

  const lab = await Lab.findById(id);
  if (!lab) {
    return ApiResponse.error(res, "Lab not found", 404);
  }

  lab.status = "inactive";
  await lab.save();

  ApiResponse.success(res, { lab }, "Lab marked inactive");
});
