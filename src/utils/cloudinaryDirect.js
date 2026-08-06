/**
 * Direct browser-to-Cloudinary upload support.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API runs as a Vercel serverless function (vercel.json routes everything
 * to api/index.js via @vercel/node). Vercel enforces a HARD ~4.5MB request
 * body limit on serverless functions -- a platform limit that cannot be raised
 * from application code, no matter what multer's own `limits.fileSize` says.
 *
 * Report uploads used to stream the file THROUGH this API (multer
 * memoryStorage -> cloudinary.upload_stream), so every byte of the photo
 * counted against that 4.5MB ceiling. Phone camera photos are typically
 * 3-12MB, so they were rejected by the platform before the function even ran,
 * while sub-2MB desktop files sailed through -- exactly the reported
 * "mobile always fails, desktop always works" split. Because the endpoint
 * accepts up to 10 files in ONE request, the limit is also CUMULATIVE: a few
 * mid-size desktop files together could blow it too.
 *
 * The fix: the browser uploads the file DIRECTLY to Cloudinary using a
 * short-lived signature minted here, then sends back only the resulting
 * URL/publicId (a few hundred bytes) to be saved on the Report. Nothing large
 * ever transits the serverless function, so the 4.5MB ceiling stops applying.
 *
 * SECURITY
 * --------
 * Uploads are SIGNED, never unsigned -- an unsigned preset would let anyone on
 * the internet write into the account. The signature:
 *   - requires an authenticated session to obtain (route is behind authProtect),
 *   - pins `folder` server-side so a caller cannot write outside it,
 *   - is short-lived (Cloudinary rejects a stale `timestamp`; we additionally
 *     advertise SIGNATURE_TTL_SECONDS so the client refreshes rather than
 *     reusing one indefinitely).
 *
 * Because the client now reports its own file metadata, that metadata is NOT
 * trusted: assertValidDirectUploadFiles() re-validates that every URL really
 * points at OUR Cloudinary cloud and OUR folder, so a caller cannot persist an
 * arbitrary third-party URL onto a patient's medical record.
 */

/** The single Cloudinary folder every upload is pinned to. */
export const CLOUDINARY_UPLOAD_FOLDER = "ujjwal-dental";

/** How long a minted signature should be considered usable by the client. */
export const SIGNATURE_TTL_SECONDS = 600; // 10 minutes

/**
 * Mirrors the multer fileFilter's allowlist -- direct uploads bypass multer
 * entirely, so the same MIME restriction has to be reasserted here.
 */
const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  // iPhone camera default -- Cloudinary transcodes these on ingest.
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Matches the frontend's per-file cap and Cloudinary's own image limit. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * True when `url` is a Cloudinary delivery URL for THIS account's cloud and
 * inside the pinned folder. Guards against a caller passing any other URL.
 */
const isOwnCloudinaryUrl = (url) => {
  if (typeof url !== "string") return false;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "res.cloudinary.com") return false;
  // Path must begin with our cloud name, and the folder must appear as a real
  // path segment (not merely a substring of some other segment).
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== cloudName) return false;
  return segments.includes(CLOUDINARY_UPLOAD_FOLDER);
};

/**
 * Validate and normalize client-reported metadata for files the browser
 * already uploaded straight to Cloudinary.
 *
 * @param {unknown} rawFiles - `req.body.files`
 * @param {number} maxFiles
 * @returns {{ files: Array|null, error: string|null }}
 */
export const normalizeDirectUploadFiles = (rawFiles, maxFiles = 10) => {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return { files: null, error: "At least one file is required" };
  }
  if (rawFiles.length > maxFiles) {
    return { files: null, error: `Maximum ${maxFiles} files allowed per report` };
  }

  const files = [];
  for (const [index, raw] of rawFiles.entries()) {
    if (!raw || typeof raw !== "object") {
      return { files: null, error: `File ${index + 1} is malformed` };
    }

    if (!isOwnCloudinaryUrl(raw.url)) {
      return {
        files: null,
        error: `File ${index + 1} has an invalid upload URL. Files must be uploaded through the app.`,
      };
    }

    if (typeof raw.publicId !== "string" || !raw.publicId.startsWith(`${CLOUDINARY_UPLOAD_FOLDER}/`)) {
      return {
        files: null,
        error: `File ${index + 1} has an invalid storage reference.`,
      };
    }

    if (raw.fileType && !ALLOWED_FILE_TYPES.includes(raw.fileType)) {
      return {
        files: null,
        error: `File ${index + 1} has an unsupported type. Only images, PDFs and Word documents are allowed.`,
      };
    }

    const fileSize = Number(raw.fileSize) || 0;
    if (fileSize > MAX_FILE_BYTES) {
      return {
        files: null,
        error: `File ${index + 1} exceeds the ${MAX_FILE_BYTES / (1024 * 1024)}MB limit.`,
      };
    }

    files.push({
      url: raw.url,
      publicId: raw.publicId,
      fileName: typeof raw.fileName === "string" && raw.fileName.trim() ? raw.fileName.trim() : "upload",
      fileSize,
      fileType: typeof raw.fileType === "string" ? raw.fileType : undefined,
      thumbnailUrl: isOwnCloudinaryUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : undefined,
    });
  }

  return { files, error: null };
};
