/**
 * The default Permission matrix, matching today's real hardcoded
 * role-based access exactly -- derived from a direct audit of every
 * restrictTo()/adminOnly call site plus the app-wide blog_editor lockdown
 * in routes.js, not guessed.
 *
 * Shared by:
 *  - src/seeds/permissions.seed.js (one-time seed against the real DB)
 *  - tests/helpers/seed.js (seeds the same matrix into the ephemeral
 *    in-memory test DB, so checkPermission-gated routes behave identically
 *    in tests as in production)
 *
 * Ground truth per role (confirmed by grep across every routes.js):
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
 *   "treatments" vs "treatment_catalog": these are deliberately TWO
 *   separate modules, not one. The treatment MASTER CATALOG (create/edit/
 *   delete treatment TYPES -- the price list admin configures) is
 *   restrictTo(admin, clinic_manager)-gated. Viewing/using treatments for a
 *   specific patient (booking, updating a patient's treatment plan) is a
 *   completely different, ungated set of routes. A single "treatments"
 *   module can't represent both correctly -- "user" needs create/edit=true
 *   on patient treatment work but must NOT gain create/edit on the catalog
 *   (it never had that access). Splitting them was corrected after an
 *   initial single-module version would have silently granted "user" new
 *   catalog-write access purely as a side effect of checkPermission's
 *   route migration -- caught before it shipped.
 */

export const MODULES = [
  "dashboard",
  "patients",
  "enquiries",
  "appointments",
  "treatments",
  "treatment_catalog",
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

export const DEFAULT_PERMISSION_MATRIX = {
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
    // Ungated day-to-day patient treatment work -- distinct from the catalog below.
    treatments: allTrue,
    // Master catalog CRUD (treatment types/pricing) -- restrictTo(admin, clinic_manager)
    // today; "user" was never included, so this stays all-false.
    treatment_catalog: allFalse,
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

export const buildPermissionDocs = () => {
  const docs = [];
  for (const [role, modules] of Object.entries(DEFAULT_PERMISSION_MATRIX)) {
    for (const [module, actions] of Object.entries(modules)) {
      docs.push({ role, module, ...actions });
    }
  }
  return docs;
};
