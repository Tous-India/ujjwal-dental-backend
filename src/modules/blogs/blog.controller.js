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

// ==================== PUBLIC ====================

/**
 * @desc    List published blog posts
 * @route   GET /api/blogs/public
 * @access  Public
 */
export const getPublishedBlogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { status: "published" };

  const [blogs, total] = await Promise.all([
    Blog.find(query)
      .populate("author", "name")
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Blog.countDocuments(query),
  ]);

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
    { slug, status: "published" },
    { $inc: { views: 1 } },
    { new: true },
  ).populate("author", "name");

  if (!blog) {
    return ApiResponse.error(res, "Blog not found", 404);
  }

  ApiResponse.success(res, { blog }, "Blog fetched successfully");
});

// ==================== ADMIN ====================

/**
 * @desc    List all blogs regardless of status
 * @route   GET /api/blogs?status=&search=
 * @access  Admin / Blog Editor
 */
export const getAllBlogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (status) query.status = status;
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
  const { title, slug, excerpt, content, coverImage, tags, seoTitle, seoDescription, status } = req.body;

  if (!title || !content) {
    return ApiResponse.error(res, "Title and content are required", 400);
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
    status: status === "published" ? "published" : "draft",
    publishedAt: status === "published" ? new Date() : null,
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
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      blog[field] = req.body[field];
    }
  });

  // Publishing for the first time stamps publishedAt; going back to draft
  // deliberately leaves publishedAt untouched (don't erase publish history).
  if (blog.isModified("status") && blog.status === "published" && !blog.publishedAt) {
    blog.publishedAt = new Date();
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
