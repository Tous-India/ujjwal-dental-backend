import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import User from "./user.model.js";
import mongoose from "mongoose";

/**
 * USER CONTROLLER
 *
 * Handles admin/staff user management:
 * - CRUD operations for admin users
 * - Profile management
 * - Password changes
 */

/**
 * @desc    List users selectable as blog authors
 * @route   GET /api/users/blog-authors
 * @access  Admin / Blog Editor (blogs.view permission)
 *
 * Returns active users whose role permits blog management:
 * admin, blog_editor, and clinic_manager all have blog permissions.
 */
export const getBlogAuthors = asyncHandler(async (req, res) => {
  const authors = await User.find({
    role: { $in: ["admin", "blog_editor", "clinic_manager"] },
    isActive: true,
  })
    .select("_id name email")
    .sort({ name: 1 });

  ApiResponse.success(res, { authors }, "Blog authors fetched successfully");
});

/**
 * @desc    Get all users (admin/staff)
 * @route   GET /api/users
 * @access  Admin
 */
export const getAllUsers = asyncHandler(async (req, res) => {
  // Get query parameters for filtering and pagination
  const { page = 1, limit = 10, search, isActive } = req.query;

  // Build query
  const query = {};

  // Filter by active status
  if (isActive !== undefined) {
    query.isActive = isActive === "true";
  }

  // Search by name, email, or phone
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get users with pagination
  const users = await User.find(query)
    .select("-password -refreshToken")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  // Get total count for pagination
  const total = await User.countDocuments(query);

  // Return paginated response
  ApiResponse.paginated(res, users, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get current logged in user
 * @route   GET /api/users/me
 * @access  Private
 */
export const getMe = asyncHandler(async (req, res) => {
  // User is already attached to req by auth middleware
  const user = await User.findById(req.user._id).select("-password -refreshToken");

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  ApiResponse.success(res, { user }, "Profile fetched successfully");
});

/**
 * @desc    Update current user profile
 * @route   PATCH /api/users/me
 * @access  Private
 */
export const updateMe = asyncHandler(async (req, res) => {
  const { name, email, phone } = req.body;

  // Find current user
  const user = await User.findById(req.user._id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Check if email is already taken by another user
  if (email && email !== user.email) {
    const emailExists = await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } });
    if (emailExists) {
      return ApiResponse.error(res, "Email is already in use", 400);
    }
    user.email = email.toLowerCase();
  }

  // Check if phone is already taken by another user
  if (phone && phone !== user.phone) {
    const phoneExists = await User.findOne({ phone, _id: { $ne: user._id } });
    if (phoneExists) {
      return ApiResponse.error(res, "Phone number is already in use", 400);
    }
    user.phone = phone;
  }

  // Update name if provided
  if (name) {
    user.name = name;
  }

  // Save changes
  await user.save();

  // Return updated user (without sensitive fields)
  const updatedUser = await User.findById(user._id).select("-password -refreshToken");

  ApiResponse.success(res, { user: updatedUser }, "Profile updated successfully");
});

/**
 * @desc    Change current user password
 * @route   PATCH /api/users/me/password
 * @access  Private
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate input
  if (!currentPassword || !newPassword) {
    return ApiResponse.error(res, "Please provide current and new password", 400);
  }

  // Validate new password length
  if (newPassword.length < 6) {
    return ApiResponse.error(res, "New password must be at least 6 characters", 400);
  }

  // Get user with password
  const user = await User.findById(req.user._id).select("+password");

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Verify current password
  const isMatch = await user.comparePassword(currentPassword);

  if (!isMatch) {
    return ApiResponse.error(res, "Current password is incorrect", 401);
  }

  // Update password (will be hashed by pre-save middleware)
  user.password = newPassword;
  await user.save();

  ApiResponse.success(res, null, "Password changed successfully");
});

/**
 * @desc    Get user by ID
 * @route   GET /api/users/:id
 * @access  Admin
 */
export const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find user by ID (exclude password)
  const user = await User.findById(id).select("-password -refreshToken");

  // Handle not found
  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Return user
  ApiResponse.success(res, { user }, "User fetched successfully");
});

