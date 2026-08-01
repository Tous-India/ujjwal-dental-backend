import mongoose from "mongoose";

/**
 * BLOG MODEL
 *
 * Blog posts authored by admin/blog_editor users. Rich HTML content comes
 * from the Tiptap editor on the admin side; publicly readable only when
 * status is "published".
 */

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    excerpt: { type: String, maxlength: 1000, default: "" },
    content: { type: String, required: true }, // Rich HTML from Tiptap editor
    coverImage: { type: String, default: null }, // Cloudinary URL
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["draft", "published", "scheduled"], default: "draft" },
    // Only meaningful when status === "scheduled". Public-read endpoints treat
    // a "scheduled" post as effectively published once this instant has
    // passed -- computed on every read, no cron (Vercel serverless doesn't
    // reliably run scheduled jobs; see getStaleTreatments in
    // appointment.controller.js for the same established pattern).
    scheduledPublishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    views: { type: Number, default: 0 },
    tags: [{ type: String, trim: true, lowercase: true }],
    seoTitle: { type: String, maxlength: 70, default: "" },
    seoDescription: { type: String, maxlength: 170, default: "" },
    category: {
      type: String,
      enum: ["Oral Hygiene", "Treatments", "Patient Stories", "General"],
      default: "General",
    },
    // Auto-computed server-side from `content` at create/update time (see
    // computeReadTime in blog.controller.js) -- stored rather than
    // recalculated on every public read.
    readTimeMinutes: { type: Number, default: 1 },
  },
  { timestamps: true },
);

/**
 * Auto-generate slug from title on save (if slug not manually set), and
 * ensure uniqueness by appending -2, -3, etc. if the base slug collides with
 * an existing post.
 */
blogSchema.pre("validate", async function () {
  if (!this.slug && this.title) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 100);
  }

  if (this.slug && (this.isNew || this.isModified("slug"))) {
    const baseSlug = this.slug;
    let candidate = baseSlug;
    let counter = 2;

    while (
      await mongoose.models.Blog.findOne({
        slug: candidate,
        _id: { $ne: this._id },
      })
    ) {
      candidate = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = candidate;
  }
});

// Index for public listing queries
blogSchema.index({ status: 1, publishedAt: -1 });
blogSchema.index({ status: 1, scheduledPublishAt: -1 });
blogSchema.index({ slug: 1 });
blogSchema.index({ tags: 1 });
blogSchema.index({ category: 1 });

export default mongoose.model("Blog", blogSchema);
