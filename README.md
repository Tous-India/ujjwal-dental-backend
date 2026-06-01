# Ujjwal Dental Clinic - Backend API

Complete backend API for the Ujjwal Dental Clinic Management System.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 5.x
- **Database:** MongoDB with Mongoose
- **Authentication:** JWT (Admin), Email OTP (Patients - Passwordless)
- **Validation:** Zod
- **File Upload:** Multer + Cloudinary
- **Payments:** Razorpay
- **Email:** Nodemailer (OTP delivery + notifications)

## Quick Start

```bash
# Install dependencies
npm install

# Create .env file (copy from .env.example)
cp .env.example .env

# Seed database (optional)
# Seed admin user
node src/seeds/index.js

# Seed sample notifications
node src/seeds/notifications.seed.js

# Start development server
npm run dev
```

**Admin account:** the seed script (`node src/seeds/index.js`, development only) creates an
admin user. Set the seed credentials via environment variables / your local seed config and
change the password immediately after first login. Do not commit or document real credentials.

## Project Structure

```
backend/
├── src/
│   ├── config/              # Database & service configs
│   │   ├── db.js            # MongoDB connection
│   │   ├── cloudinary.js    # Cloudinary setup
│   │   └── razorpay.js      # Razorpay setup
│   ├── constants/           # App constants
│   │   ├── roles.js         # User roles
│   │   └── status.js        # Status enums
│   ├── middlewares/         # Express middlewares
│   │   ├── auth.middleware.js     # JWT authentication
│   │   ├── error.middleware.js    # Global error handler
│   │   ├── upload.middleware.js   # File upload (Multer + Cloudinary)
│   │   └── validate.middleware.js # Zod validation
│   ├── modules/             # Feature modules
│   │   ├── auth/            # Authentication
│   │   ├── users/           # Admin/Staff management
│   │   ├── patients/        # Patient management
│   │   ├── clinics/         # Clinic locations
│   │   ├── appointments/    # Appointment booking
│   │   ├── treatments/      # Treatment catalog & instances
│   │   ├── tests/           # Test catalog & instances
│   │   ├── memberships/     # Membership plans
│   │   ├── billing/         # Invoice management
│   │   ├── payments/        # Payment processing
│   │   ├── reports/         # PDF/image uploads
│   │   └── notifications/   # In-app notifications
│   ├── utils/               # Utilities
│   │   ├── ApiResponse.js   # Standardized responses
│   │   ├── AppError.js      # Custom error classes
│   │   ├── asyncHandler.js  # Async wrapper
│   │   └── email.js         # Email sending utilities (OTP, notifications)
│   ├── seeds/               # Database seed files
│   │   ├── index.js         # Seed admin user
│   │   ├── clinics.seed.js  # Seed clinic locations
│   │   ├── patients.seed.js # Seed sample patients
│   │   ├── notifications.seed.js # Seed sample notifications
│   │   └── set-patient-password.js # Set patient password utility
│   └── routes.js            # Main router
├── app.js                   # Express app
├── server.js                # Entry point
└── package.json
```

---

## API Endpoints

Base URL: `http://localhost:5000/api`

### Auth (`/api/auth`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/login` | Public | Admin login with email/password |
| POST | `/patient/login` | Public | Patient login - Request OTP via email |
| POST | `/patient/verify-otp` | Public | Verify patient OTP and get JWT |
| POST | `/patient/resend-otp` | Public | Resend OTP to email |
| POST | `/refresh-token` | Auth | Refresh access token |
| POST | `/logout` | Auth | Logout user |
| POST | `/forgot-password` | Public | Request password reset |
| POST | `/reset-password` | Public | Reset password with token |

### Users (`/api/users`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List all users |
| GET | `/me` | Admin | Get current user profile |
| PATCH | `/me` | Admin | Update current user profile |
| PATCH | `/me/password` | Admin | Change password |
| GET | `/:id` | Admin | Get user by ID |
| POST | `/` | Admin | Create new user |
| PATCH | `/:id` | Admin | Update user |
| DELETE | `/:id` | Admin | Deactivate user |

