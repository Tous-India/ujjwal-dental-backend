import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Upload from "./upload.model.js";
import { deleteFromCloudinary } from "../../middlewares/upload.middleware.js";
import { cloudinary } from "../../config/cloudinary.js";
import {
  CLOUDINARY_UPLOAD_FOLDER,
  SIGNATURE_TTL_SECONDS,
} from "../../utils/cloudinaryDirect.js";

/**
 * @desc    Mint a short-lived signature for a DIRECT browser->Cloudinary upload
 * @route   POST /api/uploads/signature
 * @access  Authenticated staff/admin
 *
 * Large files (phone camera photos are routinely 3-12MB) cannot be streamed
 * through this API at all: Vercel caps serverless request bodies at ~4.5MB as
 * a platform limit. The browser therefore uploads straight to Cloudinary with
 * the signature returned here and only posts back the resulting URL.
 * See src/utils/cloudinaryDirect.js for the full rationale.
 *
 * `folder` is fixed server-side and included in the signed payload, so a
 * caller cannot redirect uploads elsewhere in the account. This is a SIGNED
 * upload -- no unsigned preset is ever exposed.
 */
export const getUploadSignature = asyncHandler(async (req, res) => {
  const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
    return ApiResponse.error(res, "File uploads are not configured on the server", 500);
  }

  const timestamp = Math.round(Date.now() / 1000);

  // Only these params are signed, so these are the only ones Cloudinary will
  // honour -- the client must send back exactly the same folder/timestamp.
  const signature = cloudinary.utils.api_sign_request(
    { folder: CLOUDINARY_UPLOAD_FOLDER, timestamp },
    CLOUDINARY_API_SECRET
  );

  ApiResponse.success(
    res,
    {
      signature,
      timestamp,
      folder: CLOUDINARY_UPLOAD_FOLDER,
      apiKey: CLOUDINARY_API_KEY,
      cloudName: CLOUDINARY_CLOUD_NAME,
      expiresIn: SIGNATURE_TTL_SECONDS,
    },
    "Upload signature generated"
  );
});

/**
 * UPLOAD CONTROLLER
 *
 * Handles file upload operations with Cloudinary storage.
 *
 * ═══════════════════════════════════════════════════════════════
 * HOW TO USE THIS MODULE - COMPLETE GUIDE
 * ═══════════════════════════════════════════════════════════════
 *
 * STEP 1: Import the middleware and use in your route
 * ---------------------------------------------------
 * import { uploadSingle } from '../../middlewares/upload.middleware.js';
 *
 * // In your routes file:
 * router.post('/upload', uploadSingle('file'), uploadController.uploadFile);
 *
 *
 * STEP 2: Send file from Postman/Frontend
 * ---------------------------------------
 * - Method: POST
 * - URL: http://localhost:5000/api/uploads
 * - Body: form-data
 *   - Key: "file" (type: File)
 *   - Key: "category" (type: Text) - optional
 *   - Key: "title" (type: Text) - optional
 *
 *
 * STEP 3: Access uploaded file data
 * ---------------------------------
 * After upload, the middleware attaches file data to req.uploadedFile:
 *
 * req.uploadedFile = {
 *   url: 'https://res.cloudinary.com/xxx/image/upload/v123/ujjwal-dental/abc.pdf',
 *   publicId: 'ujjwal-dental/abc123',
 *   fileName: 'report.pdf',
 *   fileSize: 1024000,
 *   fileType: 'application/pdf',
 *   thumbnailUrl: 'https://res.cloudinary.com/xxx/image/upload/c_thumb,w_200/abc.pdf',
 *   format: 'pdf',
 *   width: null,
 *   height: null
 * }
 *
 *
 * STEP 4: Use in other modules (e.g., Patient Reports)
 * ----------------------------------------------------
 * // In patient.controller.js or report.controller.js:
 *
 * import { uploadSingle } from '../../middlewares/upload.middleware.js';
 * import Upload from '../uploads/upload.model.js';
 *
 * export const uploadPatientReport = asyncHandler(async (req, res) => {
 *   const { patientId } = req.params;
 *
 *   // File is already uploaded to Cloudinary by middleware
 *   if (!req.uploadedFile) {
 *     return ApiResponse.error(res, 'Please upload a file', 400);
 *   }
 *
 *   // Save to database with patient reference
 *   const upload = await Upload.create({
 *     ...req.uploadedFile,
 *     category: 'report',
 *     title: req.body.title || 'Patient Report',
 *     uploadedBy: req.user._id,
 *     relatedTo: {
 *       model: 'Patient',
 *       document: patientId
 *     }
 *   });
 *
 *   ApiResponse.created(res, { upload }, 'Report uploaded successfully');
 * });
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * API ENDPOINTS
 * ═══════════════════════════════════════════════════════════════
 *
 * POST   /api/uploads              - Upload a file
 * GET    /api/uploads              - List all uploads
 * GET    /api/uploads/:id          - Get single upload
 * DELETE /api/uploads/:id          - Delete upload
 * GET    /api/uploads/stats        - Get storage statistics
 * GET    /api/uploads/category/:category - Get uploads by category
 *
 */