/**
 * @desc    Create new user (admin/staff)
 * @route   POST /api/users
 * @access  Admin
 */
export const createUser = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role } = req.body;

  // Validate required fields
  if (!name || !email || !phone || !password) {
    return ApiResponse.error(res, "Please provide name, email, phone, and password", 400);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return ApiResponse.error(res, "Please provide a valid email address", 400);
  }

  // Validate phone format (10 digits for India)
  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return ApiResponse.error(res, "Please provide a valid 10-digit phone number", 400);
  }

  // Validate password length
  if (password.length < 6) {
    return ApiResponse.error(res, "Password must be at least 6 characters", 400);
  }

  // Check if email already exists
  const emailExists = await User.findOne({ email: email.toLowerCase() });
  if (emailExists) {
    return ApiResponse.error(res, "Email is already registered", 400);
  }

  // Check if phone already exists
  const phoneExists = await User.findOne({ phone });
  if (phoneExists) {
    return ApiResponse.error(res, "Phone number is already registered", 400);
  }

  // Create user (password will be hashed by pre-save middleware)
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone,
    password,
    role: role || "admin",
  });

  // Return created user (without password)
  const createdUser = await User.findById(user._id).select("-password -refreshToken");

  ApiResponse.created(res, { user: createdUser }, "User created successfully");
});

/**
 * @desc    Update user by ID
 * @route   PATCH /api/users/:id
 * @access  Admin
 */
export const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, isActive, role } = req.body;

  // Find user
  const user = await User.findById(id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Check if email is already taken by another user
  if (email && email.toLowerCase() !== user.email) {
    const emailExists = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
    if (emailExists) {
      return ApiResponse.error(res, "Email is already in use", 400);
    }
    user.email = email.toLowerCase();
  }

  // Check if phone is already taken by another user
  if (phone && phone !== user.phone) {
    const phoneExists = await User.findOne({ phone, _id: { $ne: id } });
    if (phoneExists) {
      return ApiResponse.error(res, "Phone number is already in use", 400);
    }
    user.phone = phone;
  }

  // Update other fields
  if (name !== undefined) user.name = name;
  if (isActive !== undefined) user.isActive = isActive;
  if (role !== undefined) user.role = role;

  // Save changes
  await user.save();

  // Return updated user (without password)
  const updatedUser = await User.findById(user._id).select("-password -refreshToken");

  ApiResponse.success(res, { user: updatedUser }, "User updated successfully");
});

/**
 * @desc    Delete (deactivate) user
 * @route   DELETE /api/users/:id
 * @access  Admin
 */
export const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find user
  const user = await User.findById(id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Prevent deleting yourself
  if (req.user._id.toString() === id) {
    return ApiResponse.error(res, "You cannot delete your own account", 400);
  }

  // Soft delete - set isActive = false
  user.isActive = false;
  await user.save();

  ApiResponse.success(res, null, "User deactivated successfully");
});

/**
 * @desc    Reactivate a deactivated user
 * @route   PATCH /api/users/:id/reactivate
 * @access  Admin
 */
export const reactivateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find user
  const user = await User.findById(id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  // Reactivate user
  user.isActive = true;
  await user.save();

  // Return updated user
  const reactivatedUser = await User.findById(user._id).select("-password -refreshToken");

  ApiResponse.success(res, { user: reactivatedUser }, "User reactivated successfully");
});

/**
 * @desc    Permanently delete a user
 * @route   DELETE /api/users/:id/permanent
 * @access  Admin
 */
export const permanentDeleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid user ID", 400);
  }

  // Prevent deleting yourself
  if (req.user._id.toString() === id) {
    return ApiResponse.error(res, "You cannot permanently delete your own account", 400);
  }

  const user = await User.findById(id);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  await User.findByIdAndDelete(id);

  ApiResponse.success(res, null, "User deleted permanently");
});
