# Ujjwal Dental Clinic - Backend Architecture Plan

## Table of Contents
1. [Project Structure](#1-project-structure)
2. [Core Entities & Relationships](#2-core-entities--relationships)
3. [Mongoose Models](#3-mongoose-models)
4. [API Endpoints](#4-api-endpoints)
5. [Zod Validation Schemas](#5-zod-validation-schemas)
6. [Middleware Architecture](#6-middleware-architecture)
7. [Centralized Error Handling](#7-centralized-error-handling)
8. [File Upload (Multer + Cloudinary)](#8-file-upload-multer--cloudinary)
9. [Edge Cases & Risk Mitigation](#9-edge-cases--risk-mitigation)
10. [Implementation Order](#10-implementation-order)

---

## 1. Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js                    # MongoDB connection
│   │   ├── cloudinary.js            # Cloudinary configuration
│   │   ├── razorpay.js              # Razorpay configuration
│   │   └── email.js                 # Nodemailer configuration
│   │
│   ├── constants/
│   │   ├── index.js                 # Export all constants
│   │   ├── roles.js                 # ADMIN, SUBADMIN, PATIENT
│   │   ├── permissions.js           # Permission definitions
│   │   ├── httpStatus.js            # HTTP status codes
│   │   └── appointmentStatus.js     # Appointment states
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.js       # JWT authentication
│   │   ├── role.middleware.js       # Role-based authorization
│   │   ├── validate.middleware.js   # Zod validation wrapper
│   │   ├── upload.middleware.js     # Multer + Cloudinary
│   │   ├── error.middleware.js      # Global error handler
│   │   └── rateLimiter.middleware.js
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js
│   │   │   ├── auth.routes.js
│   │   │   └── auth.validator.js
│   │   │
│   │   ├── users/
│   │   │   ├── user.model.js
│   │   │   ├── user.controller.js
│   │   │   ├── user.service.js
│   │   │   ├── user.routes.js
│   │   │   └── user.validator.js
│   │   │
│   │   ├── patients/
│   │   │   ├── patient.model.js
│   │   │   ├── patient.controller.js
│   │   │   ├── patient.service.js
│   │   │   ├── patient.routes.js
│   │   │   └── patient.validator.js
│   │   │
│   │   ├── clinics/
│   │   │   ├── clinic.model.js
│   │   │   ├── clinic.controller.js
│   │   │   ├── clinic.service.js
│   │   │   ├── clinic.routes.js
│   │   │   └── clinic.validator.js
│   │   │
│   │   ├── appointments/
│   │   │   ├── appointment.model.js
│   │   │   ├── appointment.controller.js
│   │   │   ├── appointment.service.js
│   │   │   ├── appointment.routes.js
│   │   │   └── appointment.validator.js
│   │   │
│   │   ├── treatments/
│   │   │   ├── treatmentMaster.model.js  # Treatment catalog
│   │   │   ├── treatment.model.js         # Patient treatments
│   │   │   ├── treatment.controller.js
│   │   │   ├── treatment.service.js
│   │   │   ├── treatment.routes.js
│   │   │   └── treatment.validator.js
│   │   │
│   │   ├── tests/
│   │   │   ├── testMaster.model.js       # Test catalog
│   │   │   ├── test.model.js             # Patient tests
│   │   │   ├── test.controller.js
│   │   │   ├── test.service.js
│   │   │   ├── test.routes.js
│   │   │   └── test.validator.js
│   │   │
│   │   ├── memberships/
│   │   │   ├── membershipPlan.model.js   # Plan definitions
│   │   │   ├── membership.controller.js
│   │   │   ├── membership.service.js
│   │   │   ├── membership.routes.js
│   │   │   └── membership.validator.js
│   │   │
│   │   ├── billing/
│   │   │   ├── invoice.model.js
│   │   │   ├── billing.controller.js
│   │   │   ├── billing.service.js
│   │   │   ├── billing.routes.js
│   │   │   └── billing.validator.js
│   │   │
│   │   ├── payments/
│   │   │   ├── payment.model.js
│   │   │   ├── payment.controller.js
│   │   │   ├── payment.service.js
│   │   │   ├── payment.routes.js
│   │   │   └── payment.validator.js
│   │   │
│   │   ├── reports/
│   │   │   ├── report.model.js
│   │   │   ├── report.controller.js
│   │   │   ├── report.service.js
│   │   │   ├── report.routes.js
│   │   │   └── report.validator.js
│   │   │
│   │   ├── notifications/
│   │   │   ├── notification.model.js
│   │   │   ├── notification.controller.js
│   │   │   ├── notification.service.js
│   │   │   ├── notification.routes.js
│   │   │   └── notification.validator.js
│   │   │
│   │   └── settings/
│   │       ├── settings.model.js
│   │       ├── settings.controller.js
│   │       ├── settings.service.js
│   │       ├── settings.routes.js
│   │       └── settings.validator.js
│   │
│   ├── utils/
│   │   ├── asyncHandler.js          # Async error wrapper
│   │   ├── ApiResponse.js           # Standardized responses
│   │   ├── AppError.js              # Custom error classes
│   │   ├── generateToken.js         # JWT utilities
│   │   ├── sendEmail.js             # Email helper
│   │   ├── sendSMS.js               # SMS helper
│   │   └── pdfGenerator.js          # Invoice PDF generation
│   │
│   └── routes.js                    # Central route aggregator
│
├── uploads/                         # Temp upload directory
├── app.js                           # Express app config
├── server.js                        # Entry point
├── .env                             # Environment variables
└── package.json
```

---

## 2. Core Entities & Relationships

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    User     │       │   Patient   │       │   Clinic    │
│  (Admin/    │       │             │       │  (2 locs)   │
│   Staff)    │       │             │       │             │
└──────┬──────┘       └──────┬──────┘       └──────┬──────┘
       │                     │                     │
       │              ┌──────┴──────┐              │
       │              │             │              │
       ▼              ▼             ▼              ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Appointment │◄─│ Membership  │  │  Treatment  │
│             │  │  (Patient)  │  │   Master    │
└──────┬──────┘  └─────────────┘  └──────┬──────┘
       │                                  │
       ├──────────────┬──────────────────┤
       ▼              ▼                  ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Treatment  │  │    Test     │  │   Report    │
│ (Instance)  │  │ (Instance)  │  │   (PDF)     │
└──────┬──────┘  └──────┬──────┘  └─────────────┘
       │                │
       └────────┬───────┘
                ▼
       ┌─────────────┐       ┌─────────────┐
       │   Invoice   │──────►│   Payment   │
       └─────────────┘       └─────────────┘
                                    │
                                    ▼
                            ┌─────────────┐
                            │Notification │
                            └─────────────┘
```

### Relationship Summary

| Parent | Child | Relationship | Storage |
|--------|-------|--------------|---------|
| Patient | Appointments | One-to-Many | Referenced |
| Patient | Membership | One-to-One | Embedded |
| Patient | Treatments | One-to-Many | Referenced |
| Patient | Reports | One-to-Many | Referenced |
| Appointment | Treatments | One-to-Many | Referenced |
| Appointment | Tests | One-to-Many | Referenced |
| Appointment | Invoice | One-to-One | Referenced |
| Invoice | Payments | One-to-Many | Referenced |
| TreatmentMaster | Treatment | One-to-Many | Referenced |
| Clinic | Appointments | One-to-Many | Referenced |

---

## 3. Mongoose Models

### 3.1 User Model (`src/modules/users/user.model.js`)

```javascript
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['admin', 'subadmin'],
    default: 'subadmin'
  },
  permissions: [{
    type: String,
    enum: [
      'manage_patients', 'manage_appointments', 'manage_treatments',
      'manage_tests', 'manage_billing', 'manage_payments',
      'upload_reports', 'manage_memberships', 'view_analytics',
      'manage_settings', 'manage_staff'
    ]
  }],
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  refreshToken: { type: String, select: false }
}, { timestamps: true });

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1, isActive: 1 });
```

### 3.2 Patient Model (`src/modules/patients/patient.model.js`)

```javascript
const membershipSchema = new mongoose.Schema({
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipPlan' },
  planName: String,
  discountPercent: Number,
  startDate: Date,
  expiryDate: Date,
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active'
  },
  purchasedAt: Date,
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }
}, { _id: false });

const patientSchema = new mongoose.Schema({
  // Auth
  phone: { type: String, required: true, unique: true },
  email: { type: String, lowercase: true, sparse: true },
  password: { type: String, select: false },

  // Personal Info
  name: { type: String, required: true, trim: true },
  gender: { type: String, enum: ['male', 'female', 'other'] },
  dateOfBirth: Date,
  age: Number,
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },

  // Medical Info
  bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  allergies: [String],
  medicalHistory: [String],
  emergencyContact: {
    name: String,
    phone: String,
    relation: String
  },

  // Membership (Embedded)
  membership: membershipSchema,
  membershipHistory: [membershipSchema],

  // Meta
  registeredAt: { type: Date, default: Date.now },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  preferredClinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
  isActive: { type: Boolean, default: true },
  notes: String
}, { timestamps: true });

// Indexes
patientSchema.index({ phone: 1 });
patientSchema.index({ email: 1 }, { sparse: true });
patientSchema.index({ name: 'text' });
patientSchema.index({ 'membership.status': 1, 'membership.expiryDate': 1 });

// Virtual: Active Membership Check
patientSchema.virtual('hasMembership').get(function() {
  return this.membership?.status === 'active' &&
         this.membership?.expiryDate > new Date();
});

// Virtual: Get Discount
patientSchema.virtual('discountPercent').get(function() {
  return this.hasMembership ? this.membership.discountPercent : 0;
});
```

### 3.3 Clinic Model (`src/modules/clinics/clinic.model.js`)

```javascript
const operatingHoursSchema = new mongoose.Schema({
  dayOfWeek: { type: Number, min: 0, max: 6 }, // 0=Sunday
  isOpen: { type: Boolean, default: true },
  openTime: { type: String, default: '09:00' },
  closeTime: { type: String, default: '20:00' },
  breakStart: String,
  breakEnd: String
}, { _id: false });

const clinicSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true }, // 'DR' or 'PV'
  address: {
    street: String,
    area: String,
    city: { type: String, default: 'Sonipat' },
    state: { type: String, default: 'Haryana' },
    pincode: String
  },
  phone: [String],
  email: String,

  operatingHours: {
    type: [operatingHoursSchema],
    default: [
      { dayOfWeek: 0, isOpen: false }, // Sunday - by appointment
      { dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '20:00' },
      { dayOfWeek: 2, isOpen: true, openTime: '09:00', closeTime: '20:00' },
      { dayOfWeek: 3, isOpen: true, openTime: '09:00', closeTime: '20:00' },
      { dayOfWeek: 4, isOpen: true, openTime: '09:00', closeTime: '20:00' },
      { dayOfWeek: 5, isOpen: true, openTime: '09:00', closeTime: '20:00' },
      { dayOfWeek: 6, isOpen: true, openTime: '09:00', closeTime: '20:00' }
    ]
  },

  appointmentSettings: {
    slotDuration: { type: Number, default: 30 }, // minutes
    maxDailyAppointments: { type: Number, default: 50 },
    opdFee: { type: Number, default: 300 },
    emergencyOpdFee: { type: Number, default: 500 }
  },

  holidays: [{
    date: Date,
    reason: String
  }],

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Method: Get available slots for a date
clinicSchema.methods.getSlots = function(date) {
  const dayOfWeek = date.getDay();
  const hours = this.operatingHours.find(h => h.dayOfWeek === dayOfWeek);

  if (!hours || !hours.isOpen) return [];

  const slots = [];
  const [openHour, openMin] = hours.openTime.split(':').map(Number);
  const [closeHour, closeMin] = hours.closeTime.split(':').map(Number);

  let current = openHour * 60 + openMin;
  const end = closeHour * 60 + closeMin;

  while (current < end) {
    const hour = Math.floor(current / 60);
    const min = current % 60;
    slots.push(`${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    current += this.appointmentSettings.slotDuration;
  }

  return slots;
};
```

### 3.4 Appointment Model (`src/modules/appointments/appointment.model.js`)

```javascript
const appointmentSchema = new mongoose.Schema({
  appointmentNumber: { type: String, required: true, unique: true },
  tokenNumber: { type: Number, required: true },

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },

  date: { type: Date, required: true },
  timeSlot: { type: String, required: true }, // "09:00", "09:30"

  type: {
    type: String,
    enum: ['regular', 'emergency', 'follow_up'],
    default: 'regular'
  },

  status: {
    type: String,
    enum: ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled'],
    default: 'scheduled'
  },

  purpose: String,
  chiefComplaint: String,

  // OPD Fee
  opdFee: { type: Number, required: true },
  opdFeeStatus: {
    type: String,
    enum: ['pending', 'paid', 'waived'],
    default: 'pending'
  },

  // Linked Records
  treatments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Treatment' }],
  tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Test' }],
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },

  // Follow-up
  nextVisit: {
    recommended: Boolean,
    scheduledDate: Date,
    scheduledAppointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    notes: String
  },

  // Notes
  clinicalNotes: String,
  prescriptions: String,

  // Audit
  bookedBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'bookedByModel' },
  bookedByModel: { type: String, enum: ['User', 'Patient'] },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'cancelledByModel' },
  cancelledByModel: { type: String, enum: ['User', 'Patient'] },
  cancellationReason: String,

  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: mongoose.Schema.Types.ObjectId,
    reason: String
  }]
}, { timestamps: true });

// Compound Indexes
appointmentSchema.index({ clinic: 1, date: 1, timeSlot: 1 }, { unique: true });
appointmentSchema.index({ patient: 1, date: -1 });
appointmentSchema.index({ status: 1, date: 1 });
appointmentSchema.index({ date: 1, clinic: 1, status: 1 });

// Static: Generate appointment number
appointmentSchema.statics.generateNumber = async function(clinicCode) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `${clinicCode}-${dateStr}`;

  const lastAppointment = await this.findOne({
    appointmentNumber: new RegExp(`^${prefix}`)
  }).sort({ appointmentNumber: -1 });

  const sequence = lastAppointment
    ? parseInt(lastAppointment.appointmentNumber.split('-').pop()) + 1
    : 1;

  return `${prefix}-${String(sequence).padStart(3, '0')}`;
};

// Static: Get next token number for the day
appointmentSchema.statics.getNextToken = async function(clinicId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const lastAppointment = await this.findOne({
    clinic: clinicId,
    date: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ tokenNumber: -1 });

  return (lastAppointment?.tokenNumber || 0) + 1;
};
```

### 3.5 Treatment Master Model (`src/modules/treatments/treatmentMaster.model.js`)

```javascript
const treatmentMasterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  category: {
    type: String,
    enum: ['restorative', 'cosmetic', 'orthodontic', 'surgical', 'specialized', 'diagnostic'],
    required: true
  },
  description: String,

  baseCost: { type: Number, required: true, default: 20000 },
  averageDuration: { type: Number, default: 120 }, // minutes
  sessionsRequired: { type: Number, default: 1 },

  followUp: {
    required: { type: Boolean, default: true },
    periodMonths: { type: Number, min: 2, max: 6, default: 3 },
    reminderDaysBefore: { type: Number, default: 7 }
  },

  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });
```

### 3.6 Treatment Instance Model (`src/modules/treatments/treatment.model.js`)

```javascript
const treatmentSchema = new mongoose.Schema({
  treatmentMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'TreatmentMaster', required: true },
  treatmentName: String, // Denormalized for queries

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
  clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },

  // Pricing
  baseCost: { type: Number, required: true },
  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  finalCost: { type: Number, required: true },

  // Status
  status: {
    type: String,
    enum: ['planned', 'in_progress', 'completed', 'cancelled'],
    default: 'planned'
  },

  // Sessions
  sessionsPlanned: { type: Number, default: 1 },
  sessionsCompleted: { type: Number, default: 0 },
  sessions: [{
    sessionNumber: Number,
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    notes: String,
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  // Follow-up
  followUp: {
    required: Boolean,
    scheduledDate: Date,
    status: { type: String, enum: ['pending', 'scheduled', 'completed', 'skipped'] },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' }
  },

  notes: String,
  toothNumber: [Number], // For tooth-specific treatments

  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: Date
}, { timestamps: true });

// Indexes
treatmentSchema.index({ patient: 1, status: 1 });
treatmentSchema.index({ appointment: 1 });
treatmentSchema.index({ 'followUp.scheduledDate': 1, 'followUp.status': 1 });
```

### 3.7 Test Master Model (`src/modules/tests/testMaster.model.js`)

```javascript
const testMasterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  category: {
    type: String,
    enum: ['imaging', 'laboratory', 'diagnostic'],
    required: true
  },
  description: String,
  cost: { type: Number, required: true },

  reportRequired: { type: Boolean, default: true },
  turnaroundTime: { type: Number, default: 24 }, // hours

  isActive: { type: Boolean, default: true },
  sortOrder: Number
}, { timestamps: true });
```

### 3.8 Test Instance Model (`src/modules/tests/test.model.js`)

```javascript
const testSchema = new mongoose.Schema({
  testMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'TestMaster', required: true },
  testName: String, // Denormalized

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
  clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },

  // Pricing
  baseCost: { type: Number, required: true },
  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  finalCost: { type: Number, required: true },

  status: {
    type: String,
    enum: ['ordered', 'sample_collected', 'processing', 'completed', 'cancelled'],
    default: 'ordered'
  },

  // Report
  report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },

  orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: Date,
  notes: String
}, { timestamps: true });

