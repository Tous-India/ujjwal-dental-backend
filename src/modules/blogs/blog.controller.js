import { Readable } from "stream";
import mongoose from "mongoose";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { cloudinary } from "../../config/cloudinary.js";
import Blog from "./blog.model.js";

/**
 * BLOG CONTROLLER
 *
 * Public endpoints serve only published posts; admin endpoints (admin or
 * blog_editor role, gated in blog.routes.js) manage the full CRUD + publish
 * lifecycle.
 */

const WORDS_PER_MINUTE = 200;

/**
 * Compute estimated read time (minutes, rounded up) from HTML content:
 * strip tags, count words, divide by WORDS_PER_MINUTE. Stored on the doc at
 * create/update time rather than recomputed on every public read.
 */
const computeReadTime = (html = "") => {
  const text = String(html || "").replace(/<[^>]*>/g, " ");
  const words = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, Math.ceil(words.length / WORDS_PER_MINUTE));
};

/**
 * Public-read filter: a post is publicly visible when it's actually
 * "published", OR when it's "scheduled" and scheduledPublishAt has already
 * passed. Computed on every read, no cron (Vercel serverless doesn't
 * reliably run scheduled jobs -- same pattern as getStaleTreatments in
 * appointment.controller.js).
 */
const publicVisibilityQuery = () => ({
  $or: [{ status: "published" }, { status: "scheduled", scheduledPublishAt: { $lte: new Date() } }],
});

// ==================== PUBLIC ====================

/**
 * @desc    List published blog posts
 * @route   GET /api/blogs/public
 * @access  Public
 */
export const getPublishedBlogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = publicVisibilityQuery();

  const [rawBlogs, total] = await Promise.all([
    Blog.aggregate([
      { $match: query },
      // Sort by the effective publish date: publishedAt for "published"
      // posts, falling back to scheduledPublishAt for "scheduled" posts
      // that have just crossed their threshold (publishedAt is left null
      // until an explicit publish action).
      { $addFields: { effectivePublishedAt: { $ifNull: ["$publishedAt", "$scheduledPublishAt"] } } },
      { $sort: { effectivePublishedAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]),
    Blog.countDocuments(query),
  ]);

  await Blog.populate(rawBlogs, { path: "author", select: "name" });

  // Display fallback only (not persisted): scheduled posts show their
  // scheduled date as the publish date until an explicit publish stamps
  // publishedAt for real.
  const blogs = rawBlogs.map((b) => ({
    ...b,
    publishedAt: b.publishedAt || b.scheduledPublishAt || null,
  }));

  ApiResponse.success(res, { blogs, total, page: parseInt(page), limit: parseInt(limit) }, "Blogs fetched successfully");
});

/**
 * @desc    Get a published blog post by slug (increments views)
 * @route   GET /api/blogs/public/:slug
 * @access  Public
 */
export const getPublishedBlogBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const blog = await Blog.findOneAndUpdate(
    { slug, ...publicVisibilityQuery() },
    { $inc: { views: 1 } },
    { new: true },
  ).populate("author", "name");

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  const blogObj = blog.toObject();
  if (!blogObj.publishedAt && blogObj.scheduledPublishAt) {
    blogObj.publishedAt = blogObj.scheduledPublishAt;
  }

  ApiResponse.success(res, { blog: blogObj }, "Blog fetched successfully");
});

// ==================== ADMIN ====================

/**
 * @desc    List all blogs regardless of status
 * @route   GET /api/blogs?status=&search=
 * @access  Admin / Blog Editor
 */
export const getAllBlogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search, category } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (status) query.status = status;
  if (category) query.category = category;
  if (search) query.title = { $regex: search, $options: "i" };

  const [blogs, total] = await Promise.all([
    Blog.find(query)
      .populate("author", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Blog.countDocuments(query),
  ]);

  ApiResponse.success(res, { blogs, total, page: parseInt(page), limit: parseInt(limit) }, "Blogs fetched successfully");
});

/**
 * @desc    Get a single blog by ID
 * @route   GET /api/blogs/:id
 * @access  Admin / Blog Editor
 */
export const getBlogById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid blog ID", 400);
  }

  const blog = await Blog.findById(id).populate("author", "name");

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  ApiResponse.success(res, { blog }, "Blog fetched successfully");
});

/**
 * @desc    Create a new blog post
 * @route   POST /api/blogs
 * @access  Admin / Blog Editor
 */
export const createBlog = asyncHandler(async (req, res) => {
  const {
    title,
    slug,
    excerpt,
    content,
    coverImage,
    tags,
    seoTitle,
    seoDescription,
    status,
    category,
    scheduledPublishAt,
  } = req.body;

  if (!title || !content) {
    return ApiResponse.error(res, "Title and content are required", 400);
  }

  const resolvedStatus = ["published", "scheduled"].includes(status) ? status : "draft";

  if (resolvedStatus === "scheduled" && !scheduledPublishAt) {
    return ApiResponse.error(res, "scheduledPublishAt is required when status is scheduled", 400);
  }

  const blog = await Blog.create({
    title,
    slug,
    excerpt,
    content,
    coverImage,
    tags,
    seoTitle,
    seoDescription,
    category,
    status: resolvedStatus,
    scheduledPublishAt: resolvedStatus === "scheduled" ? new Date(scheduledPublishAt) : null,
    publishedAt: resolvedStatus === "published" ? new Date() : null,
    readTimeMinutes: computeReadTime(content),
    author: req.user._id,
  });

  const populatedBlog = await Blog.findById(blog._id).populate("author", "name");

  ApiResponse.created(res, { blog: populatedBlog }, "Blog created successfully");
});

