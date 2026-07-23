import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Permission from "./permission.model.js";

/**
 * PERMISSION CONTROLLER (admin-only)
 *
 * CRUD for the Permission matrix that will eventually drive checkPermission
 * (Phase 2). Guarded by the existing restrictTo("admin") pattern -- this
 * bootstraps the whole permission system, so it deliberately doesn't gate
 * itself via checkPermission.
 */

/**
 * @desc    Get the full permission matrix (every role+module document)
 * @route   GET /api/permissions
 * @access  Admin
 */
export const getAllPermissions = asyncHandler(async (req, res) => {
  const permissions = await Permission.find().sort({ role: 1, module: 1 });
  ApiResponse.success(res, { permissions }, "Permission matrix fetched successfully");
});

/**
 * @desc    Update one role+module's action flags
 * @route   PATCH /api/permissions/:role/:module
 * @access  Admin
 */
export const updatePermission = asyncHandler(async (req, res) => {
  const { role, module } = req.params;
  const { view, create, edit, delete: del } = req.body;

  const set = {};
  if (view !== undefined) set.view = !!view;
  if (create !== undefined) set.create = !!create;
  if (edit !== undefined) set.edit = !!edit;
  if (del !== undefined) set.delete = !!del;

  if (Object.keys(set).length === 0) {
    return ApiResponse.error(res, "At least one of view/create/edit/delete is required", 400);
  }

  const permission = await Permission.findOneAndUpdate(
    { role, module },
    { $set: set },
    { new: true, upsert: true, runValidators: true }
  );

  ApiResponse.success(res, { permission }, "Permission updated successfully");
});