// Indexes
testSchema.index({ patient: 1, status: 1 });
testSchema.index({ appointment: 1 });
```

### 3.9 Membership Plan Model (`src/modules/memberships/membershipPlan.model.js`)

```javascript
const membershipPlanSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  description: String,

  price: { type: Number, required: true },
  validityMonths: { type: Number, required: true, default: 12 },

  discounts: {
    opd: { type: Number, default: 0 },
    treatments: { type: Number, default: 0 },
    tests: { type: Number, default: 0 }
  },

  benefits: [String],

  targetAudience: {
    type: String,
    enum: ['family', 'individual', 'women', 'student', 'senior'],
    default: 'individual'
  },

  isActive: { type: Boolean, default: true },
  sortOrder: Number
}, { timestamps: true });
```

### 3.10 Invoice Model (`src/modules/billing/invoice.model.js`)

```javascript
const invoiceItemSchema = new mongoose.Schema({
  type: { type: String, enum: ['opd', 'treatment', 'test', 'membership', 'other'] },
  referenceId: mongoose.Schema.Types.ObjectId,
  description: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, required: true },
  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },

  items: [invoiceItemSchema],

  subtotal: { type: Number, required: true },
  totalDiscount: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  grandTotal: { type: Number, required: true },

  // Payment Status
  amountPaid: { type: Number, default: 0 },
  amountDue: { type: Number, required: true },
  status: {
    type: String,
    enum: ['draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'refunded'],
    default: 'draft'
  },

  // Linked Payments
  payments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],

  notes: String,
  dueDate: Date,

  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issuedAt: Date,
  paidAt: Date
}, { timestamps: true });

// Indexes
invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ patient: 1, createdAt: -1 });
invoiceSchema.index({ status: 1 });

// Static: Generate invoice number
invoiceSchema.statics.generateNumber = async function(clinicCode) {
  const today = new Date();
  const year = today.getFullYear().toString().slice(-2);
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const prefix = `INV-${clinicCode}-${year}${month}`;

  const lastInvoice = await this.findOne({
    invoiceNumber: new RegExp(`^${prefix}`)
  }).sort({ invoiceNumber: -1 });

  const sequence = lastInvoice
    ? parseInt(lastInvoice.invoiceNumber.split('-').pop()) + 1
    : 1;

  return `${prefix}-${String(sequence).padStart(4, '0')}`;
};
```

### 3.11 Payment Model (`src/modules/payments/payment.model.js`)

```javascript
const paymentSchema = new mongoose.Schema({
  paymentNumber: { type: String, required: true, unique: true },

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },

  amount: { type: Number, required: true },

  method: {
    type: String,
    enum: ['cash', 'upi', 'card', 'razorpay'],
    required: true
  },

  methodDetails: {
    // For UPI
    upiId: String,
    upiTransactionId: String,

    // For Card
    cardLast4: String,
    cardNetwork: String,

    // For Razorpay
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String
  },

  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending'
  },

  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    reason: String
  }],

  // Refund
  refund: {
    amount: Number,
    reason: String,
    refundedAt: Date,
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    razorpayRefundId: String
  },

  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  notes: String
}, { timestamps: true });

// Indexes
paymentSchema.index({ paymentNumber: 1 });
paymentSchema.index({ patient: 1, createdAt: -1 });
paymentSchema.index({ invoice: 1 });
paymentSchema.index({ status: 1 });
```

### 3.12 Report Model (`src/modules/reports/report.model.js`)

```javascript
const reportSchema = new mongoose.Schema({
  reportNumber: { type: String, required: true, unique: true },

  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test' },

  title: { type: String, required: true },
  description: String,

  category: {
    type: String,
    enum: ['xray', 'opg', 'cbct', 'lab_report', 'prescription', 'treatment_plan', 'other'],
    required: true
  },

  // File Info (Cloudinary)
  file: {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    fileName: String,
    fileSize: Number,
    fileType: { type: String, default: 'application/pdf' }
  },

  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Access Control
  isVisibleToPatient: { type: Boolean, default: true },

  notes: String
}, { timestamps: true });

// Indexes
reportSchema.index({ patient: 1, createdAt: -1 });
reportSchema.index({ appointment: 1 });
reportSchema.index({ test: 1 });
reportSchema.index({ category: 1 });
```

### 3.13 Notification Model (`src/modules/notifications/notification.model.js`)

```javascript
const notificationSchema = new mongoose.Schema({
  recipientType: { type: String, enum: ['patient', 'user'], required: true },
  recipientPatient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  type: {
    type: String,
    enum: [
      'appointment_confirmation', 'appointment_reminder', 'appointment_cancelled',
      'payment_received', 'payment_reminder',
      'report_uploaded',
      'membership_activated', 'membership_expiry_reminder', 'membership_expired',
      'follow_up_reminder',
      'general'
    ],
    required: true
  },

  title: { type: String, required: true },
  message: { type: String, required: true },

  channels: [{
    type: { type: String, enum: ['app', 'email', 'sms'] },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    sentAt: Date,
    error: String
  }],

  relatedEntity: {
    type: { type: String, enum: ['appointment', 'payment', 'report', 'membership', 'treatment'] },
    id: mongoose.Schema.Types.ObjectId
  },

  scheduledFor: Date,
  isRead: { type: Boolean, default: false },
  readAt: Date
}, { timestamps: true });

