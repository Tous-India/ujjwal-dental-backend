import mongoose from "mongoose";

/**
 * TREATMENT PAGE CMS MODEL
 *
 * Manages standalone treatment pages with rich content sections.
 * Each page is independent and fetched by slug for public display.
 *
 * USAGE:
 * ------
 * // Create new treatment page
 * const page = await TreatmentPage.create({
 *   title: "Root Canal Treatment",
 *   slug: "root-canal-treatment-rct",
 *   hero: { heading: "Root Canal Treatment", subheading: "Painless RCT" }
 * });
 *
 * // Get published page by slug
 * const page = await TreatmentPage.findOne({ slug: "root-canal-treatment-rct", isPublished: true });
 *
 * // Add section
 * page.sections.push({ title: "Benefits", type: "list", items: ["Pain relief", "Save tooth"] });
 * await page.save();
 */

// ============ SUB-SCHEMAS ============

// SEO Metadata
const metaSchema = new mongoose.Schema(
  {
    title: String, // SEO title
    description: String, // Meta description
    keywords: [String], // SEO keywords
    ogImage: String, // Social share image URL
  },
  { _id: false }
);

// Hero Section
const heroSchema = new mongoose.Schema(
  {
    heading: String, // Main heading
    subheading: String, // Subtitle
    image: String, // Hero image URL (Cloudinary)
    ctaText: { type: String, default: "Book Appointment" },
    ctaLink: String, // Button link
  },
  { _id: false }
);

// Overview Section
const overviewSchema = new mongoose.Schema(
  {
    title: String, // "What is Root Canal Treatment?"
    content: String, // HTML/Rich text content
  },
  { _id: false }
);

// Steps (for procedure or step-by-step sections)
const stepSchema = new mongoose.Schema(
  {
    stepNumber: Number,
    title: String,
    description: String,
    image: String, // Cloudinary URL
    duration: String, // "15-20 minutes"
  },
  { _id: false }
);

// Table Data
const tableDataSchema = new mongoose.Schema(
  {
    headers: [String],
    rows: [[String]], // 2D array for table rows
  },
  { _id: false }
);

// Image Data
const imageDataSchema = new mongoose.Schema(
  {
    url: String,
    alt: String,
    caption: String,
  },
  { _id: false }
);

// Video Data
const videoDataSchema = new mongoose.Schema(
  {
    url: String, // YouTube/Vimeo URL
    title: String,
    thumbnail: String,
  },
  { _id: false }
);

// Dynamic Section Schema (supports multiple content types)
const sectionSchema = new mongoose.Schema(
  {
    sectionId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["text", "list", "steps", "table", "image", "video"],
      required: true,
    },
    // Content based on type
    content: String, // For text type (HTML)
    items: [String], // For list type
    steps: [stepSchema], // For steps type
    tableData: tableDataSchema, // For table type
    image: imageDataSchema, // For image type
    video: videoDataSchema, // For video type
    order: {
      type: Number,
      default: 0,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

// FAQ Schema
const faqSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
    },
    answer: {
      type: String,
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

// Pricing Schema
const pricingSchema = new mongoose.Schema(
  {
    startingPrice: Number, // 3000
    maxPrice: Number, // 15000
    priceRange: String, // "₹3,000 - ₹15,000" (auto-generated)
    currency: { type: String, default: "INR" },
    factors: [String], // ["Tooth location", "Severity"]
    note: String, // Additional pricing notes
  },
  { _id: false }
);

// Table of Contents Item
const tocItemSchema = new mongoose.Schema(
  {
    id: String, // Matches section sectionId
    title: String,
    order: Number,
  },
  { _id: false }
);

// ============ MAIN TREATMENT PAGE SCHEMA ============

const treatmentPageSchema = new mongoose.Schema(
  {
    // ========== BASIC INFO ==========
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },

    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    shortDescription: {
      type: String,
      trim: true,
    },

    // ========== SEO METADATA ==========
    meta: metaSchema,

    // ========== HERO SECTION ==========
    hero: heroSchema,

    // ========== OVERVIEW SECTION ==========
    overview: overviewSchema,

    // ========== DYNAMIC SECTIONS ==========
    sections: [sectionSchema],

    // ========== PROCEDURE STEPS (Dedicated Section) ==========
    procedureSteps: [stepSchema],

    // ========== FAQs ==========
    faqs: [faqSchema],

    // ========== PRICING ==========
    pricing: pricingSchema,

    // ========== TABLE OF CONTENTS ==========
    tableOfContents: [tocItemSchema],

    // ========== RELATED TREATMENTS ==========
    relatedTreatments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TreatmentPage",
      },
    ],

    // ========== PUBLISHING ==========
    isPublished: {
      type: Boolean,
      default: false,
    },

    publishedAt: Date,

    // ========== ANALYTICS ==========
    viewCount: {
      type: Number,
      default: 0,
    },

    // ========== CREATED BY ==========
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// ============ INDEXES ============

// treatmentPageSchema.index({ slug: 1 });
treatmentPageSchema.index({ isPublished: 1 });
treatmentPageSchema.index({ title: "text", shortDescription: "text" });

// ============ PRE-SAVE MIDDLEWARE ============

/**
 * Auto-generate slug from title if not provided
 * Auto-generate sectionId for sections
 * Auto-generate table of contents
 * Auto-generate price range string
 */
treatmentPageSchema.pre("save", function () {
  // Generate slug from title if not provided
  if (!this.slug && this.title) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // Generate sectionId for sections without one
  this.sections.forEach((section, index) => {
    if (!section.sectionId) {
      section.sectionId = section.title
        ? section.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
        : `section-${index + 1}`;
    }
    // Ensure order is set
    if (section.order === undefined || section.order === null) {
      section.order = index;
    }
  });

  // Auto-generate table of contents from visible sections
  this.tableOfContents = this.sections
    .filter((s) => s.isVisible)
    .sort((a, b) => a.order - b.order)
    .map((section, index) => ({
      id: section.sectionId,
      title: section.title,
      order: index,
    }));

  // Auto-generate price range string
  if (this.pricing && this.pricing.startingPrice) {
    const formatter = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: this.pricing.currency || "INR",
      maximumFractionDigits: 0,
    });

    if (this.pricing.maxPrice) {
      this.pricing.priceRange = `${formatter.format(this.pricing.startingPrice)} - ${formatter.format(this.pricing.maxPrice)}`;
    } else {
      this.pricing.priceRange = `Starting from ${formatter.format(this.pricing.startingPrice)}`;
    }
  }
});

