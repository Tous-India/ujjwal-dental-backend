// import multer from "multer";
// import { v2 as cloudinary } from "cloudinary";
// import { Readable } from "stream";

// /**
//  * UPLOAD MIDDLEWARE
//  *
//  * Handles file uploads using Multer and Cloudinary
//  *
//  * Usage:
//  * - router.post('/reports', uploadSingle('file'), reportController.uploadReport)
//  * - After this middleware, req.uploadedFile contains Cloudinary upload result
//  */

// // Configure multer to store files in memory
// const storage = multer.memoryStorage();

// // File filter - allowed file types
// const fileFilter = (req, file, cb) => {
//   // Allowed MIME types
//   const allowedTypes = [
//     "image/jpeg",
//     "image/png",
//     "image/gif",
//     "image/webp",
//     "application/pdf",
//     "application/msword",
//     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//   ];

//   if (allowedTypes.includes(file.mimetype)) {
//     cb(null, true);
//   } else {
//     cb(new Error("Invalid file type. Only images, PDFs and Word documents are allowed."), false);
//   }
// };

// // Configure multer
// const upload = multer({
//   storage,
//   fileFilter,
//   limits: {
//     fileSize: 10 * 1024 * 1024, // 10MB max file size
//   },
// });

// /**
//  * Upload single file to Cloudinary
//  * @param {string} fieldName - Form field name for the file
//  * @returns {Function} Express middleware
//  */
// export const uploadSingle = (fieldName = "file") => {
//   const multerMiddleware = upload.single(fieldName);

//   return async (req, res, next) => {
//     console.log("[UPLOAD] Starting upload middleware...");

//     // Wrap multer in a promise
//     try {
//       await new Promise((resolve, reject) => {
//         multerMiddleware(req, res, (err) => {
//           if (err) {
//             console.log("[UPLOAD] Multer error:", err.message);
//             reject(err);
//           } else {
//             console.log("[UPLOAD] Multer completed, file:", req.file ? req.file.originalname : "none");
//             resolve();
//           }
//         });
//       });
//     } catch (err) {
//       if (err instanceof multer.MulterError) {
//         if (err.code === "LIMIT_FILE_SIZE") {
//           return res.status(400).json({
//             success: false,
//             message: "File too large. Maximum size is 10MB.",
//           });
//         }
//         return res.status(400).json({
//           success: false,
//           message: `Upload error: ${err.message}`,
//         });
//       }
//       return res.status(400).json({
//         success: false,
//         message: err.message,
//       });
//     }

//     // If no file was uploaded, continue without uploading to Cloudinary
//     if (!req.file) {
//       console.log("[UPLOAD] No file, calling next()");
//       return next();
//     }

//     // Upload to Cloudinary
//     try {
//       console.log("[UPLOAD] Uploading to Cloudinary...");
//       const result = await uploadToCloudinary(req.file);
//       console.log("[UPLOAD] Cloudinary upload success:", result.secure_url);

//       // Attach result to request
//       req.uploadedFile = {
//         url: result.secure_url,
//         publicId: result.public_id,
//         fileName: req.file.originalname,
//         fileSize: req.file.size,
//         fileType: req.file.mimetype,
//         thumbnailUrl: result.thumbnail_url,
//         format: result.format,
//         width: result.width,
//         height: result.height,
//       };

//       console.log("[UPLOAD] Calling next()...");
//       return next();
//     } catch (uploadError) {
//       console.error("[UPLOAD] Cloudinary upload error:", uploadError);
//       return res.status(500).json({
//         success: false,
//         message: "Failed to upload file to cloud storage.",
//       });
//     }
//   };
// };

// /**
//  * Upload multiple files to Cloudinary
//  * @param {string} fieldName - Form field name for the files
//  * @param {number} maxCount - Maximum number of files
//  * @returns {Function} Express middleware
//  */
// export const uploadMultiple = (fieldName = "files", maxCount = 5) => {
//   const multerMiddleware = upload.array(fieldName, maxCount);