// Indexes
notificationSchema.index({ recipientPatient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientUser: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ scheduledFor: 1, 'channels.status': 1 });
```

### 3.14 Settings Model (`src/modules/settings/settings.model.js`)

```javascript
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
  category: {
    type: String,
    enum: ['general', 'appointment', 'billing', 'notification', 'clinic'],
    default: 'general'
  },
  description: String,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Default settings keys:
// - general.clinic_name
// - general.contact_email
// - general.contact_phone
// - appointment.reminder_days (array: [15, 5, 1])
// - billing.tax_percent
// - notification.sms_enabled
// - notification.email_enabled
```

---

## 4. API Endpoints

### 4.1 Authentication (`/api/auth`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/auth/login` | Admin/Staff login | Public |
| POST | `/auth/patient/login` | Patient login (OTP) | Public |
| POST | `/auth/patient/verify-otp` | Verify patient OTP | Public |
| POST | `/auth/refresh-token` | Refresh access token | Authenticated |
| POST | `/auth/logout` | Logout user | Authenticated |
| POST | `/auth/forgot-password` | Request password reset | Public |
| POST | `/auth/reset-password` | Reset password | Public |

### 4.2 Users (`/api/users`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/users` | List all users | Admin |
| GET | `/users/:id` | Get user by ID | Admin |
| POST | `/users` | Create new user | Admin |
| PATCH | `/users/:id` | Update user | Admin |
| DELETE | `/users/:id` | Deactivate user | Admin |
| PATCH | `/users/:id/permissions` | Update permissions | Admin |
| GET | `/users/me` | Get current user | Authenticated |
| PATCH | `/users/me` | Update current user | Authenticated |
| PATCH | `/users/me/password` | Change password | Authenticated |

### 4.3 Patients (`/api/patients`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/patients` | List patients (paginated) | Staff |
| GET | `/patients/search` | Search patients | Staff |
| GET | `/patients/:id` | Get patient details | Staff |
| POST | `/patients` | Create patient | Staff |
| PATCH | `/patients/:id` | Update patient | Staff |
| DELETE | `/patients/:id` | Deactivate patient | Admin |
| GET | `/patients/:id/appointments` | Patient appointments | Staff |
| GET | `/patients/:id/treatments` | Patient treatments | Staff |
| GET | `/patients/:id/payments` | Patient payments | Staff |
| GET | `/patients/:id/reports` | Patient reports | Staff |
| GET | `/patients/:id/membership` | Membership details | Staff |

### 4.4 Clinics (`/api/clinics`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/clinics` | List clinics | Public |
| GET | `/clinics/:id` | Get clinic details | Public |
| POST | `/clinics` | Create clinic | Admin |
| PATCH | `/clinics/:id` | Update clinic | Admin |
| PATCH | `/clinics/:id/hours` | Update operating hours | Admin |
| POST | `/clinics/:id/holidays` | Add holiday | Admin |
| DELETE | `/clinics/:id/holidays/:holidayId` | Remove holiday | Admin |
| GET | `/clinics/:id/slots` | Get available slots | Public |

### 4.5 Appointments (`/api/appointments`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/appointments` | List appointments | Staff |
| GET | `/appointments/today` | Today's appointments | Staff |
| GET | `/appointments/upcoming` | Upcoming appointments | Staff |
| GET | `/appointments/:id` | Get appointment | Staff |
| POST | `/appointments` | Create appointment | Staff/Patient |
| PATCH | `/appointments/:id` | Update appointment | Staff |
| PATCH | `/appointments/:id/status` | Update status | Staff |
| POST | `/appointments/:id/check-in` | Check-in patient | Staff |
| POST | `/appointments/:id/complete` | Complete appointment | Staff |
| POST | `/appointments/:id/cancel` | Cancel appointment | Staff/Patient |
| POST | `/appointments/:id/reschedule` | Reschedule | Staff/Patient |
| GET | `/appointments/available-slots` | Get available slots | Public |

### 4.6 Treatments (`/api/treatments`)

**Treatment Master (Catalog)**
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/treatments/master` | List treatment types | Public |
| GET | `/treatments/master/:id` | Get treatment type | Public |
| POST | `/treatments/master` | Create treatment type | Admin |
| PATCH | `/treatments/master/:id` | Update treatment type | Admin |
| DELETE | `/treatments/master/:id` | Deactivate | Admin |

**Treatment Instances**
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/treatments` | List treatments | Staff |
| GET | `/treatments/:id` | Get treatment | Staff |
| POST | `/treatments` | Add treatment to appointment | Staff |
| PATCH | `/treatments/:id` | Update treatment | Staff |
| PATCH | `/treatments/:id/status` | Update status | Staff |
| POST | `/treatments/:id/session` | Add session | Staff |
| POST | `/treatments/:id/follow-up` | Schedule follow-up | Staff |

### 4.7 Tests (`/api/tests`)

**Test Master (Catalog)**
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/tests/master` | List test types | Public |
| GET | `/tests/master/:id` | Get test type | Public |
| POST | `/tests/master` | Create test type | Admin |
| PATCH | `/tests/master/:id` | Update test type | Admin |
| DELETE | `/tests/master/:id` | Deactivate | Admin |

**Test Instances**
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/tests` | List tests | Staff |
| GET | `/tests/:id` | Get test | Staff |
| POST | `/tests` | Order test | Staff |
| PATCH | `/tests/:id` | Update test | Staff |
| PATCH | `/tests/:id/status` | Update status | Staff |

### 4.8 Memberships (`/api/memberships`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/memberships/plans` | List plans | Public |
| GET | `/memberships/plans/:id` | Get plan | Public |
| POST | `/memberships/plans` | Create plan | Admin |
| PATCH | `/memberships/plans/:id` | Update plan | Admin |
| DELETE | `/memberships/plans/:id` | Deactivate | Admin |
| POST | `/memberships/assign` | Assign to patient | Staff |
| POST | `/memberships/renew/:patientId` | Renew membership | Staff |
| POST | `/memberships/cancel/:patientId` | Cancel membership | Admin |

### 4.9 Billing (`/api/billing`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/billing/invoices` | List invoices | Staff |
| GET | `/billing/invoices/:id` | Get invoice | Staff |
| POST | `/billing/invoices` | Create invoice | Staff |
| PATCH | `/billing/invoices/:id` | Update invoice | Staff |
| POST | `/billing/invoices/:id/issue` | Issue invoice | Staff |
| POST | `/billing/invoices/:id/cancel` | Cancel invoice | Admin |
| GET | `/billing/invoices/:id/pdf` | Download PDF | Staff |

### 4.10 Payments (`/api/payments`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/payments` | List payments | Staff |
| GET | `/payments/:id` | Get payment | Staff |
| POST | `/payments` | Record payment | Staff |
| POST | `/payments/razorpay/create-order` | Create Razorpay order | Staff/Patient |
| POST | `/payments/razorpay/verify` | Verify Razorpay payment | Staff/Patient |
| POST | `/payments/:id/refund` | Process refund | Admin |

### 4.11 Reports (`/api/reports`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/reports` | List reports | Staff |
| GET | `/reports/:id` | Get report | Staff |
| POST | `/reports` | Upload report | Staff |
| PATCH | `/reports/:id` | Update report | Staff |
| DELETE | `/reports/:id` | Delete report | Admin |
| GET | `/reports/:id/download` | Download PDF | Staff/Patient |