### Patients (`/api/patients`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List patients with pagination |
| GET | `/search` | Admin | Search patients by name/phone |
| GET | `/:id` | Admin | Get patient details |
| POST | `/` | Admin | Create new patient |
| PATCH | `/:id` | Admin | Update patient |
| DELETE | `/:id` | Admin | Deactivate patient |
| GET | `/:id/appointments` | Admin | Patient's appointments |
| GET | `/:id/treatments` | Admin | Patient's treatments |
| GET | `/:id/payments` | Admin | Patient's payment history |
| GET | `/:id/reports` | Admin | Patient's reports |
| GET | `/:id/membership` | Admin | Membership details |

### Clinics (`/api/clinics`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Public | List all clinics |
| GET | `/:id` | Public | Get clinic details |
| GET | `/:id/slots` | Public | Get available appointment slots |
| POST | `/` | Admin | Create new clinic |
| PATCH | `/:id` | Admin | Update clinic |
| PATCH | `/:id/hours` | Admin | Update operating hours |
| POST | `/:id/holidays` | Admin | Add holiday |
| DELETE | `/:id/holidays/:holidayId` | Admin | Remove holiday |

### Appointments (`/api/appointments`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List appointments with filters |
| GET | `/today` | Admin | Today's appointments |
| GET | `/upcoming` | Admin | Upcoming appointments |
| GET | `/available-slots` | Public | Get available slots for date |
| GET | `/stats` | Admin | Appointment statistics |
| GET | `/:id` | Any Auth | Get appointment details |
| POST | `/` | Any Auth | Book new appointment |
| PATCH | `/:id` | Admin | Update appointment |
| PATCH | `/:id/status` | Admin | Update appointment status |
| POST | `/:id/check-in` | Admin | Check-in patient |
| POST | `/:id/complete` | Admin | Complete appointment |
| POST | `/:id/cancel` | Any Auth | Cancel appointment |
| POST | `/:id/reschedule` | Admin | Reschedule appointment |

### Treatments (`/api/treatments`)

**Treatment Master (Catalog)**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/master` | Public | List all treatment types |
| GET | `/master/:id` | Public | Get treatment type details |
| POST | `/master` | Admin | Create treatment type |
| PATCH | `/master/:id` | Admin | Update treatment type |
| DELETE | `/master/:id` | Admin | Deactivate treatment type |

**Treatment Instances (Patient Treatments)**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List all treatments |
| GET | `/:id` | Admin | Get treatment details |
| POST | `/` | Admin | Add treatment to patient |
| PATCH | `/:id` | Admin | Update treatment |
| PATCH | `/:id/status` | Admin | Update treatment status |
| POST | `/:id/complete` | Admin | Mark treatment completed |
| POST | `/:id/cancel` | Admin | Cancel treatment |
| POST | `/:id/sessions` | Admin | Add treatment session |
| POST | `/:id/follow-up` | Admin | Schedule follow-up |

### Tests (`/api/tests`)

**Test Master (Catalog)**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/master` | Public | List all test types |
| GET | `/master/:id` | Public | Get test type details |
| POST | `/master` | Admin | Create test type |
| PATCH | `/master/:id` | Admin | Update test type |
| DELETE | `/master/:id` | Admin | Deactivate test type |

**Test Instances (Patient Tests)**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List all tests |
| GET | `/:id` | Admin | Get test details |
| POST | `/` | Admin | Order test for patient |
| PATCH | `/:id` | Admin | Update test |
| PATCH | `/:id/status` | Admin | Update test status |
| POST | `/:id/complete` | Admin | Mark test completed |
| POST | `/:id/cancel` | Admin | Cancel test |
| POST | `/:id/link-report` | Admin | Link report to test |

### Memberships (`/api/memberships`)

