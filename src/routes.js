import { Router } from "express";

// Import all module routes
import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import patientRoutes from "./modules/patients/patient.routes.js";
import clinicRoutes from "./modules/clinics/clinic.routes.js";
import appointmentRoutes from "./modules/appointments/appointment.routes.js";
import treatmentRoutes from "./modules/treatments/treatment.routes.js";
import testRoutes from "./modules/tests/test.routes.js";
import labRoutes from "./modules/labs/lab.routes.js";
import labOrderRoutes from "./modules/labs/labOrder.routes.js";
import followUpRoutes from "./modules/followups/followup.routes.js";
import membershipRoutes from "./modules/memberships/membership.routes.js";
import billingRoutes from "./modules/billing/billing.routes.js";
import paymentRoutes from "./modules/payments/payment.routes.js";
import reportRoutes from "./modules/reports/report.routes.js";
import settingsRoutes from "./modules/settings/settings.routes.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import enquiryRoutes from "./modules/enquiries/enquiry.routes.js";
import treatmentPageRoutes from "./modules/cms/treatmentPage.routes.js";
import blogRoutes from "./modules/blogs/blog.routes.js";
import { optionalAuth } from "./middlewares/auth.middleware.js";

const router = Router();

/**
 * API ROUTES
 * All routes are prefixed with /api (set in app.js)
 */

// ========== BLOG EDITOR APP-WIDE RESTRICTION ==========
// The blog_editor role must only ever touch /api/blogs/* (and /api/auth/* to
// log in). Every other module still gates itself with its own
// authProtect/adminOnly/patientProtect — this only ADDS a block, it never
// grants access. optionalAuth (not authProtect) is used deliberately: several
// modules (appointments, billing, followups, memberships, payments) mix
// patient-facing routes into the same router file, so forcing full admin
// auth here would break patient-only endpoints. optionalAuth only populates
// req.user when a valid admin token happens to be present and never fails
// the request itself — every route's own auth middleware still runs
// downstream exactly as before for every other role.
router.use((req, res, next) => {
  if (req.path.startsWith("/auth") || req.path.startsWith("/blogs")) {
    return next();
  }
  optionalAuth(req, res, () => {
    if (req.user?.role === "blog_editor") {
      return res.status(403).json({
        success: false,
        message: "Access restricted to blog management only",
      });
    }
    next();
  });
});

// ========== AUTH ==========
// POST /api/auth/login          - Admin login
// POST /api/auth/patient/login  - Patient OTP login
// POST /api/auth/patient/verify-otp
// POST /api/auth/refresh-token
// POST /api/auth/logout
// POST /api/auth/forgot-password
// POST /api/auth/reset-password
router.use("/auth", authRoutes);

// ========== USERS (Admin/Staff) ==========
// GET    /api/users             - List all users
// GET    /api/users/me          - Get current user
// PATCH  /api/users/me          - Update current user
// PATCH  /api/users/me/password - Change password
// GET    /api/users/:id         - Get user by ID
// POST   /api/users             - Create user
// PATCH  /api/users/:id         - Update user
// DELETE /api/users/:id         - Deactivate user
router.use("/users", userRoutes);

// ========== PATIENTS ==========
// GET    /api/patients          - List patients
// GET    /api/patients/search   - Search patients
// GET    /api/patients/:id      - Get patient
// POST   /api/patients          - Create patient
// PATCH  /api/patients/:id      - Update patient
// DELETE /api/patients/:id      - Deactivate patient
// GET    /api/patients/:id/appointments
// GET    /api/patients/:id/treatments
// GET    /api/patients/:id/payments
// GET    /api/patients/:id/reports
// GET    /api/patients/:id/membership
router.use("/patients", patientRoutes);

// ========== CLINICS ==========
// GET    /api/clinics           - List clinics
// GET    /api/clinics/:id       - Get clinic
// GET    /api/clinics/:id/slots - Get available slots
// POST   /api/clinics           - Create clinic
// PATCH  /api/clinics/:id       - Update clinic
// PATCH  /api/clinics/:id/hours - Update operating hours
// POST   /api/clinics/:id/holidays
// DELETE /api/clinics/:id/holidays/:holidayId
router.use("/clinics", clinicRoutes);