### 4.12 Notifications (`/api/notifications`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/notifications` | List notifications | Authenticated |
| GET | `/notifications/unread-count` | Get unread count | Authenticated |
| PATCH | `/notifications/:id/read` | Mark as read | Authenticated |
| PATCH | `/notifications/read-all` | Mark all as read | Authenticated |
| POST | `/notifications/send` | Send notification | Staff |

### 4.13 Settings (`/api/settings`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/settings` | Get all settings | Admin |
| GET | `/settings/:key` | Get setting by key | Admin |
| PATCH | `/settings/:key` | Update setting | Admin |

### 4.14 Patient Portal (`/api/portal`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/portal/dashboard` | Patient dashboard | Patient |
| GET | `/portal/appointments` | My appointments | Patient |
| GET | `/portal/appointments/:id` | Appointment detail | Patient |
| POST | `/portal/appointments` | Book appointment | Patient |
| POST | `/portal/appointments/:id/cancel` | Cancel appointment | Patient |
| GET | `/portal/payments` | My payments | Patient |
| GET | `/portal/reports` | My reports | Patient |
| GET | `/portal/reports/:id/download` | Download report | Patient |
| GET | `/portal/membership` | My membership | Patient |

### 4.15 Dashboard/Analytics (`/api/dashboard`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/dashboard/stats` | Overview stats | Staff |
| GET | `/dashboard/appointments/today` | Today's summary | Staff |
| GET | `/dashboard/revenue` | Revenue stats | Admin |
| GET | `/dashboard/patients/new` | New patients | Staff |

---

## 5. Zod Validation Schemas

### 5.1 Common Validators (`src/utils/validators/common.validator.js`)

```javascript
import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

export const phoneSchema = z.string()
  .regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number');

export const emailSchema = z.string().email().toLowerCase();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const dateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date()
}).refine(data => data.endDate >= data.startDate, {
  message: 'End date must be after start date'
});
```

### 5.2 Auth Validators (`src/modules/auth/auth.validator.js`)

```javascript
import { z } from 'zod';
import { emailSchema, phoneSchema } from '../../utils/validators/common.validator.js';

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(6)
  })
});

export const patientLoginSchema = z.object({
  body: z.object({
    phone: phoneSchema
  })
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    otp: z.string().length(6)
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string(),
    password: z.string().min(8)
      .regex(/[A-Z]/, 'Must contain uppercase')
      .regex(/[a-z]/, 'Must contain lowercase')
      .regex(/[0-9]/, 'Must contain number')
  })
});
```

### 5.3 User Validators (`src/modules/users/user.validator.js`)

```javascript
import { z } from 'zod';
import { emailSchema, phoneSchema, objectIdSchema } from '../../utils/validators/common.validator.js';

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    email: emailSchema,
    phone: phoneSchema,
    password: z.string().min(8),
    role: z.enum(['admin', 'subadmin']),
    permissions: z.array(z.string()).optional()
  })
});

export const updateUserSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    isActive: z.boolean().optional()
  })
});

export const updatePermissionsSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: z.object({
    permissions: z.array(z.enum([
      'manage_patients', 'manage_appointments', 'manage_treatments',
      'manage_tests', 'manage_billing', 'manage_payments',
      'upload_reports', 'manage_memberships', 'view_analytics',
      'manage_settings', 'manage_staff'
    ]))
  })
});
```

### 5.4 Patient Validators (`src/modules/patients/patient.validator.js`)

```javascript
import { z } from 'zod';
import { emailSchema, phoneSchema, objectIdSchema } from '../../utils/validators/common.validator.js';

export const createPatientSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    phone: phoneSchema,
    email: emailSchema.optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    dateOfBirth: z.coerce.date().optional(),
    age: z.number().int().min(0).max(120).optional(),
    address: z.object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().regex(/^\d{6}$/).optional()
    }).optional(),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
    allergies: z.array(z.string()).optional(),
    medicalHistory: z.array(z.string()).optional(),
    emergencyContact: z.object({
      name: z.string(),
      phone: phoneSchema,
      relation: z.string()
    }).optional(),
    preferredClinic: objectIdSchema.optional()
  })
});

export const updatePatientSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: createPatientSchema.shape.body.partial()
});

export const searchPatientSchema = z.object({
  query: z.object({
    q: z.string().min(2).optional(),
    phone: z.string().optional(),
    membership: z.enum(['active', 'expired', 'none']).optional()
  })
});
```

### 5.5 Appointment Validators (`src/modules/appointments/appointment.validator.js`)

```javascript
import { z } from 'zod';
import { objectIdSchema } from '../../utils/validators/common.validator.js';

export const createAppointmentSchema = z.object({
  body: z.object({
    patient: objectIdSchema,
    clinic: objectIdSchema,
    date: z.coerce.date().refine(d => d >= new Date().setHours(0,0,0,0), {
      message: 'Date cannot be in the past'
    }),
    timeSlot: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    type: z.enum(['regular', 'emergency', 'follow_up']).default('regular'),
    purpose: z.string().max(500).optional(),
    chiefComplaint: z.string().max(1000).optional()
  })
});

export const updateAppointmentSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: z.object({
    purpose: z.string().max(500).optional(),
    chiefComplaint: z.string().max(1000).optional(),
    clinicalNotes: z.string().optional(),
    prescriptions: z.string().optional()
  })
});

export const updateStatusSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: z.object({
    status: z.enum(['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show']),
    reason: z.string().optional()
  })
});

export const rescheduleSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: z.object({
    newDate: z.coerce.date(),
    newTimeSlot: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    reason: z.string().optional()
  })
});

export const availableSlotsSchema = z.object({
  query: z.object({
    clinicId: objectIdSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
});
```

### 5.6 Treatment Validators (`src/modules/treatments/treatment.validator.js`)

```javascript
import { z } from 'zod';
import { objectIdSchema } from '../../utils/validators/common.validator.js';

export const createTreatmentMasterSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(200),
    code: z.string().min(2).max(20).toUpperCase(),
    category: z.enum(['restorative', 'cosmetic', 'orthodontic', 'surgical', 'specialized', 'diagnostic']),
    description: z.string().max(1000).optional(),
    baseCost: z.number().positive(),
    averageDuration: z.number().int().positive().default(120),
    sessionsRequired: z.number().int().positive().default(1),
    followUp: z.object({
      required: z.boolean().default(true),
      periodMonths: z.number().int().min(2).max(6).default(3),
      reminderDaysBefore: z.number().int().default(7)
    }).optional()
  })
});

export const addTreatmentSchema = z.object({
  body: z.object({
    treatmentMaster: objectIdSchema,
    patient: objectIdSchema,
    appointment: objectIdSchema,
    notes: z.string().optional(),
    toothNumber: z.array(z.number().int().min(1).max(32)).optional()
  })
});
```

### 5.7 Payment Validators (`src/modules/payments/payment.validator.js`)

```javascript
import { z } from 'zod';
import { objectIdSchema } from '../../utils/validators/common.validator.js';

export const recordPaymentSchema = z.object({
  body: z.object({
    invoice: objectIdSchema,
    amount: z.number().positive(),
    method: z.enum(['cash', 'upi', 'card', 'razorpay']),
    methodDetails: z.object({
      upiId: z.string().optional(),
      upiTransactionId: z.string().optional(),
      cardLast4: z.string().length(4).optional(),
      cardNetwork: z.string().optional()
    }).optional(),
    notes: z.string().optional()
  })
});

export const createRazorpayOrderSchema = z.object({
  body: z.object({
    invoiceId: objectIdSchema,
    amount: z.number().positive()
  })
});

export const verifyRazorpaySchema = z.object({
  body: z.object({
    razorpay_order_id: z.string(),
    razorpay_payment_id: z.string(),
    razorpay_signature: z.string(),
    paymentId: objectIdSchema
  })
});

export const refundSchema = z.object({
  params: z.object({
    id: objectIdSchema
  }),
  body: z.object({
    amount: z.number().positive(),
    reason: z.string().min(10)
  })
});
```

