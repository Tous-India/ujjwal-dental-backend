import Permission from "../modules/permissions/permission.model.js";

/**
 * PERMISSION MIDDLEWARE (Phase 1 -- built and unit-tested in isolation only)
 *
 * Looks up the authenticated staff user's role+module Permission document
 * and checks the requested action flag. This is NOT wired into any existing
 * route yet -- every current route still enforces access via restrictTo()/
 * adminOnly. Phase 2 will migrate specific routes over to this, one at a
 * time, replacing their existing guard.
 *
 * Must run after authProtect (or anyAuth) so req.user is populated.
 */
export const checkPermission = (module, action) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const perm = await Permission.findOne({ role: req.user.role, module });

    if (!perm || !perm[action]) {
      return res.status(403).json({
        success: false,
        message: `No ${action} permission for ${module}`,
      });
    }

    next();
  };
};

/**
 * Staff-scoped permission check for routes shared by staff AND patients/public.
 *
 * Some endpoints legitimately serve more than one kind of caller -- e.g.
 * POST /api/appointments (optionalAuth: public/patient self-booking AND admin
 * walk-in booking) and PATCH /api/patients/:id (anyAuth + patientSelfOrAdmin:
 * a patient editing their OWN profile, or staff editing anyone's).
 *
 * Applying the plain checkPermission() to those would 401/403 every legitimate
 * patient request, because patients authenticate as req.patient and have no
 * role in the staff permission matrix. This variant enforces the matrix ONLY
 * when the caller is a staff user, and defers to the route's own existing
 * ownership guard (patientSelfOrAdmin / appointmentSelfOrAdmin) otherwise.
 *
 * It never GRANTS access -- it only adds a staff-side restriction on top of
 * whatever guard already runs.
 */
export const checkPermissionIfStaff = (module, action) => {
  const staffCheck = checkPermission(module, action);
  return (req, res, next) => {
    // Not a staff request (patient token, or unauthenticated public route) --
    // leave authorization to the route's existing guard.
    if (!req.user) return next();
    return staffCheck(req, res, next);
  };
};

export default checkPermission;
