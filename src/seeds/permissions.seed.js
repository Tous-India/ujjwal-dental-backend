import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Permission from "../modules/permissions/permission.model.js";

dotenv.config();

/**
 * Seed the Permission matrix to EXACTLY match today's real, hardcoded
 * role-based access -- derived from a direct audit of every restrictTo()/
 * adminOnly call site plus the app-wide blog_editor lockdown in routes.js.
 * This is pure additive plumbing: nothing in the app reads this collection
 * yet (Phase 2 wires it up), so seeding is safe to run against the real DB.
 *
 * Ground truth per role (confirmed by grep across every routes.js, not
 * guessed):
 *
 * admin -- every restrictTo() list that exists includes "admin"; every
 *   route with NO restrictTo() is reachable by any authenticated staff,
 *   which includes admin. So: all modules, all 4 actions = true.
 *
 * blog_editor -- routes.js applies a GLOBAL block: any request where
 *   req.user.role === "blog_editor" gets a hard 403 on every path except
 *   /api/blogs. Within blogs, the whole admin sub-router is guarded by
 *   restrictTo("admin","blog_editor","clinic_manager") with no further
 *   per-action split, so blog_editor has full CRUD there. Everywhere else:
 *   all 4 actions = false.
 *
 * clinic_manager -- included in every restrictTo() list that exists EXCEPT
 *   settings (adminOnly) and staff/users (adminOnly). Every other module,
 *   gated or not, grants clinic_manager full access. So: all modules, all
 *   4 actions = true, EXCEPT staff and settings (all false).
 *
 * user (plain Staff) -- the vestigial role: never appears in ANY
 *   restrictTo() list, so it's excluded from every action those lists
 *   gate, but still reaches every route that has NO restriction at all
 *   (any authenticated staff via authProtect/anyAuth). Blogs is a special
 *   case: the admin blog router's restrictTo() list does NOT include
 *   "user", so "user" is blocked from blogs entirely (403), unlike
 *   clinic_manager.
 *   NOTE on treatments: the 4-action model doesn't cleanly capture the
 *   real split -- the treatment MASTER CATALOG (create/edit/delete
 *   treatment types) is restrictTo(admin, clinic_manager)-gated, but
 *   viewing/using treatments for a specific patient (booking, updating a
 *   patient's treatment plan) is completely ungated. Mapped here as
 *   view/create/edit = true (day-to-day patient treatment work, ungated),
 *   delete = false (catalog delete is the specifically-gated action) --
 *   an approximation flagged here rather than silently assumed.
 */

const MODULES = [
  "dashboard",
  "patients",
  "enquiries",
  "appointments",
  "treatments",
  "lab",
  "payments",
  "billing",
  "reports",
  "memberships",
  "blogs",
  "notifications",
  "clinics",
  "staff",
  "settings",
];

const allTrue = { view: true, create: true, edit: true, delete: true };
const allFalse = { view: false, create: false, edit: false, delete: false };

const MATRIX = {
  admin: Object.fromEntries(MODULES.map((m) => [m, allTrue])),

  blog_editor: Object.fromEntries(
    MODULES.map((m) => [m, m === "blogs" ? allTrue : allFalse])
  ),

  clinic_manager: Object.fromEntries(
    MODULES.map((m) => [
      m,
      m === "staff" || m === "settings" ? allFalse : allTrue,
    ])
  ),

  user: {
    dashboard: allTrue,
    patients: allTrue,
    enquiries: allTrue,
    appointments: { view: true, create: true, edit: true, delete: false },
    treatments: { view: true, create: true, edit: true, delete: false },
    lab: allTrue,
    payments: allTrue,
    billing: { view: true, create: true, edit: true, delete: false },
    reports: allTrue,
    memberships: allTrue,
    blogs: allFalse,
    notifications: allTrue,
    clinics: { view: true, create: false, edit: false, delete: false },
    staff: allFalse,
    settings: allFalse,
  },
};

const seedPermissions = async () => {
  try {
    await connectDB();

    const existing = await Permission.countDocuments();
    if (existing > 0) {
      console.log(`⚠️ ${existing} permission document(s) already exist. Skipping seed.`);
      console.log("To reseed, delete existing Permission documents first.");
      process.exit();
    }

    const docs = [];
    for (const [role, modules] of Object.entries(MATRIX)) {
      for (const [module, actions] of Object.entries(modules)) {
        docs.push({ role, module, ...actions });
      }
    }

    await Permission.insertMany(docs);
    console.log(`✅ Seeded ${docs.length} Permission documents (${Object.keys(MATRIX).length} roles × ${MODULES.length} modules).`);
    process.exit();
  } catch (err) {
    console.error("❌ Permission seed failed:", err);
    process.exit(1);
  }
};

seedPermissions();
