import { Router } from "express";
import * as blogController from "./blog.controller.js";
import { authProtect, restrictTo } from "../../middlewares/auth.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

/**
 * BLOG ROUTES
 * Base path: /api/blogs
 */

// ==================== PUBLIC ====================

router.get("/public", blogController.getPublishedBlogs);
router.get("/public/:slug", blogController.getPublishedBlogBySlug);

// ==================== ADMIN (admin + blog_editor) ====================

router.use(authProtect);
router.use(restrictTo("admin", "blog_editor"));

router.get("/stats", blogController.getBlogStats);
router.get("/", blogController.getAllBlogs);
router.get("/:id", blogController.getBlogById);
router.post("/", blogController.createBlog);
router.patch("/:id", blogController.updateBlog);
router.delete("/:id", blogController.deleteBlog);
router.post("/:id/publish", blogController.publishBlog);
router.post("/:id/unpublish", blogController.unpublishBlog);
router.post("/upload-image", upload.single("image"), blogController.uploadBlogImage);

export default router;