// ═══════════════════════════════════════════════════════════════
// UPLOAD FILE
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Upload a file to Cloudinary and save metadata to database
 * @route   POST /api/uploads
 * @access  Private
 *
 * @example
 * // Postman Request:
 * // POST http://localhost:5000/api/uploads
 * // Headers: Authorization: Bearer <token>
 * // Body (form-data):
 * //   - file: [Select PDF/Image file]
 * //   - category: "document"
 * //   - title: "My Document"
 * //   - description: "Optional description"
 * //   - tags: "important,2024"
 *
 * // Response:
 * {
 *   "success": true,
 *   "message": "File uploaded successfully",
 *   "data": {
 *     "upload": {
 *       "_id": "507f1f77bcf86cd799439011",
 *       "url": "https://res.cloudinary.com/xxx/file.pdf",
 *       "publicId": "ujjwal-dental/abc123",
 *       "fileName": "report.pdf",
 *       "fileType": "application/pdf",
 *       "fileSize": 1024000,
 *       "fileSizeFormatted": "1.00 MB",
 *       "category": "document",
 *       "title": "My Document"
 *     }
 *   }
 * }
 */
export const uploadFile = asyncHandler(async (req, res) => {
  // Check if file was uploaded
  if (!req.uploadedFile) {
    return ApiResponse.error(res, "Please upload a file", 400);
  }

  // Extract optional metadata from request body
  const { category, title, description, tags, relatedModel, relatedId } = req.body;

  // Prepare upload data
  const uploadData = {
    // Cloudinary data (from middleware)
    url: req.uploadedFile.url,
    publicId: req.uploadedFile.publicId,
    thumbnailUrl: req.uploadedFile.thumbnailUrl,
    fileName: req.uploadedFile.fileName,
    fileType: req.uploadedFile.fileType,
    fileSize: req.uploadedFile.fileSize,
    format: req.uploadedFile.format,
    width: req.uploadedFile.width,
    height: req.uploadedFile.height,

    // Optional metadata
    category: category || "document",
    title: title || req.uploadedFile.fileName,
    description: description,
    tags: tags ? tags.split(",").map((tag) => tag.trim()) : [],

    // Who uploaded
    uploadedBy: req.user?._id,

    // Related document (optional)
    relatedTo: relatedModel
      ? {
          model: relatedModel,
          document: relatedId,
        }
      : undefined,
  };

  // Save to database
  const upload = await Upload.create(uploadData);

  ApiResponse.created(res, { upload }, "File uploaded successfully");
});

// ═══════════════════════════════════════════════════════════════
// GET ALL UPLOADS
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Get all uploads with pagination and filters
 * @route   GET /api/uploads
 * @access  Private
 *
 * @example
 * // GET http://localhost:5000/api/uploads?page=1&limit=10&category=document
 */