**Membership Plans (Catalog)**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/plans` | Public | List all membership plans |
| GET | `/plans/:id` | Public | Get plan details |
| POST | `/plans` | Admin | Create membership plan |
| PATCH | `/plans/:id` | Admin | Update membership plan |
| DELETE | `/plans/:id` | Admin | Deactivate plan |
| POST | `/plans/seed` | Admin | Seed default plans |

**Patient Memberships**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/assign` | Admin | Assign membership to patient |
| POST | `/renew/:patientId` | Admin | Renew patient's membership |
| POST | `/cancel/:patientId` | Admin | Cancel patient's membership |
| GET | `/members` | Admin | List all active members |
| GET | `/stats` | Admin | Membership statistics |

### Billing (`/api/billing`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/invoices` | Admin | List all invoices |
| GET | `/stats` | Admin | Billing statistics |
| GET | `/overdue` | Admin | Get overdue invoices |
| GET | `/invoices/number/:invoiceNumber` | Admin | Get invoice by number |
| GET | `/invoices/:id` | Any Auth | Get invoice details |
| POST | `/invoices` | Admin | Create new invoice |
| PATCH | `/invoices/:id` | Admin | Update invoice |
| POST | `/invoices/:id/items` | Admin | Add item to invoice |
| DELETE | `/invoices/:id/items/:itemIndex` | Admin | Remove item from invoice |
| POST | `/invoices/:id/issue` | Admin | Issue/finalize invoice |
| POST | `/invoices/:id/cancel` | Admin | Cancel invoice |
| POST | `/invoices/:id/payment` | Admin | Record payment on invoice |
| GET | `/invoices/:id/pdf` | Any Auth | Download invoice PDF |
| GET | `/patient/:patientId/pending` | Admin | Patient's pending invoices |

### Payments (`/api/payments`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List all payments |
| GET | `/stats` | Admin | Payment statistics |
| GET | `/daily-collection` | Admin | Daily collection report |
| GET | `/number/:paymentNumber` | Admin | Get payment by number |
| GET | `/:id` | Any Auth | Get payment details |
| POST | `/` | Admin | Record payment (cash/UPI/card) |
| POST | `/opd` | Admin | Record OPD payment |
| POST | `/membership` | Admin | Record membership payment |
| POST | `/razorpay/create-order` | Any Auth | Create Razorpay order |
| POST | `/razorpay/verify` | Any Auth | Verify Razorpay payment |
| POST | `/razorpay/webhook` | Public | Razorpay webhook |
| POST | `/:id/refund` | Admin | Process refund |
| GET | `/patient/:patientId/summary` | Admin | Patient payment summary |

### Reports (`/api/reports`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Admin | List all reports |
| GET | `/number/:reportNumber` | Any Auth | Get report by number |
| GET | `/:id` | Any Auth | Get report details |
| POST | `/` | Admin | Upload new report |
| PATCH | `/:id` | Admin | Update report details |
| DELETE | `/:id` | Admin | Delete report (soft delete) |
| POST | `/:id/tags` | Admin | Add tags to report |
| PATCH | `/:id/visibility` | Admin | Toggle patient visibility |
| PUT | `/:id/file` | Admin | Replace report file |
| GET | `/:id/download` | Any Auth | Download report file |
| GET | `/patient/:patientId` | Admin | Get patient's reports |
| GET | `/patient/:patientId/category/:category` | Admin | Reports by category |

### Notifications (`/api/notifications`)

**User Notifications**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/` | Any Auth | List user's notifications |
| GET | `/unread-count` | Any Auth | Get unread count |
| GET | `/unread` | Any Auth | Get unread notifications |
| GET | `/:id` | Any Auth | Get notification details |
| PATCH | `/:id/read` | Any Auth | Mark as read |
| PATCH | `/:id/unread` | Any Auth | Mark as unread |
| PATCH | `/mark-all-read` | Any Auth | Mark all as read |
| DELETE | `/:id` | Any Auth | Delete notification |

**Admin Operations**

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/admin/all` | Admin | List all notifications |
| GET | `/admin/stats` | Admin | Notification statistics |
| POST | `/send` | Admin | Send notification |
| POST | `/send-bulk` | Admin | Send bulk notifications |
| POST | `/reminder/appointment` | Admin | Create appointment reminder |
| POST | `/reminder/payment` | Admin | Create payment reminder |