### 5.8 Report Validators (`src/modules/reports/report.validator.js`)

```javascript
import { z } from 'zod';
import { objectIdSchema } from '../../utils/validators/common.validator.js';

export const uploadReportSchema = z.object({
  body: z.object({
    patient: objectIdSchema,
    appointment: objectIdSchema.optional(),
    test: objectIdSchema.optional(),
    title: z.string().min(2).max(200),
    description: z.string().max(1000).optional(),
    category: z.enum(['xray', 'opg', 'cbct', 'lab_report', 'prescription', 'treatment_plan', 'other']),
    isVisibleToPatient: z.boolean().default(true)
  })
});

// File validation handled by Multer middleware
export const fileValidation = {
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  maxSize: 10 * 1024 * 1024 // 10MB
};
```

---

## 6. Middleware Architecture

### 6.1 Authentication Middleware (`src/middlewares/auth.middleware.js`)

```javascript
import jwt from 'jsonwebtoken';
import User from '../modules/users/user.model.js';
import Patient from '../modules/patients/patient.model.js';
import { UnauthorizedError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('No token provided');
  }

  const token = authHeader.split(' ')[1];

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  let user;
  if (decoded.type === 'patient') {
    user = await Patient.findById(decoded.id);
    req.userType = 'patient';
  } else {
    user = await User.findById(decoded.id);
    req.userType = 'user';
  }

  if (!user || !user.isActive) {
    throw new UnauthorizedError('User not found or inactive');
  }

  req.user = user;
  next();
});

// Optional authentication (doesn't fail if no token)
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type === 'patient') {
      req.user = await Patient.findById(decoded.id);
      req.userType = 'patient';
    } else {
      req.user = await User.findById(decoded.id);
      req.userType = 'user';
    }
  } catch (error) {
    // Ignore token errors for optional auth
  }

  next();
});
```

### 6.2 Role Middleware (`src/middlewares/role.middleware.js`)

```javascript
import { ForbiddenError } from '../utils/AppError.js';

// Restrict to specific roles
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (req.userType === 'patient') {
      if (!roles.includes('patient')) {
        throw new ForbiddenError('Access denied');
      }
      return next();
    }

    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError('Access denied');
    }

    next();
  };
};

// Check specific permission
export const hasPermission = (...permissions) => {
  return (req, res, next) => {
    // Admins have all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    const hasRequired = permissions.some(p =>
      req.user.permissions.includes(p)
    );

    if (!hasRequired) {
      throw new ForbiddenError('Insufficient permissions');
    }

    next();
  };
};

// Patient can only access own resources
export const patientOwnerOnly = (patientIdField = 'patient') => {
  return (req, res, next) => {
    if (req.userType !== 'patient') {
      return next(); // Staff can access all
    }

    const resourcePatientId = req.params[patientIdField] || req.body[patientIdField];

    if (resourcePatientId && resourcePatientId !== req.user._id.toString()) {
      throw new ForbiddenError('Access denied');
    }

    next();
  };
};
```

### 6.3 Validation Middleware (`src/middlewares/validate.middleware.js`)

```javascript
import { ZodError } from 'zod';
import { ValidationError } from '../utils/AppError.js';

export const validate = (schema) => {
  return async (req, res, next) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        throw new ValidationError(errors);
      }
      throw error;
    }
  };
};
```

### 6.4 Upload Middleware (`src/middlewares/upload.middleware.js`)

```javascript
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { BadRequestError } from '../utils/AppError.js';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer memory storage
const storage = multer.memoryStorage();

// File filter
const fileFilter = (allowedTypes) => (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`), false);
  }
};

// PDF upload configuration
export const uploadPDF = multer({
  storage,
  fileFilter: fileFilter(['application/pdf']),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Image upload configuration
export const uploadImage = multer({
  storage,
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'image/webp']),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Upload to Cloudinary
export const uploadToCloudinary = async (file, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `ujjwal-dental/${folder}`,
        resource_type: 'auto',
        access_mode: 'authenticated' // Secure access
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          size: result.bytes
        });
      }
    );

    uploadStream.end(file.buffer);
  });
};