//   return async (req, res, next) => {
//     // Wrap multer in a promise
//     try {
//       await new Promise((resolve, reject) => {
//         multerMiddleware(req, res, (err) => {
//           if (err) {
//             reject(err);
//           } else {
//             resolve();
//           }
//         });
//       });
//     } catch (err) {
//       if (err instanceof multer.MulterError) {
//         if (err.code === "LIMIT_FILE_SIZE") {
//           return res.status(400).json({
//             success: false,
//             message: "File too large. Maximum size is 10MB per file.",
//           });
//         }
//         if (err.code === "LIMIT_UNEXPECTED_FILE") {
//           return res.status(400).json({
//             success: false,
//             message: `Too many files. Maximum ${maxCount} files allowed.`,
//           });
//         }
//         return res.status(400).json({
//           success: false,
//           message: `Upload error: ${err.message}`,
//         });
//       }
//       return res.status(400).json({
//         success: false,
//         message: err.message,
//       });
//     }

//     // If no files were uploaded, continue
//     if (!req.files || req.files.length === 0) {
//       return next();
//     }

//     // Upload to Cloudinary
//     try {
//       const uploadPromises = req.files.map((file) => uploadToCloudinary(file));
//       const results = await Promise.all(uploadPromises);

//       // Attach results to request
//       req.uploadedFiles = results.map((result, index) => ({
//         url: result.secure_url,
//         publicId: result.public_id,
//         fileName: req.files[index].originalname,
//         fileSize: req.files[index].size,
//         fileType: req.files[index].mimetype,
//         thumbnailUrl: result.thumbnail_url,
//         format: result.format,
//       }));

//       return next();
//     } catch (uploadError) {
//       console.error("Cloudinary upload error:", uploadError);
//       return res.status(500).json({
//         success: false,
//         message: "Failed to upload files to cloud storage.",
//       });
//     }
//   };
// };

// /**
//  * Upload buffer to Cloudinary
//  * @param {Object} file - Multer file object
//  * @returns {Promise} Cloudinary upload result
//  */
// const uploadToCloudinary = (file) => {
//   return new Promise((resolve, reject) => {
//     // Create upload stream
//     const uploadStream = cloudinary.uploader.upload_stream(
//       {
//         folder: "ujjwal-dental", // Cloudinary folder
//         resource_type: "auto", // Auto-detect file type
//         use_filename: true,
//         unique_filename: true,
//         // Generate thumbnail for images and first page of PDFs
//         transformation: [
//           {
//             width: 200,
//             height: 200,
//             crop: "thumb",
//             gravity: "center",
//           },
//         ],
//       },
//       (error, result) => {
//         if (error) {
//           reject(error);
//         } else {
//           resolve(result);
//         }
//       }
//     );

//     // Pipe the buffer to the upload stream
//     const readableStream = Readable.from(file.buffer);
//     readableStream.pipe(uploadStream);
//   });
// };

// /**
//  * Delete file from Cloudinary
//  * @param {string} publicId - Cloudinary public ID
//  * @returns {Promise} Deletion result
//  */
// export const deleteFromCloudinary = async (publicId) => {
//   try {
//     const result = await cloudinary.uploader.destroy(publicId);
//     return result;
//   } catch (error) {
//     console.error("Cloudinary delete error:", error);
//     throw error;
//   }
// };

// /**
//  * Get signed URL for private files
//  * @param {string} publicId - Cloudinary public ID
//  * @param {number} expiresIn - Expiry time in seconds (default: 1 hour)
//  * @returns {string} Signed URL
//  */
// export const getSignedUrl = (publicId, expiresIn = 3600) => {
//   return cloudinary.url(publicId, {
//     sign_url: true,
//     type: "authenticated",
//     expires_at: Math.floor(Date.now() / 1000) + expiresIn,
//   });
// };
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import path from "path";

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    // iPhones default to HEIC/HEIF -- without these, every photo straight off
    // an iPhone is rejected as an "invalid file type". Cloudinary transcodes
    // both on ingest, so downstream delivery/thumbnails are unaffected.
    "image/heic",
    "image/heif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  allowedTypes.includes(file.mimetype)
    ? cb(null, true)
    : cb(
        new Error(
          "Invalid file type. Only images, PDFs and Word documents are allowed.",
        ),
        false,
      );
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * 1. Upload Single File (Keep your original structure)
 */
// export const uploadSingle = (fieldName = "file") => {
//   const multerMiddleware = upload.single(fieldName);

//   return async (req, res, next) => {
//     try {
//       await new Promise((resolve, reject) => {
//         multerMiddleware(req, res, (err) => (err ? reject(err) : resolve()));
//       });

//       if (!req.file) return next();

//       const result = await uploadToCloudinary(req.file);

