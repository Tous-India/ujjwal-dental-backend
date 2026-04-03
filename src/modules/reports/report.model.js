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

    file: {
      // Cloudinary URL
      url: {
        type: String,
        required: [true, "File URL is required"],
      },

      // Cloudinary public ID (for deletion)
      publicId: {
        type: String,
        required: [true, "File public ID is required"],
      },

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

    // Count reports this month
    const count = await mongoose.model("Report").countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lte: new Date(date.getFullYear(), date.getMonth() + 1, 0),
      },
    });

    const serial = (count + 1).toString().padStart(4, "0");
    this.reportNumber = `${prefix}-${year}${month}-${serial}`;
  }
});

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