// ============ INSTANCE METHODS ============

/**
 * Publish the treatment page
 */
treatmentPageSchema.methods.publish = async function () {
  this.isPublished = true;
  this.publishedAt = new Date();
  return this.save();
};

/**
 * Unpublish the treatment page
 */
treatmentPageSchema.methods.unpublish = async function () {
  this.isPublished = false;
  return this.save();
};

/**
 * Increment view count
 */
treatmentPageSchema.methods.incrementViews = async function () {
  this.viewCount += 1;
  return this.save();
};

/**
 * Add a new section
 */
treatmentPageSchema.methods.addSection = async function (sectionData) {
  const maxOrder = this.sections.reduce(
    (max, s) => Math.max(max, s.order || 0),
    -1
  );

  const section = {
    ...sectionData,
    order: sectionData.order ?? maxOrder + 1,
    sectionId:
      sectionData.sectionId ||
      sectionData.title
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") ||
      `section-${this.sections.length + 1}`,
  };

  this.sections.push(section);
  return this.save();
};

/**
 * Update a section by ID
 */
treatmentPageSchema.methods.updateSection = async function (
  sectionId,
  updateData
) {
  const section = this.sections.id(sectionId);
  if (!section) {
    throw new Error("Section not found");
  }

  Object.assign(section, updateData);
  return this.save();
};

/**
 * Remove a section by ID
 */
treatmentPageSchema.methods.removeSection = async function (sectionId) {
  const section = this.sections.id(sectionId);
  if (!section) {
    throw new Error("Section not found");
  }

  section.deleteOne();
  return this.save();
};

/**
 * Reorder sections
 */
treatmentPageSchema.methods.reorderSections = async function (orderedIds) {
  orderedIds.forEach((id, index) => {
    const section = this.sections.id(id);
    if (section) {
      section.order = index;
    }
  });
  return this.save();
};

/**
 * Add FAQ
 */
treatmentPageSchema.methods.addFaq = async function (question, answer) {
  const maxOrder = this.faqs.reduce((max, f) => Math.max(max, f.order || 0), -1);

  this.faqs.push({
    question,
    answer,
    order: maxOrder + 1,
  });

  return this.save();
};

/**
 * Update FAQ
 */
treatmentPageSchema.methods.updateFaq = async function (faqId, updateData) {
  const faq = this.faqs.id(faqId);
  if (!faq) {
    throw new Error("FAQ not found");
  }

  Object.assign(faq, updateData);
  return this.save();
};

/**
 * Remove FAQ
 */
treatmentPageSchema.methods.removeFaq = async function (faqId) {
  const faq = this.faqs.id(faqId);
  if (!faq) {
    throw new Error("FAQ not found");
  }

  faq.deleteOne();
  return this.save();
};

// ============ STATIC METHODS ============

/**
 * Get all published pages (for public listing)
 */
treatmentPageSchema.statics.getPublishedPages = async function () {
  return this.find({ isPublished: true })
    .select("title slug shortDescription hero.image pricing.priceRange")
    .sort({ title: 1 });
};

/**
 * Get page by slug (public)
 */
treatmentPageSchema.statics.getBySlug = async function (slug) {
  return this.findOne({ slug, isPublished: true }).populate(
    "relatedTreatments",
    "title slug shortDescription hero.image"
  );
};

/**
 * Search treatment pages
 */
treatmentPageSchema.statics.search = async function (query) {
  return this.find(
    { $text: { $search: query }, isPublished: true },
    { score: { $meta: "textScore" } }
  )
    .select("title slug shortDescription")
    .sort({ score: { $meta: "textScore" } });
};

// ============ VIRTUALS ============

/**
 * Get section count
 */
treatmentPageSchema.virtual("sectionCount").get(function () {
  return this.sections.filter((s) => s.isVisible).length;
});

/**
 * Get FAQ count
 */
treatmentPageSchema.virtual("faqCount").get(function () {
  return this.faqs.length;
});

// Enable virtuals in JSON
treatmentPageSchema.set("toJSON", { virtuals: true });
treatmentPageSchema.set("toObject", { virtuals: true });

// Create and export the model
const TreatmentPage = mongoose.model("TreatmentPage", treatmentPageSchema);

export default TreatmentPage;