//       // Determine if it's an image or PDF for the download link
//       const isImageOrPdf = result.resource_type === "image";

//       req.uploadedFile = {
//         url: result.secure_url,
//         // The correction: Only use 'attachment' flag for images/PDFs.
//         // Raw files (Word docs) download automatically from the secure_url.
//         downloadUrl: isImageOrPdf
//           ? cloudinary.url(result.public_id, {
//               flags: "attachment",
//               resource_type: "image",
//             })
//           : result.secure_url,
//         publicId: result.public_id,
//         fileName: req.file.originalname,
//         fileSize: req.file.size,
//         fileType: req.file.mimetype,
//         thumbnailUrl: isImageOrPdf
//           ? cloudinary.url(result.public_id, {
//               width: 200,
//               height: 200,
//               crop: "thumb",
//             })
//           : null,
//       };

//       next();
//     } catch (error) {
//       return res.status(400).json({ success: false, message: error.message });
//     }
//   };
// };

/**
 * 2. Upload Multiple Files
 */
export const uploadMultiple = (fieldName = "files", maxCount = 5) => {
  const multerMiddleware = upload.array(fieldName, maxCount);

  return async (req, res, next) => {
    try {
      await new Promise((resolve, reject) => {
        multerMiddleware(req, res, (err) => (err ? reject(err) : resolve()));
      });

      if (!req.files || req.files.length === 0) return next();

      const uploadPromises = req.files.map((file) => uploadToCloudinary(file));
      const results = await Promise.all(uploadPromises);

      req.uploadedFiles = results.map((result, index) => {
        const isImageOrPdf = result.resource_type === "image";
        return {
          url: result.secure_url,
          downloadUrl: isImageOrPdf
            ? cloudinary.url(result.public_id, {
                flags: "attachment",
                resource_type: "image",
              })
            : result.secure_url,
          publicId: result.public_id,
          fileName: req.files[index].originalname,
          fileSize: req.files[index].size,
          fileType: req.files[index].mimetype,
        };
      });

      next();
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  };
};

/**
 * The logic that aligns with Cloudinary's strict requirements:
 * 1. Upload PDFs as 'image' (not 'raw') to enable thumbnails and flags.
 * 2. Upload Docs/Misc as 'raw'.
 */
const uploadToCloudinary = (file) => {
  return new Promise((resolve, reject) => {
    const isImage = file.mimetype.startsWith("image/");
    const isPdf = file.mimetype === "application/pdf";

    const options = {
      folder: "ujjwal-dental",
      // CRITICAL: PDFs must be 'image' to use fl_attachment or see thumbnails
      resource_type: isImage || isPdf ? "image" : "raw",
      use_filename: true,
      unique_filename: true,
    };

    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );

    Readable.from(file.buffer).pipe(uploadStream);
  });
};

export const uploadSingle = (fieldName = "file") => {
  const multerMiddleware = upload.single(fieldName);

  return async (req, res, next) => {
    try {
      await new Promise((resolve, reject) => {
        multerMiddleware(req, res, (err) => (err ? reject(err) : resolve()));
      });

      if (!req.file) return next();
      const result = await uploadToCloudinary(req.file);

      // We only apply the attachment flag if Cloudinary indexed it as an image/pdf
      let downloadUrl = result.secure_url;
      if (result.resource_type === "image") {
        downloadUrl = cloudinary.url(result.public_id, {
          flags: "attachment",
          resource_type: "image",
          // Force the extension to be correct in the link
          fetch_format: result.format === "pdf" ? "pdf" : result.format,
        });
      }

      req.uploadedFile = {
        url: result.secure_url,
        downloadUrl: downloadUrl,
        publicId: result.public_id,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        // Now this will actually show a preview because it's in the 'image' bucket
        thumbnailUrl:
          result.resource_type === "image"
            ? cloudinary.url(result.public_id, {
                width: 200,
                height: 200,
                crop: "thumb",
              })
            : null,
      };

      next();
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  };
};

/**
 * 4. Delete Utility
 */
export const deleteFromCloudinary = async (
  publicId,
  resourceType = "image",
) => {
  if (!publicId) return;
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

/**
 * 5. Signed URL (Simple correction)
 */
export const getSignedUrl = (publicId, isRaw = false) => {
  return cloudinary.url(publicId, {
    sign_url: true,
    resource_type: isRaw ? "raw" : "image",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
};

export default upload;