// Delete from Cloudinary
export const deleteFromCloudinary = async (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

// Middleware to handle upload and save to Cloudinary
export const handleFileUpload = (folder) => async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    const result = await uploadToCloudinary(req.file, folder);
    req.uploadedFile = {
      url: result.url,
      publicId: result.publicId,
      fileName: req.file.originalname,
      fileSize: result.size,
      fileType: req.file.mimetype
    };
    next();
  } catch (error) {
    next(new BadRequestError('File upload failed'));
  }
};
```

---

## 7. Centralized Error Handling

### 7.1 Custom Error Classes (`src/utils/AppError.js`)

```javascript
export class AppError extends Error {
  constructor(message, statusCode, errors = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(errors) {
    super('Validation failed', 400, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

export class PaymentError extends AppError {
  constructor(message = 'Payment processing failed') {
    super(message, 402);
  }
}

export class SlotUnavailableError extends AppError {
  constructor() {
    super('Selected time slot is no longer available', 409);
  }
}
```

### 7.2 Error Handler Middleware (`src/middlewares/error.middleware.js`)

```javascript
import { AppError } from '../utils/AppError.js';

const handleCastErrorDB = (err) => {
  return new AppError(`Invalid ${err.path}: ${err.value}`, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  return new AppError(`Duplicate value for: ${field}`, 409);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(e => ({
    field: e.path,
    message: e.message
  }));
  return new AppError('Validation failed', 400, errors);
};

const handleJWTError = () =>
  new AppError('Invalid token', 401);

const handleJWTExpiredError = () =>
  new AppError('Token expired', 401);

const errorMiddleware = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Handle specific error types
  let error = { ...err, message: err.message };

  if (err.name === 'CastError') error = handleCastErrorDB(err);
  if (err.code === 11000) error = handleDuplicateFieldsDB(err);
  if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  // Response
  const response = {
    success: false,
    status: error.status || 'error',
    message: error.message || 'Something went wrong'
  };

  if (error.errors) {
    response.errors = error.errors;
  }

  // Include stack in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(error.statusCode || 500).json(response);
};

export default errorMiddleware;
```

### 7.3 Async Handler (`src/utils/asyncHandler.js`)

```javascript
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

### 7.4 API Response Utility (`src/utils/ApiResponse.js`)

```javascript
export class ApiResponse {
  constructor(statusCode, data, message = 'Success') {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }

  static success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  static created(res, data, message = 'Created successfully') {
    return res.status(201).json({
      success: true,
      message,
      data
    });
  }

  static paginated(res, data, pagination, message = 'Success') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination
    });
  }
}
```

---

## 8. File Upload (Multer + Cloudinary)

### 8.1 Cloudinary Configuration (`src/config/cloudinary.js`)

```javascript
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export default cloudinary;
```

### 8.2 Upload Service (`src/utils/uploadService.js`)

```javascript
import cloudinary from '../config/cloudinary.js';

export const uploadFile = async (file, options = {}) => {
  const {
    folder = 'general',
    resourceType = 'auto',
    accessMode = 'authenticated'
  } = options;

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `ujjwal-dental/${folder}`,
        resource_type: resourceType,
        access_mode: accessMode
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          size: result.bytes,
          width: result.width,
          height: result.height
        });
      }
    );

    uploadStream.end(file.buffer);
  });
};

export const deleteFile = async (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

export const getSignedUrl = async (publicId, expiresIn = 3600) => {
  return cloudinary.url(publicId, {
    sign_url: true,
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + expiresIn
  });
};
```

### 8.3 Report Upload Example (`src/modules/reports/report.controller.js`)

```javascript
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import * as reportService from './report.service.js';

export const uploadReport = asyncHandler(async (req, res) => {
  const reportData = {
    ...req.body,
    file: req.uploadedFile, // From upload middleware
    uploadedBy: req.user._id
  };

  const report = await reportService.createReport(reportData);

  // Send notification to patient
  await reportService.notifyPatient(report);

  ApiResponse.created(res, report, 'Report uploaded successfully');
});
```

---

## 9. Edge Cases & Risk Mitigation

### 9.1 Concurrent Booking Conflicts

**Problem:** Two users booking the same slot simultaneously.

**Solution:** Database transaction with unique compound index.

```javascript
// Appointment model already has compound index:
// { clinic: 1, date: 1, timeSlot: 1 } - unique

export const bookAppointment = async (data, session) => {
  const mongoSession = await mongoose.startSession();
  mongoSession.startTransaction();

  try {
    // Check slot availability within transaction
    const existing = await Appointment.findOne({
      clinic: data.clinic,
      date: data.date,
      timeSlot: data.timeSlot,
      status: { $nin: ['cancelled', 'rescheduled'] }
    }).session(mongoSession);

    if (existing) {
      throw new SlotUnavailableError();
    }

    // Check daily limit
    const dailyCount = await Appointment.countDocuments({
      clinic: data.clinic,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['cancelled', 'rescheduled'] }
    }).session(mongoSession);

    if (dailyCount >= MAX_DAILY) {
      throw new BadRequestError('No slots available');
    }

    const appointment = await Appointment.create([data], { session: mongoSession });

    await mongoSession.commitTransaction();
    return appointment[0];

  } catch (error) {
    await mongoSession.abortTransaction();
    throw error;
  } finally {
    mongoSession.endSession();
  }
};
```

### 9.2 Membership Expiry Handling

**Solution:** Scheduled job to check and update expired memberships.

```javascript
// Run daily at midnight
import cron from 'node-cron';

cron.schedule('0 0 * * *', async () => {
  // Expire memberships
  await Patient.updateMany(
    {
      'membership.status': 'active',
      'membership.expiryDate': { $lt: new Date() }
    },
    { $set: { 'membership.status': 'expired' } }
  );

  // Send expiry reminders (30, 7, 1 days before)
  for (const days of [30, 7, 1]) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + days);

    const patients = await Patient.find({
      'membership.status': 'active',
      'membership.expiryDate': {
        $gte: targetDate,
        $lt: new Date(targetDate.getTime() + 86400000)
      }
    });

    for (const patient of patients) {
      await notificationService.send({
        type: 'membership_expiry_reminder',
        patient: patient._id,
        daysRemaining: days
      });
    }
  }
});
```

### 9.3 Payment Failure Scenarios

```javascript
// Razorpay webhook handler
export const handleWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  const isValid = razorpay.validateWebhookSignature(
    JSON.stringify(req.body),
    signature,
    process.env.RAZORPAY_WEBHOOK_SECRET
  );

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { event, payload } = req.body;

  switch (event) {
    case 'payment.captured':
      await paymentService.confirmPayment(payload.payment.entity);
      break;

    case 'payment.failed':
      await paymentService.failPayment(payload.payment.entity);
      await notificationService.sendPaymentFailed(payload.payment.entity);
      break;

    case 'refund.processed':
      await paymentService.confirmRefund(payload.refund.entity);
      break;
  }

  res.json({ received: true });
};
```

### 9.4 Slot Calculation Edge Cases

```javascript
export const getAvailableSlots = async (clinicId, dateStr) => {
  const clinic = await Clinic.findById(clinicId);
  const date = new Date(dateStr);

  // Check if clinic holiday
  const isHoliday = clinic.holidays.some(h =>
    h.date.toDateString() === date.toDateString()
  );
  if (isHoliday) {
    return { available: [], message: 'Clinic holiday' };
  }

  // Get operating hours
  const dayOfWeek = date.getDay();
  const hours = clinic.operatingHours.find(h => h.dayOfWeek === dayOfWeek);

  if (!hours?.isOpen) {
    return { available: [], message: 'Closed' };
  }

  // Generate slots
  const allSlots = clinic.getSlots(date);

  // Get booked slots
  const booked = await Appointment.find({
    clinic: clinicId,
    date: { $gte: startOfDay(date), $lte: endOfDay(date) },
    status: { $nin: ['cancelled', 'rescheduled'] }
  }).select('timeSlot');

  const bookedSet = new Set(booked.map(a => a.timeSlot));

  // Filter available
  let available = allSlots.filter(slot => !bookedSet.has(slot));

  // If today, filter past slots
  if (isToday(date)) {
    const now = format(new Date(), 'HH:mm');
    available = available.filter(slot => slot > now);
  }

  return {
    available,
    total: allSlots.length,
    booked: bookedSet.size
  };
};
```

### 9.5 Patient Auth — DB Error Masquerading as 401 (Fixed)

**Root cause (2026-07-01):** `patientProtect` in `auth.middleware.js` originally wrapped both
`jwt.verify()` and `Patient.findById()` in a single try/catch. Any transient MongoDB error
(timeout, ECONNRESET, connection pool exhaustion) was caught by the same handler as JWT
errors and returned `401 "Not authorized, token invalid"` instead of a 500. The frontend
401 interceptor treated this as an auth failure and immediately logged the patient out —
even though their token was perfectly valid.

**Fix applied to `patientProtect` only (authProtect/anyAuth/adminOnly unchanged):**
- JWT `verify()` is now in its own isolated try/catch — only genuine JWT errors (expired,
  malformed, bad signature) are caught there.
- `Patient.findById()` is outside that catch, in its own try/catch that calls `next(dbError)`,
  routing MongoDB errors to the Express global error handler and returning 500 instead of 401.

**Why this matters:** The 30-second `usePatientUnreadCount` polling hook means any transient
DB blip during a poll was guaranteed to log the patient out. After this fix, DB errors no
longer reach the 401 interceptor.

### 9.6 Discount Calculation

```javascript
export const calculateBilling = async (patientId, items) => {
  const patient = await Patient.findById(patientId);

  const processedItems = items.map(item => {
    let discount = 0;

    if (patient.hasMembership) {
      const membership = patient.membership;

      switch (item.type) {
        case 'opd':
          discount = membership.discounts?.opd || 0;
          break;
        case 'treatment':
          discount = membership.discounts?.treatments || 0;
          break;
        case 'test':
          discount = membership.discounts?.tests || 0;
          break;
      }
    }

    const discountAmount = (item.unitPrice * discount) / 100;
    const totalAmount = item.unitPrice - discountAmount;

    return {
      ...item,
      discountPercent: discount,
      discountAmount,
      totalAmount
    };
  });

  return processedItems;
};
```

---

## 9.7 Appointment Rescheduling (Admin-only)

### What changes
- `appointment.date` and `appointment.timeSlot` only
- `appointment.status` resets to `"scheduled"`
- `appointment.tokenNumber` + `appointment.tokenDateKey` are regenerated for the new date via `nextDailyToken`
- `appointment.notes` gets a new line appended: `"Rescheduled from [old date] [old slot] to [new date] [new slot] — Reason: ..."` (existing notes preserved)
- An in-app notification (`type: "appointment_reschedule"`) is sent to the patient

### What does NOT change
- `appointment.invoice`, `appointment.paymentStatus`, `appointment.opdFeePaid`, `appointment.amountPaid` — untouched
- `appointment.patient`, `appointment.clinic`, `appointment.fee`, `appointment.treatmentId` — untouched
- `appointment.appointmentNumber` — untouched

### Security
- Route: `POST /api/appointments/:id/reschedule` — requires `authProtect` (admin/staff only)
- Slot check is server-side: `countDocuments` (capacity-aware, excludes self) — not just `findOne`
- Past dates and past time slots for today are rejected with 400

### Frontend
- `RescheduleAppointmentModal.jsx` — new modal in `frontend/src/components/admin/modals/`
- Reschedule button (cyan `EventRepeatIcon`) added to each row for `scheduled` and `confirmed` appointments only

---

## 9.8 Patient Portal Sync After Reschedule (2026-07-01)

### How updated date/time reaches the patient

No websockets or SSE are used. Sync is purely poll-based:

| Mechanism | Setting | Notes |
|-----------|---------|-------|
| `useMyAppointments` staleTime | 30 s | Background staleness threshold |
| `useMyAppointments` refetchOnMount | `"always"` | **Always** fetches fresh data on page navigation, regardless of staleness |
| `useMyAppointments` refetchOnWindowFocus | `true` | Overrides global `false` — refetches when patient switches back to the browser tab |
| `useMyAppointments` refetchInterval | 60 s | Background auto-refresh every 60 s while page is mounted |
| `usePatientUnreadCount` refetchInterval | 30 s | Polls notification count; patient sees "new notification" badge within 30 s |

After admin reschedules: the patient sees the updated date/time **immediately on next page navigation or tab focus**, and within **at most 60 seconds** on the currently open page via background interval.

### Bug fix (2026-07-01) — Stale data after reschedule

**Root cause:** The global `QueryClient` in `main.jsx` sets `refetchOnWindowFocus: false` and `staleTime: 5 * 60 * 1000`. `useMyAppointments` was not overriding these, so:
- Switching browser tabs never triggered a refetch
- Navigating to the detail page within 30 s of last fetch served cached (old) data
- `AppointmentDetail.jsx` has no independent query — it finds the appointment by `_id` inside the list returned by `useMyAppointments`, so its freshness was entirely dependent on the list query

**Fix applied to `frontend/src/hooks/patient/useMyAppointments.js`:**
- Added `refetchOnMount: "always"` — page navigation always triggers a fresh API call
- Added `refetchOnWindowFocus: true` — tab focus triggers a fresh API call (overrides global `false`)

**UX improvement applied to `frontend/src/pages/patient/AppointmentDetail.jsx`:**
- Added a manual Refresh icon button in the header that calls `refetch()` directly
- Added "updated Xs ago" caption next to the appointment number

### Rescheduled badge on patient appointments list

`frontend/src/pages/patient/Appointments.jsx` detects rescheduled appointments by:
```js
apt.notes?.includes("Rescheduled from")
```
This string is always prepended by the reschedule handler when it appends the audit trail to `appointment.notes`. When true, a small teal "Rescheduled" chip (with `EventRepeatIcon`) appears below the status chip in the Status column. The status chip itself stays unchanged (still shows "Scheduled" / "Confirmed").

### In-app notification icon

`frontend/src/pages/patient/Notifications.jsx` — `typeIcons["appointment_reschedule"]` is now a teal `EventRepeatIcon` (`#0891b2`). Notifications of type `appointment_reschedule` no longer fall back to the generic gray info icon.

### Email notification

**Skipped.** The reschedule handler passes `sendEmail: false` to `notify()`. No email template exists for appointment reschedule (only confirmation and cancellation templates exist). Tech debt: create an email template for reschedule when email notification coverage is extended.

---

## 9.9 Member Patient Always-Active Invariant (2026-07-01)

### Business rule

A patient with an active membership (`membership.status === "active"` AND `membership.expiryDate > now`) is **always** `isActive: true`. They must never be deactivated while the membership is valid.

### Enforcement layers (defence-in-depth)

| Layer | Where | What it does |
|-------|-------|-------------|
| **1 — Controller guard** | `updatePatient` in `patient.controller.js` | If `req.body.isActive === false` and patient has active membership → returns 400 "Cannot deactivate a patient with an active membership plan..." |
| **2 — Model pre-save hook** | `patient.model.js` second pre('save') hook | Forces `isActive = true` before any save if active membership is detected — catches any code path that bypasses the controller |
| **3 — Frontend guard** | `PatientDetailModal.jsx` | Deactivate button is `disabled={hasMembership}` with MUI Tooltip "Patient has an active membership — cannot deactivate" — was already in place |

### Membership field paths
- Status: `patient.membership.status` (enum: `"active"`, `"expired"`, `"cancelled"`)
- Expiry: `patient.membership.expiryDate` (Date)
- Virtual: `patient.hasMembership` → `true` if status = "active" AND expiryDate > now (included in all JSON responses via `toJSON: { virtuals: true }`)

### One-time data fix (2026-07-01)
Script `backend/src/scripts/fixMemberPatientStatus.js` was run to re-activate patients who had `isActive: false` despite an active membership. Query used:
```js
Patient.find({ "membership.status": "active", "membership.expiryDate": { $gt: new Date() }, isActive: false })
```
Script deletes itself after use.

---

## 10. Implementation Order

### Phase 1: Foundation (Week 1)
1. Database configuration (`src/config/db.js`)
2. Environment setup (`.env`)
3. Constants and utilities
4. Error handling system
5. Authentication middleware
6. User model and auth endpoints

### Phase 2: Core Entities (Week 2)
1. Clinic model and endpoints
2. Patient model and endpoints
3. Appointment model and endpoints
4. Slot availability logic

### Phase 3: Medical & Financial (Week 3)
1. Treatment master and instances
2. Test master and instances
3. Membership plans
4. Invoice model
5. Payment integration (Razorpay)

### Phase 4: Documents & Notifications (Week 4)
1. Report upload (Cloudinary)
2. Notification system
3. Email integration (Nodemailer)
4. SMS integration

### Phase 5: Patient Portal (Week 5)
1. Patient authentication
2. Portal endpoints
3. Access control

### Phase 6: Polish & Testing
1. Scheduled jobs
2. Dashboard/analytics
3. Integration testing
4. API documentation

---

## Environment Variables (`.env`)

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/ujjwal-dental

# JWT
JWT_SECRET=your-super-secret-key-here
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Razorpay
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# Email (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# SMS (Optional - use appropriate provider)
SMS_API_KEY=your-sms-api-key
SMS_SENDER_ID=UJJWAL

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

---

## Verification Checklist

After implementation, verify:

1. **Authentication Flow**
   - [ ] Admin login with JWT
   - [ ] Patient OTP login
   - [ ] Token refresh
   - [ ] Role-based access

2. **Appointment Booking**
   - [ ] Slot availability check
   - [ ] Concurrent booking prevention
   - [ ] Status updates
   - [ ] Cancellation/reschedule

3. **Billing & Payments**
   - [ ] Invoice generation
   - [ ] Membership discounts applied
   - [ ] Razorpay integration
   - [ ] Payment status updates

4. **Reports**
   - [ ] PDF upload to Cloudinary
   - [ ] Patient access control
   - [ ] Secure download

5. **Notifications**
   - [ ] Appointment confirmations
   - [ ] Payment receipts
   - [ ] Report upload alerts

---

**End of Backend Plan**
