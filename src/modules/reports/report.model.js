import mongoose from "mongoose";

/**
 * REPORT MODEL
 *
 * Stores patient reports/documents like:
 * - X-rays, OPG, CBCT scans
 * - Lab reports
 * - Prescriptions
 * - Treatment plans
 *
 * Files are uploaded to Cloudinary
 */

const reportSchema = new mongoose.Schema(
  {
    // Unique report number (auto-generated)
    reportNumber: {
      type: String,
      unique: true,
    },

    // Report title
    title: {
      type: String,
      required: [true, "Report title is required"],
    },

    // Description
    description: String,

    // Category of report
    category: {
      type: String,
      enum: [
        "xray",
        "opg",
        "cbct",
        "lab_report",
        "prescription",
        "treatment_plan",
        "consent_form",
        "other",
      ],
      required: [true, "Report category is required"],
    },

    // -------- Relations --------

    // Patient this report belongs to
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient is required"],
    },

    // Clinic where report was created
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },

    // Related appointment (optional)
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
    },

    // Related test (optional)
    test: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
    },

    // Related treatment (optional)
    treatment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Treatment",
    },

    // -------- File Info (Cloudinary) --------

    // Legacy single-file field -- kept for backward compatibility with
    // reports uploaded before multi-file support. New uploads use `files` below.
    file: {
      // Cloudinary URL
      url: String,

      // Cloudinary public ID (for deletion)
      publicId: String,

      // Original file name
      fileName: String,

      // File size in bytes
      fileSize: Number,

      // MIME type
      fileType: {
        type: String,
        default: "application/pdf",
      },

      // Thumbnail URL (for images)
      thumbnailUrl: String,
    },

    // Multi-file support (up to 10 files per report, each with its own description)
    files: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        fileName: String,
        fileSize: Number,
        fileType: String,
        thumbnailUrl: String,
        description: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // -------- Meta --------

    // Who uploaded this report
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Uploader is required"],
    },

    // Report date (when the test/scan was done)
    reportDate: {
      type: Date,
      default: Date.now,
    },

    // Is this report visible to the patient?
    isVisibleToPatient: {
      type: Boolean,
      default: true,
    },

    // Additional notes
    notes: String,

    // Tags for easy search
    tags: [String],

    // Is the report active (soft delete)
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ============ INDEXES ============

reportSchema.index({ patient: 1, createdAt: -1 });
// reportSchema.index({ reportNumber: 1 });
reportSchema.index({ appointment: 1 });
reportSchema.index({ test: 1 });
reportSchema.index({ category: 1 });
reportSchema.index({ tags: 1 });

// ============ PRE-SAVE MIDDLEWARE ============

/**
 * Find an available report number for the given category prefix + year/month.
 *
 * Uses the count of existing reports with the same prefix as the starting
 * serial, then walks forward until an unused slot is found. This is
 * collision-safe under concurrent creates: we verify existence before
 * returning the number instead of blindly assigning count+1 -- the same
 * proven pattern used for appointmentNumber/invoiceNumber.
 *
 * @param {string} prefix - category prefix, e.g. "XRY"
 * @param {string} year   - 2-digit year, e.g. "26"
 * @param {string} month  - 2-digit month, e.g. "06"
 * @returns {Promise<string>} Available report number, e.g. "XRY-2606-0009"
 */
reportSchema.statics.findAvailableReportNumber = async function (prefix, year, month) {
  const fullPrefix = `${prefix}-${year}${month}-`;

  const count = await this.countDocuments({
    reportNumber: { $regex: `^${fullPrefix}` },
  });

  const MAX_ATTEMPTS = 10;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = `${fullPrefix}${(count + 1 + i).toString().padStart(4, "0")}`;
    const exists = await this.findOne({ reportNumber: candidate }).lean();
    if (!exists) return candidate;
    console.warn(`[Report] reportNumber ${candidate} already taken, trying next...`);
  }

  throw new Error(
    `[Report] Could not find a free report number after ${MAX_ATTEMPTS} attempts (prefix: ${fullPrefix})`
  );
};

/**
 * Generate report number before saving
 * Note: In Mongoose 5+, async middleware should not use next()
 */
reportSchema.pre("save", async function () {
  // Generate report number for new documents
  if (this.isNew) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");

    // Prefix based on category
    const prefixes = {
      xray: "XRY",
      opg: "OPG",
      cbct: "CBT",
      lab_report: "LAB",
      prescription: "RX",
      treatment_plan: "TP",
      consent_form: "CF",
      other: "RPT",
    };

    const prefix = prefixes[this.category] || "RPT";

    this.reportNumber = await mongoose
      .model("Report")
      .findAvailableReportNumber(prefix, year, month);
  }
});

/**
 * Create a report with retry on duplicate reportNumber (E11000).
 *
 * The walk-forward generator above closes most of the collision window, but
 * two truly simultaneous saves can still both pass their "does this number
 * exist" check before either has inserted (classic check-then-act race) --
 * confirmed by a real concurrent-create test. Retrying re-runs the pre-save
 * hook, which regenerates against the now-updated count. Same belt-and-
 * suspenders pattern already proven for Payment.createSafe (paymentNumber).
 * Use this instead of Report.create() at upload call sites.
 */
reportSchema.statics.createSafe = async function (data, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await this.create(data);
    } catch (err) {
      if (err.code === 11000 && err.keyPattern?.reportNumber) {
        console.warn(`[Report] Duplicate reportNumber, retrying... (attempt ${attempt}/${maxAttempts})`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
};

// ============ METHODS ============

/**
 * Hide report from patient
 */
reportSchema.methods.hideFromPatient = function () {
  this.isVisibleToPatient = false;
  return this.save();
};

/**
 * Show report to patient
 */
reportSchema.methods.showToPatient = function () {
  this.isVisibleToPatient = true;
  return this.save();
};

/**
 * Soft delete report
 */
reportSchema.methods.softDelete = function () {
  this.isActive = false;
  return this.save();
};

/**
 * Add tags
 */
reportSchema.methods.addTags = function (tags) {
  const newTags = tags.filter((tag) => !this.tags.includes(tag));
  this.tags.push(...newTags);
  return this.save();
};

// ============ STATICS ============

/**
 * Get all reports for a patient
 */
reportSchema.statics.getPatientReports = function (patientId, options = {}) {
  const query = {
    patient: patientId,
    isActive: true,
  };

  // If viewing as patient, only show visible reports
  if (options.isPatient) {
    query.isVisibleToPatient = true;
  }

  // Filter by category if provided
  if (options.category) {
    query.category = options.category;
  }

  return this.find(query)
    .populate("uploadedBy", "name")
    .sort({ createdAt: -1 });
};

/**
 * Get reports by category for a patient
 */
reportSchema.statics.getReportsByCategory = async function (patientId) {
  const result = await this.aggregate([
    {
      $match: {
        patient: new mongoose.Types.ObjectId(patientId),
        isActive: true,
      },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        reports: {
          $push: {
            _id: "$_id",
            title: "$title",
            reportNumber: "$reportNumber",
            createdAt: "$createdAt",
          },
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  return result;
};

// Create and export the model
const Report = mongoose.model("Report", reportSchema);

export default Report;
