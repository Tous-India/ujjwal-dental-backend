import mongoose from "mongoose";

/**
 * PERMISSION MODEL
 *
 * One document per (role, module) pair, holding the 4 CRUD-style action
 * flags for that role within that module. This is the data source the
 * Permission Manager (admin UI, Phase 2) edits and the eventual
 * checkPermission middleware (Phase 2 wiring) reads at request time.
 *
 * Phase 1 note: this model and its seed data exist purely as new, additive
 * plumbing -- nothing in the app reads from this collection yet. Every
 * existing route continues to enforce access via the current restrictTo()/
 * adminOnly hardcoded checks until Phase 2 migrates them over.
 */
const permissionSchema = new mongoose.Schema(
  {
    // Matches User model's role enum values (admin/user/blog_editor/clinic_manager).
    // Not a Mongoose enum here on purpose -- keeps this collection decoupled
    // from having to redeploy if a new role is ever added to User.
    role: {
      type: String,
      required: [true, "Role is required"],
    },

    // e.g. "patients", "appointments", "treatments", "billing", "payments",
    // "blogs", "staff", "settings", "lab", "reports", "memberships",
    // "notifications", "clinics", "enquiries", "dashboard".
    module: {
      type: String,
      required: [true, "Module is required"],
    },

    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One document per (role, module) pair.
permissionSchema.index({ role: 1, module: 1 }, { unique: true });

const Permission = mongoose.model("Permission", permissionSchema);

export default Permission;
