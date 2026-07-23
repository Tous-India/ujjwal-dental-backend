import { Router } from "express";
import * as blogController from "./blog.controller.js";
import { authProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

/**
 * BLOG ROUTES
 * Base path: /api/blogs
 */

// ==================== PUBLIC ====================

router.get("/public", blogController.getPublishedBlogs);
router.get("/public/:slug", blogController.getPublishedBlogBySlug);

// ==================== ADMIN (per-action, not a single blanket gate) ====================
// Previously one router.use(restrictTo("admin","blog_editor","clinic_manager"))
// gated every route below identically. Migrated to per-action checkPermission
// -- behavior is unchanged for admin/blog_editor/clinic_manager (all three
// have identical all-true "blogs" permissions), but this is now expressed
// per action rather than as a single undifferentiated block.

router.use(authProtect);

router.get("/stats", checkPermission("blogs", "view"), blogController.getBlogStats);
router.get("/", checkPermission("blogs", "view"), blogController.getAllBlogs);
router.get("/:id", checkPermission("blogs", "view"), blogController.getBlogById);
router.post("/", checkPermission("blogs", "create"), blogController.createBlog);
router.patch("/:id", checkPermission("blogs", "edit"), blogController.updateBlog);
router.delete("/:id", checkPermission("blogs", "delete"), blogController.deleteBlog);
router.post("/:id/publish", checkPermission("blogs", "edit"), blogController.publishBlog);
router.post("/:id/unpublish", checkPermission("blogs", "edit"), blogController.unpublishBlog);
router.post("/upload-image", checkPermission("blogs", "edit"), upload.single("image"), blogController.uploadBlogImage);

export default router;