---

## Implementation Status

### Phase 1: Foundation ✅
- [x] Project structure setup
- [x] Database configuration (MongoDB)
- [x] Global error handling
- [x] Utility functions (ApiResponse, asyncHandler)
- [x] Constants (roles, status enums)

### Phase 2: Core Middleware ✅
- [x] JWT authentication middleware
- [x] Role-based authorization
- [x] Request validation (Zod)
- [x] File upload middleware (Multer + Cloudinary)

### Phase 3: Data Models ✅
- [x] User model (admin/staff)
- [x] Patient model (with embedded membership)
- [x] Clinic model (with operating hours)
- [x] Appointment model (with slot management)
- [x] TreatmentMaster & Treatment models
- [x] TestMaster & Test models
- [x] MembershipPlan model
- [x] Invoice model (with line items)
- [x] Payment model (with Razorpay)
- [x] Report model (file metadata)
- [x] Notification model

### Phase 4: Controllers & Business Logic ✅
- [x] Authentication (JWT + OTP)
- [x] User management (CRUD)
- [x] Patient management (CRUD + search)
- [x] Clinic management (slots, holidays)
- [x] Appointment booking (availability, status flow)
- [x] Treatment management (sessions, follow-ups)
- [x] Test management (ordering, completion)
- [x] Membership management (assign, renew, cancel)
- [x] Billing/Invoice management (items, discounts)
- [x] Payment processing (Razorpay integration)
- [x] Report uploads (Cloudinary)
- [x] Notification system (in-app, reminders)

### Phase 5: Routes ✅
- [x] All API routes configured
- [x] Authentication middleware applied
- [x] Route documentation

---

## Key Features

### Appointment System
- 30-minute time slots
- Max 50 appointments per clinic per day
- Automatic slot availability calculation
- Status flow: booked → checked_in → in_progress → completed

### Membership Plans
6 default plans:
1. Cosmodentofacial Family Dental Plan - ₹4,999 (10% discount)
2. Cosmodentofacial Women Dental Plan - ₹3,400 (10% discount)
3. Implant Post Care - ₹4,500 (15% discount)
4. Cosmodentofacial Student's Dental Plan - ₹1,300 (10% discount)
5. Oral Hygiene Products Kit for Adults - ₹562
6. Oral Hygiene Products Kit for Kids - ₹270

### Payment Processing
- Cash, UPI, Card payments (manual recording)
- Razorpay online payments
- Payment verification with signature
- Webhook support for async updates
- Refund processing

### File Uploads
- Cloudinary integration
- Supports: Images (JPEG, PNG, GIF, WebP), PDFs, Word docs
- Max file size: 10MB
- Auto-generated thumbnails
- Secure URL generation

### Enquiries/Leads (`/api/enquiries`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/` | Public | Submit enquiry (from website) |
| GET | `/` | Admin | List all enquiries with filters |
| GET | `/stats` | Admin | Enquiry statistics by status/treatment/source |
| GET | `/today` | Admin | Today's enquiries |
| GET | `/pending-follow-ups` | Admin | Pending follow-ups |
| GET | `/:id` | Admin | Get enquiry details |
| PATCH | `/:id` | Admin | Update enquiry info |
| DELETE | `/:id` | Admin | Delete enquiry |
| PATCH | `/:id/status` | Admin | Change status (with note) |
| PATCH | `/:id/assign` | Admin | Assign to staff member |
| PATCH | `/:id/follow-up` | Admin | Schedule follow-up |
| PATCH | `/:id/spam` | Admin | Mark/unmark as spam |
| PATCH | `/:id/convert` | Admin | Convert to patient |
| POST | `/:id/notes` | Admin | Add internal note |