export const getAllUploads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, category, search } = req.query;

  // Build query
  const query = { isActive: true };

  if (category) {
    query.category = category;
  }

  if (search) {
    query.$or = [
      { fileName: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
      { tags: { $in: [new RegExp(search, "i")] } },
    ];
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get uploads
  const uploads = await Upload.find(query)
    .populate("uploadedBy", "name email")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  // Total count
  const total = await Upload.countDocuments(query);

  ApiResponse.paginated(res, uploads, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

// ═══════════════════════════════════════════════════════════════
// GET SINGLE UPLOAD
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Get single upload by ID
 * @route   GET /api/uploads/:id
 * @access  Private
 */
export const getUploadById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const upload = await Upload.findById(id).populate("uploadedBy", "name email");

  if (!upload) {
    return ApiResponse.error(res, "Upload not found", 404);
  }

  ApiResponse.success(res, { upload }, "Upload fetched successfully");
});

// ═══════════════════════════════════════════════════════════════
// DELETE UPLOAD
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Delete upload (removes from Cloudinary and database)
 * @route   DELETE /api/uploads/:id
 * @access  Private
 *
 * @example
 * // DELETE http://localhost:5000/api/uploads/507f1f77bcf86cd799439011
 */
export const deleteUpload = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const upload = await Upload.findById(id);

  if (!upload) {
    return ApiResponse.error(res, "Upload not found", 404);
  }

  // Delete from Cloudinary
  try {
    await deleteFromCloudinary(upload.publicId);
  } catch (error) {
    console.error("Failed to delete from Cloudinary:", error);
    // Continue with database deletion even if Cloudinary fails
  }

  // Delete from database (or soft delete)
  await Upload.findByIdAndDelete(id);

  ApiResponse.success(res, null, "Upload deleted successfully");
});

// ═══════════════════════════════════════════════════════════════
// GET UPLOADS BY CATEGORY
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Get uploads by category
 * @route   GET /api/uploads/category/:category
 * @access  Private
 *
 * @example
 * // GET http://localhost:5000/api/uploads/category/report
 * // GET http://localhost:5000/api/uploads/category/xray
 */
export const getUploadsByCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;

  const uploads = await Upload.findByCategory(category);

  ApiResponse.success(res, { uploads, count: uploads.length }, `${category} files fetched`);
});

// ═══════════════════════════════════════════════════════════════
// GET STORAGE STATS
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Get storage statistics
 * @route   GET /api/uploads/stats
 * @access  Private
 *
 * @example
 * // Response:
 * {
 *   "byCategory": [
 *     { "_id": "document", "count": 10, "totalSize": 5242880 },
 *     { "_id": "image", "count": 25, "totalSize": 10485760 }
 *   ],
 *   "total": { "totalCount": 35, "totalSize": 15728640 }
 * }
 */
export const getStorageStats = asyncHandler(async (req, res) => {
  const stats = await Upload.getStorageStats();

  // Format sizes for readability
  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  };

  const formattedStats = {
    byCategory: stats.byCategory.map((cat) => ({
      ...cat,
      totalSizeFormatted: formatSize(cat.totalSize),
    })),
    total: {
      ...stats.total,
      totalSizeFormatted: formatSize(stats.total.totalSize || 0),
    },
  };

  ApiResponse.success(res, { stats: formattedStats }, "Storage stats fetched");
});

// ═══════════════════════════════════════════════════════════════
// UPDATE UPLOAD METADATA
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Update upload metadata (title, description, tags, category)
 * @route   PATCH /api/uploads/:id
 * @access  Private
 */
export const updateUpload = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description, tags, category } = req.body;

  const upload = await Upload.findById(id);

  if (!upload) {
    return ApiResponse.error(res, "Upload not found", 404);
  }

  // Update fields
  if (title) upload.title = title;
  if (description !== undefined) upload.description = description;
  if (category) upload.category = category;
  if (tags) upload.tags = tags.split(",").map((tag) => tag.trim());

  await upload.save();

  ApiResponse.success(res, { upload }, "Upload updated successfully");
});