// ========== APPOINTMENTS ==========
// GET    /api/appointments              - List appointments
// GET    /api/appointments/today        - Today's appointments
// GET    /api/appointments/upcoming     - Upcoming appointments
// GET    /api/appointments/available-slots
// GET    /api/appointments/:id          - Get appointment
// POST   /api/appointments              - Book appointment
// PATCH  /api/appointments/:id          - Update appointment
// PATCH  /api/appointments/:id/status   - Update status
// POST   /api/appointments/:id/check-in
// POST   /api/appointments/:id/complete
// POST   /api/appointments/:id/cancel
// POST   /api/appointments/:id/reschedule
router.use("/appointments", appointmentRoutes);

// ========== TREATMENTS ==========
// GET    /api/treatments/master         - List treatment types
// GET    /api/treatments/master/:id     - Get treatment type
// POST   /api/treatments/master         - Create treatment type
// PATCH  /api/treatments/master/:id     - Update treatment type
// DELETE /api/treatments/master/:id     - Deactivate treatment type
// GET    /api/treatments                - List patient treatments
// GET    /api/treatments/:id            - Get treatment
// POST   /api/treatments                - Add treatment
// PATCH  /api/treatments/:id            - Update treatment
// PATCH  /api/treatments/:id/status     - Update status
// POST   /api/treatments/:id/sessions   - Add session
// POST   /api/treatments/:id/follow-up  - Schedule follow-up
router.use("/treatments", treatmentRoutes);

// ========== TESTS ==========
// GET    /api/tests/master              - List test types
// GET    /api/tests/master/:id          - Get test type
// POST   /api/tests/master              - Create test type
// PATCH  /api/tests/master/:id          - Update test type
// DELETE /api/tests/master/:id          - Deactivate test type
// GET    /api/tests                     - List patient tests
// GET    /api/tests/:id                 - Get test
// POST   /api/tests                     - Order test
// PATCH  /api/tests/:id                 - Update test
// PATCH  /api/tests/:id/status          - Update status
router.use("/tests", testRoutes);
router.use("/labs", labRoutes);
router.use("/lab-orders", labOrderRoutes);
router.use("/followups", followUpRoutes);

// ========== MEMBERSHIPS ==========
// GET    /api/memberships/plans         - List membership plans
// GET    /api/memberships/plans/:id     - Get plan
// POST   /api/memberships/plans         - Create plan
// PATCH  /api/memberships/plans/:id     - Update plan
// DELETE /api/memberships/plans/:id     - Deactivate plan
// POST   /api/memberships/assign        - Assign to patient
// POST   /api/memberships/renew/:patientId
// POST   /api/memberships/cancel/:patientId
router.use("/memberships", membershipRoutes);

// ========== BILLING ==========
// GET    /api/billing/invoices          - List invoices
// GET    /api/billing/invoices/:id      - Get invoice
// POST   /api/billing/invoices          - Create invoice
// PATCH  /api/billing/invoices/:id      - Update invoice
// POST   /api/billing/invoices/:id/issue
// POST   /api/billing/invoices/:id/cancel
// GET    /api/billing/invoices/:id/pdf  - Download PDF
router.use("/billing", billingRoutes);

// ========== PAYMENTS ==========
// GET    /api/payments                  - List payments
// GET    /api/payments/:id              - Get payment
// POST   /api/payments                  - Record payment
// POST   /api/payments/razorpay/create-order
// POST   /api/payments/razorpay/verify
// POST   /api/payments/razorpay/webhook
// POST   /api/payments/:id/refund
router.use("/payments", paymentRoutes);

// ========== REPORTS ==========
// GET    /api/reports                   - List reports
// GET    /api/reports/:id               - Get report
// POST   /api/reports                   - Upload report
// PATCH  /api/reports/:id               - Update report
// DELETE /api/reports/:id               - Delete report
// GET    /api/reports/:id/download      - Download PDF
router.use("/reports", reportRoutes);

// ========== SETTINGS ==========
// GET    /api/settings/profile              - Get admin profile
// PATCH  /api/settings/profile              - Update profile
// POST   /api/settings/profile/picture      - Upload profile picture
// PATCH  /api/settings/profile/password     - Change password
// GET    /api/settings/clinic               - Get clinic settings
// PATCH  /api/settings/clinic               - Update clinic settings
// GET    /api/settings/notifications        - Get notification prefs
// PATCH  /api/settings/notifications        - Update notification prefs
// GET    /api/settings/system               - Get system config
// PATCH  /api/settings/system               - Update system config
router.use("/settings", settingsRoutes);