### Settings (`/api/settings`)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/fees` | Public | Get OPD fee settings |
| PATCH | `/fees` | Admin | Update fee settings |
| GET | `/profile` | Admin | Get admin profile |
| PATCH | `/profile` | Admin | Update profile |
| POST | `/profile/picture` | Admin | Upload profile picture |
| PATCH | `/profile/password` | Admin | Change password |
| GET | `/clinic` | Admin | Get clinic settings |
| PATCH | `/clinic` | Admin | Update clinic settings |
| GET | `/notifications` | Admin | Get notification preferences |
| PATCH | `/notifications` | Admin | Update notification preferences |
| GET | `/system` | Admin | Get system configuration |
| PATCH | `/system` | Admin | Update system configuration |

---

## 📝 Recent Updates

### Notification System (Latest)
- ✅ Complete notification model with multi-channel support (in-app, email, SMS, WhatsApp)
- ✅ Real-time unread count endpoint with efficient queries
- ✅ Mark as read/unread functionality
- ✅ Bulk notification sending
- ✅ Scheduled notifications support
- ✅ Notification types: appointments, payments, treatments, tests, memberships
- ✅ Priority levels: normal, high, urgent
- ✅ Auto-generated appointment and payment reminders

### Email OTP Authentication
- ✅ Passwordless patient login via email OTP
- ✅ 6-digit OTP generation with 10-minute expiration
- ✅ Nodemailer integration for reliable email delivery
- ✅ Resend OTP functionality
- ✅ Secure OTP verification with rate limiting

### Payment & Billing Improvements
- ✅ Date range filtering for payments
- ✅ Payment statistics and daily collection reports
- ✅ Enhanced payment metadata tracking

### Bug Fixes
- ✅ Fixed admin login 401 error (password double-hashing issue)
- ✅ Fixed notification routes ordering (admin routes before :id routes)
- ✅ Improved error handling across all modules

---

## User Roles

| Role | Description | Access |
|------|-------------|--------|
| `admin` | Doctor/Staff | Full system access |
| `patient` | Registered patients | Portal access (own data only) |

---

## Environment Variables

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/ujjwal-dental

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# Email (Required for OTP and notifications)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=Ujjwal Dental Clinic <noreply@ujjwaldental.com>

