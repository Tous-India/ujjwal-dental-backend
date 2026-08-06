import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as uploadController from "./upload.controller.js";
import { uploadSingle } from "../../middlewares/upload.middleware.js";
import authProtect from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * UPLOAD ROUTES
 * Base path: /api/uploads
 *
 * ═══════════════════════════════════════════════════════════════
 * POSTMAN TESTING GUIDE
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. UPLOAD A FILE
 * ----------------
 * Method: POST
 * URL: http://localhost:5000/api/uploads
 * Headers:
 *   - Authorization: Bearer <your_token>
 * Body (form-data):
 *   - file: [Select your PDF/Image] (required)
 *   - category: "document" (optional) - Options: document, image, report, prescription, xray, other
 *   - title: "My Report" (optional)
 *   - description: "Description here" (optional)
 *   - tags: "tag1,tag2,tag3" (optional, comma-separated)
 *   - relatedModel: "Patient" (optional) - Options: Patient, Appointment, Treatment, Invoice
 *   - relatedId: "patient_id_here" (optional)
 *
 *
 * 2. GET ALL UPLOADS
 * ------------------
 * Method: GET
 * URL: http://localhost:5000/api/uploads
 * URL with filters: http://localhost:5000/api/uploads?page=1&limit=10&category=document&search=report
 * Headers:
 *   - Authorization: Bearer <your_token>
 *
 *
 * 3. GET SINGLE UPLOAD
 * --------------------
 * Method: GET
 * URL: http://localhost:5000/api/uploads/:id
 * Headers:
 *   - Authorization: Bearer <your_token>
 *
 *
 * 4. UPDATE UPLOAD
 * ----------------
 * Method: PATCH
 * URL: http://localhost:5000/api/uploads/:id
 * Headers:
 *   - Authorization: Bearer <your_token>
 *   - Content-Type: application/json
 * Body (JSON):
 * {
 *   "title": "Updated Title",
 *   "description": "Updated description",
 *   "category": "report",
 *   "tags": "new,tags,here"
 * }
 *
 *
 * 5. DELETE UPLOAD
 * ----------------
 * Method: DELETE
 * URL: http://localhost:5000/api/uploads/:id
 * Headers:
 *   - Authorization: Bearer <your_token>
 *
 *
 * 6. GET UPLOADS BY CATEGORY
 * --------------------------
 * Method: GET
 * URL: http://localhost:5000/api/uploads/category/document
 * URL: http://localhost:5000/api/uploads/category/report
 * URL: http://localhost:5000/api/uploads/category/xray
 * Headers:
 *   - Authorization: Bearer <your_token>
 *
 *
 * 7. GET STORAGE STATS
 * --------------------
 * Method: GET
 * URL: http://localhost:5000/api/uploads/stats
 * Headers:
 *   - Authorization: Bearer <your_token>
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * RESPONSE EXAMPLES
 * ═══════════════════════════════════════════════════════════════
 *
 * Upload Success Response:
 * {
 *   "success": true,
 *   "message": "File uploaded successfully",
 *   "data": {
 *     "upload": {
 *       "_id": "507f1f77bcf86cd799439011",
 *       "url": "https://res.cloudinary.com/demo/raw/upload/v1234/ujjwal-dental/sample.pdf",
 *       "publicId": "ujjwal-dental/sample_abc123",
 *       "fileName": "sample.pdf",
 *       "fileType": "application/pdf",
 *       "fileSize": 1048576,
 *       "fileSizeFormatted": "1.00 MB",
 *       "category": "document",
 *       "title": "My Report",
 *       "isImage": false,
 *       "isPdf": true,
 *       "createdAt": "2024-01-20T10:30:00.000Z"
 *     }
 *   }
 * }
 *
 * ═══════════════════════════════════════════════════════════════
 */

// All routes require authentication
router.use(authProtect);

// ========== SPECIAL ROUTES (must be before /:id) ==========

// Mint a short-lived signature so the BROWSER can upload straight to
// Cloudinary, bypassing Vercel's ~4.5MB serverless request body limit
// (which silently killed every phone-camera photo).
router.post("/signature", uploadController.getUploadSignature);

// Get storage statistics
router.get("/stats", uploadController.getStorageStats);

// Get uploads by category
router.get("/category/:category", uploadController.getUploadsByCategory);

// ========== CRUD ROUTES ==========

// List all uploads (with pagination and filters)
router.get("/", uploadController.getAllUploads);

// Upload a new file
// Uses uploadSingle middleware to handle file upload to Cloudinary
router.post("/", checkPermission("reports", "create"), uploadSingle("file"), uploadController.uploadFile);

// Get single upload by ID
router.get("/:id", uploadController.getUploadById);

// Update upload metadata
router.patch("/:id", checkPermission("reports", "edit"), uploadController.updateUpload);

// Delete upload (removes from Cloudinary and database)
router.delete("/:id", checkPermission("reports", "delete"), uploadController.deleteUpload);

export default router;