// ========== NOTIFICATIONS ==========
// GET    /api/notifications             - List notifications
// GET    /api/notifications/unread-count
// PATCH  /api/notifications/:id/read
// PATCH  /api/notifications/read-all
// POST   /api/notifications/send
router.use("/notifications", notificationRoutes);

// ========== UPLOADS ==========
// POST   /api/uploads                   - Upload file (PDF/Image)
// GET    /api/uploads                   - List all uploads
// GET    /api/uploads/stats             - Storage statistics
// GET    /api/uploads/category/:category - Uploads by category
// GET    /api/uploads/:id               - Get single upload
// PATCH  /api/uploads/:id               - Update upload metadata
// DELETE /api/uploads/:id               - Delete upload
router.use("/uploads", uploadRoutes);

// ========== ENQUIRIES (Leads) ==========
// POST   /api/enquiries                 - Submit enquiry (public)
// GET    /api/enquiries                 - List enquiries
// GET    /api/enquiries/stats           - Enquiry statistics
// GET    /api/enquiries/today           - Today's enquiries
// GET    /api/enquiries/pending-follow-ups - Pending follow-ups
// GET    /api/enquiries/:id             - Get enquiry
// PATCH  /api/enquiries/:id             - Update enquiry
// PATCH  /api/enquiries/:id/status      - Update status
// PATCH  /api/enquiries/:id/assign      - Assign to staff
// POST   /api/enquiries/:id/notes       - Add note
// DELETE /api/enquiries/:id             - Delete enquiry
router.use("/enquiries", enquiryRoutes);

// ========== CMS - TREATMENT PAGES ==========
// GET    /api/cms/treatments            - List published pages (public)
// GET    /api/cms/treatments/all        - List all pages (admin)
// GET    /api/cms/treatments/:slug      - Get page by slug (public)
// GET    /api/cms/treatments/id/:id     - Get page by ID (admin)
// POST   /api/cms/treatments            - Create page
// PATCH  /api/cms/treatments/:id        - Update page
// DELETE /api/cms/treatments/:id        - Delete page
// PATCH  /api/cms/treatments/:id/publish - Publish page
// POST   /api/cms/treatments/:id/sections - Add section
// PATCH  /api/cms/treatments/:id/sections/:sectionId - Update section
// POST   /api/cms/treatments/:id/faqs   - Add FAQ
router.use("/cms/treatments", treatmentPageRoutes);

// ========== BLOGS ==========
// GET    /api/blogs/public              - List published blogs (public)
// GET    /api/blogs/public/:slug        - Get published blog by slug (public, increments views)
// GET    /api/blogs/stats               - Blog stats (admin/blog_editor)
// GET    /api/blogs                     - List all blogs (admin/blog_editor)
// GET    /api/blogs/:id                 - Get blog by ID (admin/blog_editor)
// POST   /api/blogs                     - Create blog (admin/blog_editor)
// PATCH  /api/blogs/:id                 - Update blog (admin/blog_editor)
// DELETE /api/blogs/:id                 - Delete blog (admin/blog_editor)
// POST   /api/blogs/:id/publish         - Publish blog (admin/blog_editor)
// POST   /api/blogs/:id/unpublish       - Unpublish blog (admin/blog_editor)
// POST   /api/blogs/upload-image        - Upload blog image (admin/blog_editor)
router.use("/blogs", blogRoutes);

// ========== API INFO ==========
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Ujjwal Dental Clinic API",
    version: "1.0.0",
    documentation: "See README.md for full API documentation",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      patients: "/api/patients",
      clinics: "/api/clinics",
      appointments: "/api/appointments",
      treatments: "/api/treatments",
      tests: "/api/tests",
      memberships: "/api/memberships",
      billing: "/api/billing",
      payments: "/api/payments",
      reports: "/api/reports",
      settings: "/api/settings",
      notifications: "/api/notifications",
      uploads: "/api/uploads",
      enquiries: "/api/enquiries",
      cms: {
        treatmentPages: "/api/cms/treatments",
      },
      blogs: "/api/blogs",
    },
  });
});

export default router;