# SMS (optional - for future SMS integration)
SMS_API_KEY=your-sms-api-key
```

---

## Clinic Locations

1. **Delhi Road Clinic** - Hapur, UP
2. **Parsavnath Clinic** - Hapur, UP

---

---

## API Testing Guide (Postman)

### Test Data Files Location

| File | Path | Purpose |
|------|------|---------|
| **postman-collection.json** | `src/data/postman-collection.json` | Complete API collection with endpoints, methods & request bodies |
| **postman-test-data.json** | `src/data/postman-test-data.json` | Organized test data by module |
| **dummyData.js** | `src/data/dummyData.js` | JavaScript module for seeding database |

---

### Quick Reference - API Endpoints Summary

| Module | Endpoints | Description |
|--------|:---------:|-------------|
| **Auth** | 7 | Login, OTP, Logout, Password Reset |
| **Users** | 8 | CRUD + Password Change |
| **Patients** | 11 | CRUD + Appointments/Treatments/Payments |
| **Clinics** | 8 | CRUD + Hours/Holidays/Slots |
| **Appointments** | 14 | Book, Cancel, Reschedule, Check-in, Complete |
| **Treatments** | 18 | Master Types + Patient Treatments + Sessions |
| **Tests** | 10 | Master Types + Patient Tests |
| **Memberships** | 9 | Plans + Assign/Renew/Cancel |
| **Billing** | 14 | Invoices + Items + Issue/Cancel/Payment/PDF |
| **Payments** | 13 | Cash/UPI/Card/Razorpay/Refund/Stats |
| **Reports** | 12 | CRUD + Download + Tags + Visibility |
| **Notifications** | 14 | List, Read, Send, Bulk, Reminders, Stats |
| **Enquiries** | 15 | Lead pipeline, Follow-ups, Convert, Notes |
| **Settings** | 12 | Profile, Clinic, Fees, Notifications, System |
| **Uploads** | 6 | File management + Cloudinary |
| **CMS** | 19 | Treatment pages, Sections, FAQs |
| **TOTAL** | **180+** | **Complete API Coverage** |

---

### Postman Environment Variables

Set these variables in your Postman environment after creating resources:

#### Primary IDs
| Variable | Description | How to Get |
|----------|-------------|------------|
| `{{accessToken}}` | JWT Access Token | From login response |
| `{{refreshToken}}` | JWT Refresh Token | From login response |
| `{{patientId}}` | Patient MongoDB ObjectId | From create patient response `_id` |
| `{{clinicId}}` | Clinic MongoDB ObjectId | From create clinic response `_id` |
| `{{userId}}` | User MongoDB ObjectId | From create user response `_id` |

#### Secondary IDs
| Variable | Description | How to Get |
|----------|-------------|------------|
| `{{appointmentId}}` | Appointment ObjectId | From book appointment response `_id` |
| `{{treatmentId}}` | Treatment ObjectId | From add treatment response `_id` |
| `{{treatmentTypeId}}` | Treatment Master ObjectId | From create treatment type response `_id` |
| `{{invoiceId}}` | Invoice ObjectId | From create invoice response `_id` |
| `{{paymentId}}` | Payment ObjectId | From record payment response `_id` |

#### Other IDs
| Variable | Description | How to Get |
|----------|-------------|------------|
| `{{testTypeId}}` | Test Master ObjectId | From create test type response `_id` |
| `{{testId}}` | Test ObjectId | From order test response `_id` |
| `{{planId}}` | Membership Plan ObjectId | From create plan response `_id` |
| `{{reportId}}` | Report ObjectId | From upload report response `_id` |
| `{{notificationId}}` | Notification ObjectId | From send notification response `_id` |
| `{{resetToken}}` | Password Reset Token | From forgot-password email link |

---

### Recommended Testing Workflow

Follow this order to test APIs properly (dependencies flow top to bottom):

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: AUTHENTICATION                                         │
│  POST /api/auth/login → Save {{accessToken}}                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: MASTER DATA (Create first - needed by other modules)   │
│  ├── POST /api/clinics              → Save {{clinicId}}         │
│  ├── POST /api/treatments/master    → Save {{treatmentTypeId}}  │
│  ├── POST /api/tests/master         → Save {{testTypeId}}       │
│  └── POST /api/memberships/plans    → Save {{planId}}           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: PATIENTS                                               │
│  POST /api/patients → Save {{patientId}}                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: PATIENT OPERATIONS (Require patientId + clinicId)      │
│  ├── POST /api/appointments         → Save {{appointmentId}}    │
│  ├── POST /api/treatments           → Save {{treatmentId}}      │
│  ├── POST /api/tests                → Save {{testId}}           │
│  └── POST /api/memberships/assign   → Assign membership         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: BILLING & PAYMENTS                                     │
│  ├── POST /api/billing/invoices     → Save {{invoiceId}}        │
│  └── POST /api/payments             → Save {{paymentId}}        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: REPORTS & NOTIFICATIONS                                │
│  ├── POST /api/reports              → Save {{reportId}}         │
│  └── POST /api/notifications/send   → Save {{notificationId}}   │
└─────────────────────────────────────────────────────────────────┘
```

---

### Admin Login

An admin user is created locally by the seed script (development only). Credentials are not
documented here — use your local seed configuration and change the password after first login.

**Patient Login:**
- Email-based OTP authentication (passwordless)
- Enter patient's email address
- Receive 6-digit OTP via email
- OTP expires in 10 minutes
- Can request new OTP if needed

---

### HTTP Status Codes Reference

| Code | Status | Meaning |
|:----:|--------|---------|
| `200` | OK | Success |
| `201` | Created | Resource created successfully |
| `400` | Bad Request | Invalid input / Validation error |
| `401` | Unauthorized | Invalid or missing token |
| `403` | Forbidden | No permission for this action |
| `404` | Not Found | Resource not found |
| `409` | Conflict | Duplicate entry / Already exists |
| `500` | Server Error | Internal server error |

---

## License

ISC