/**
 * @desc    Update a blog post
 * @route   PATCH /api/blogs/:id
 * @access  Admin / Blog Editor
 */
export const updateBlog = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid blog ID", 400);
  }

  const blog = await Blog.findById(id);

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  const allowedFields = [
    "title",
    "slug",
    "excerpt",
    "content",
    "coverImage",
    "tags",
    "seoTitle",
    "seoDescription",
    "status",
    "category",
    "scheduledPublishAt",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      blog[field] = req.body[field];
    }
  });

  if (blog.status === "scheduled" && !blog.scheduledPublishAt) {
    return ApiResponse.error(res, "scheduledPublishAt is required when status is scheduled", 400);
  }

  // Going to any status other than "scheduled" clears a stale scheduled date
  // so a later re-read doesn't misreport it.
  if (blog.status !== "scheduled") {
    blog.scheduledPublishAt = null;
  }

  // Publishing for the first time stamps publishedAt; going back to draft
  // deliberately leaves publishedAt untouched (don't erase publish history).
  if (blog.isModified("status") && blog.status === "published" && !blog.publishedAt) {
    blog.publishedAt = new Date();
  }

  // Recompute the stored read-time estimate whenever content changes.
  if (req.body.content !== undefined) {
    blog.readTimeMinutes = computeReadTime(blog.content);
  }

  await blog.save();

  const updatedBlog = await Blog.findById(id).populate("author", "name");

  ApiResponse.success(res, { blog: updatedBlog }, "Blog updated successfully");
});

/**
 * @desc    Delete a blog post (hard delete)
 * @route   DELETE /api/blogs/:id
 * @access  Admin / Blog Editor
 */
export const deleteBlog = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid blog ID", 400);
  }

  const blog = await Blog.findByIdAndDelete(id);

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  ApiResponse.success(res, null, "Blog deleted successfully");
});

/**
 * @desc    Publish a blog post
 * @route   POST /api/blogs/:id/publish
 * @access  Admin / Blog Editor
 */
export const publishBlog = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid blog ID", 400);
  }

  const blog = await Blog.findById(id);

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  blog.status = "published";
  if (!blog.publishedAt) {
    blog.publishedAt = new Date();
  }

  await blog.save();

  const updatedBlog = await Blog.findById(id).populate("author", "name");

  ApiResponse.success(res, { blog: updatedBlog }, "Blog published successfully");
});

/**
 * @desc    Unpublish a blog post (back to draft)
 * @route   POST /api/blogs/:id/unpublish
 * @access  Admin / Blog Editor
 */
export const unpublishBlog = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid blog ID", 400);
  }

  const blog = await Blog.findById(id);

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  blog.status = "draft";
  await blog.save();

  const updatedBlog = await Blog.findById(id).populate("author", "name");

  ApiResponse.success(res, { blog: updatedBlog }, "Blog unpublished successfully");
});

/**
 * @desc    Blog stats for the admin dashboard widget
 * @route   GET /api/blogs/stats
 * @access  Admin / Blog Editor
 */
export const getBlogStats = asyncHandler(async (req, res) => {
  const [totalBlogs, publishedCount, draftCount, viewsAgg] = await Promise.all([
    Blog.countDocuments({}),
    Blog.countDocuments({ status: "published" }),
    Blog.countDocuments({ status: "draft" }),
    Blog.aggregate([{ $group: { _id: null, totalViews: { $sum: "$views" } } }]),
  ]);

  ApiResponse.success(
    res,
    {
      totalBlogs,
      publishedCount,
      draftCount,
      totalViews: viewsAgg[0]?.totalViews || 0,
    },
    "Blog stats fetched successfully",
  );
});

/**
 * @desc    Upload a blog cover/inline image to Cloudinary
 * @route   POST /api/blogs/upload-image
 * @access  Admin / Blog Editor
 *
 * Note: reuses the shared `upload` multer instance (upload.middleware.js) for
 * multipart parsing and the shared configured `cloudinary` singleton
 * (config/cloudinary.js) for storage — no new multer/Cloudinary instance is
 * created. Streams straight to the "ujjwal-dental/blogs" folder.
 */
export const uploadBlogImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return ApiResponse.error(res, "Image file is required", 400);
  }

  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "ujjwal-dental/blogs",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
      },
      (error, uploadResult) => (error ? reject(error) : resolve(uploadResult)),
    );

    Readable.from(req.file.buffer).pipe(uploadStream);
  });

  ApiResponse.success(
    res,
    { url: result.secure_url, public_id: result.public_id },
    "Image uploaded successfully",
  );
});
