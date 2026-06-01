import jwt from "jsonwebtoken";
import User from "../modules/users/user.model.js";
import Patient from "../modules/patients/patient.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";

/**
 * AUTH MIDDLEWARE
 *
 * Middleware functions for authentication and authorization
 * - authProtect: Verify JWT token for admin users
 * - patientProtect: Verify JWT token for patients
 * - adminOnly: Allow only admin users
 */

/**
 * Protect routes for Admin/Staff users
 *
 * This middleware:
 * 1. Extracts token from Authorization header
 * 2. Verifies the token
 * 3. Fetches user from database
 * 4. Attaches user to request object
 */
const authProtect = async (req, res, next) => {
  try {
    let token;

    if (req.cookies?.admin_token) {
      token = req.cookies.admin_token;
    } else if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return ApiResponse.error(res, "Not authorized, token missing", 401);
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // System admin token (for initial setup)
    if (decoded.type === "system" && decoded.role === "admin") {
      req.user = {
        role: "admin",
        system: true,
      };
      return next();
    }

    // Normal user token
    if (!decoded.id) {
      return ApiResponse.error(res, "Invalid token payload", 401);
    }

    // Fetch user from database
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return ApiResponse.error(res, "User no longer exists", 401);
    }

    if (!user.isActive) {
      return ApiResponse.error(res, "User account is deactivated", 401);
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return ApiResponse.error(res, "Token has expired, please login again", 401);
    }
    return ApiResponse.error(res, "Not authorized, token invalid", 401);
  }
};

/**
 * Protect routes for Patients
 *
 * Similar to authProtect but for patient authentication
 */
const patientProtect = async (req, res, next) => {
  try {
    let token;

    if (req.cookies?.patient_token) {
      token = req.cookies.patient_token;
    } else if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return ApiResponse.error(res, "Not authorized, token missing", 401);
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if it's a patient token
    if (decoded.type !== "patient") {
      return ApiResponse.error(res, "Invalid token type", 401);
    }

    if (!decoded.id) {
      return ApiResponse.error(res, "Invalid token payload", 401);
    }

    // Fetch patient from database
    const patient = await Patient.findById(decoded.id);

    if (!patient) {
      return ApiResponse.error(res, "Patient not found", 401);
    }

    if (!patient.isActive) {
      return ApiResponse.error(res, "Patient account is deactivated", 401);
    }

    // Attach patient to request
    req.patient = patient;
    req.userType = "patient";
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return ApiResponse.error(res, "Token has expired, please login again", 401);
    }
    return ApiResponse.error(res, "Not authorized, token invalid", 401);
  }
};

/**
 * Allow both Admin and Patient
 *
 * Use this for routes that can be accessed by both
 */
const anyAuth = async (req, res, next) => {
  try {
    let token;

    if (req.cookies?.admin_token) {
      token = req.cookies.admin_token;
    } else if (req.cookies?.patient_token) {
      token = req.cookies.patient_token;
    } else if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return ApiResponse.error(res, "Not authorized, token missing", 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if it's a patient token
    if (decoded.type === "patient") {
      const patient = await Patient.findById(decoded.id);

      if (!patient || !patient.isActive) {
        return ApiResponse.error(res, "Patient not found or inactive", 401);
      }

      req.patient = patient;
      req.userType = "patient";
      return next();
    }

    // Otherwise it's an admin/user token
    const user = await User.findById(decoded.id).select("-password");

    if (!user || !user.isActive) {
      return ApiResponse.error(res, "User not found or inactive", 401);
    }

    req.user = user;
    req.userType = "admin";
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return ApiResponse.error(res, "Token has expired, please login again", 401);
    }
    return ApiResponse.error(res, "Not authorized, token invalid", 401);
  }
};

/**
 * Admin Only Middleware
 *
 * Use after authProtect to ensure only admins can access
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return ApiResponse.error(res, "Only admins can access this resource", 403);
  }
  next();
};

/**
 * Optional Authentication
 *
 * Tries to authenticate but doesn't fail if no token
 * Useful for public routes that show extra info for logged-in users
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.cookies?.admin_token) {
      token = req.cookies.admin_token;
    } else if (req.cookies?.patient_token) {
      token = req.cookies.patient_token;
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer")) {
        token = authHeader.split(" ")[1];
      }
    }

    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type === "patient") {
        req.patient = await Patient.findById(decoded.id);
        req.userType = "patient";
      } else if (decoded.id) {
        req.user = await User.findById(decoded.id).select("-password");
        req.userType = "admin";
      }
    } catch {
      // Token invalid, continue without auth
    }

    next();
  } catch (error) {
    next();
  }
};

// Export all middleware functions
export { authProtect, patientProtect, anyAuth, adminOnly, optionalAuth };
export default authProtect;
