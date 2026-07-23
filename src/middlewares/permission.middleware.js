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

export default checkPermission;
