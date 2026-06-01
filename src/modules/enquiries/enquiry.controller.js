import Enquiry from "./enquiry.model.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { notify } from "../../utils/notifyHelper.js";
import User from "../users/user.model.js";

/**
 * ENQUIRY CONTROLLER
 *
 * Handles CRUD operations for enquiries/leads from treatment pages.
 *
 * ═══════════════════════════════════════════════════════════════
 * POSTMAN TESTING GUIDE
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. SUBMIT ENQUIRY (Public - from treatment page form)
 * ------------------------------------------------------
 * Method: POST
 * URL: http://localhost:5000/api/enquiries
 * Headers:
 *   - Content-Type: application/json
 * Body (JSON):
 * {
 *   "name": "Rahul Sharma",
 *   "phone": "9876543210",
 *   "email": "rahul@example.com",
 *   "treatmentName": "Root Canal Treatment",
 *   "message": "I have severe tooth pain since 3 days",
 *   "preferredDate": "2026-01-28",
 *   "preferredTime": "Morning",
 *   "source": {
 *     "page": "root-canal-treatment-rct",
 *     "utm_source": "google",
 *     "utm_medium": "cpc",
 *     "utm_campaign": "dental-ads",
 *     "device": "mobile"
 *   }
 * }
 *
 *
 * 2. GET ALL ENQUIRIES (Admin)
 * ----------------------------
 * Method: GET
 * URL: http://localhost:5000/api/enquiries
 * URL with filters: http://localhost:5000/api/enquiries?status=new&page=1&limit=20
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 * Query Parameters:
 *   - status: new, contacted, appointment_scheduled, visited, converted, not_interested, invalid, closed
 *   - treatment: treatment ObjectId
 *   - assignedTo: user ObjectId
 *   - dateFrom: 2026-01-01
 *   - dateTo: 2026-01-31
 *   - search: search by name, phone, email
 *   - page: 1 (default)
 *   - limit: 20 (default)
 *
 *
 * 3. GET SINGLE ENQUIRY
 * ---------------------
 * Method: GET
 * URL: http://localhost:5000/api/enquiries/:id
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 *
 * 4. UPDATE ENQUIRY STATUS
 * ------------------------
 * Method: PATCH
 * URL: http://localhost:5000/api/enquiries/:id/status
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *   - Content-Type: application/json
 * Body (JSON):
 * {
 *   "status": "contacted",
 *   "note": "Called customer, will visit tomorrow"
 * }
 *
 *
 * 5. ASSIGN ENQUIRY TO STAFF
 * --------------------------
 * Method: PATCH
 * URL: http://localhost:5000/api/enquiries/:id/assign
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *   - Content-Type: application/json
 * Body (JSON):
 * {
 *   "assignedTo": "user_id_here"
 * }
 *
 *
 * 6. ADD NOTE TO ENQUIRY
 * ----------------------
 * Method: POST
 * URL: http://localhost:5000/api/enquiries/:id/notes
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *   - Content-Type: application/json
 * Body (JSON):
 * {
 *   "text": "Customer requested callback after 5 PM"
 * }
 *
 *
 * 7. SCHEDULE FOLLOW-UP
 * ---------------------
 * Method: PATCH
 * URL: http://localhost:5000/api/enquiries/:id/follow-up
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *   - Content-Type: application/json
 * Body (JSON):
 * {
 *   "nextFollowUp": "2026-01-25T10:00:00.000Z"
 * }
 *
 *
 * 8. GET ENQUIRY STATISTICS
 * -------------------------
 * Method: GET
 * URL: http://localhost:5000/api/enquiries/stats
 * URL with date range: http://localhost:5000/api/enquiries/stats?dateFrom=2026-01-01&dateTo=2026-01-31
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 *
 * 9. GET TODAY'S ENQUIRIES
 * ------------------------
 * Method: GET
 * URL: http://localhost:5000/api/enquiries/today
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 *
 * 10. GET PENDING FOLLOW-UPS
 * --------------------------
 * Method: GET
 * URL: http://localhost:5000/api/enquiries/pending-follow-ups
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 *
 * 11. GET ENQUIRIES BY TREATMENT
 * ------------------------------
 * Method: GET
 * URL: http://localhost:5000/api/enquiries/treatment/:treatmentId
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 *
 * 12. MARK AS SPAM
 * ----------------
 * Method: PATCH
 * URL: http://localhost:5000/api/enquiries/:id/spam
 * Headers:
 *   - Authorization: Bearer <admin_token>
 * Body (JSON):
 * {
 *   "isSpam": true
 * }
 *
 *
 * 13. DELETE ENQUIRY
 * ------------------
 * Method: DELETE
 * URL: http://localhost:5000/api/enquiries/:id
 * Headers:
 *   - Authorization: Bearer <admin_token>
 *
 * ═══════════════════════════════════════════════════════════════
 */

// ============ PUBLIC ENDPOINTS ============

/**
 * Submit a new enquiry (from treatment page form)
 * POST /api/enquiries
 * Public access
 */
export const submitEnquiry = async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      treatment,
      treatmentName,
      message,
      preferredDate,
      preferredTime,
      preferredClinic,
      source,
    } = req.body;

    // Create enquiry
    const enquiry = await Enquiry.create({
      name,
      phone,
      email,
      treatment,
      treatmentName,
      message,
      preferredDate,
      preferredTime,
      preferredClinic,
      source,
    });

    // Send email notification to admin
    try {
      const { sendEmail } = await import("../../utils/email.js");
      sendEmail({
        to: process.env.SMTP_USER,
        subject: `New Enquiry: ${name} - ${treatmentName || "General"}`,
        html: `
          <div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px">
            <h2 style="color:#1976d2">New Contact Form Submission</h2>
            <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0">
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Email:</strong> ${email || "Not provided"}</p>
              <p><strong>Subject:</strong> ${treatmentName || "General"}</p>
              <p><strong>Message:</strong> ${message || "No message"}</p>
              <p><strong>Enquiry #:</strong> ${enquiry.enquiryNumber}</p>
            </div>
            <p style="color:#666;font-size:12px">View in admin panel: Enquiries section</p>
          </div>
        `,
        text: `New enquiry from ${name} (${phone}). Subject: ${treatmentName}. Message: ${message}`,
      }).catch((err) => console.error("[Enquiry] Email notification error:", err));
    } catch (err) {
      console.error("[Enquiry] Email import error:", err);
    }

    return ApiResponse.success(
      res,
      {
        enquiry: {
          _id: enquiry._id,
          enquiryNumber: enquiry.enquiryNumber,
          name: enquiry.name,
          treatmentName: enquiry.treatmentName,
        },
      },
      "Enquiry submitted successfully. We will contact you soon!",
      201
    );

    // Notify admin about new enquiry
    const admin = await User.findOne({ role: "admin" });
    if (admin) {
      notify({ recipientId: admin._id, recipientModel: "User", type: "general", title: "New Enquiry Received", message: `New enquiry from ${enquiry.name} (${enquiry.phone})${enquiry.treatmentName ? ` for ${enquiry.treatmentName}` : ""}` });
    }
  } catch (error) {
    console.error("Submit enquiry error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

// ============ ADMIN ENDPOINTS ============

/**
 * Get all enquiries with pagination and filters
 * GET /api/enquiries
 * Admin only
 */
export const getAllEnquiries = async (req, res) => {
  try {
    const {
      status,
      treatment,
      assignedTo,
      dateFrom,
      dateTo,
      search,
      isSpam,
      isUrgent,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query = {};

    if (status) query.status = status;
    if (treatment) query.treatment = treatment;
    if (assignedTo) query.assignedTo = assignedTo;
    if (isSpam !== undefined) query.isSpam = isSpam === "true";
    if (isUrgent !== undefined) query.isUrgent = isUrgent === "true";

    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Search by name, phone, or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { enquiryNumber: { $regex: search, $options: "i" } },
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Execute query
    const [enquiries, total] = await Promise.all([
      Enquiry.find(query)
        .populate("treatment", "title slug")
        .populate("assignedTo", "name email")
        .populate("preferredClinic", "name")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Enquiry.countDocuments(query),
    ]);

    return ApiResponse.success(res, {
      enquiries,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get enquiries error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Get single enquiry by ID
 * GET /api/enquiries/:id
 * Admin only
 */
export const getEnquiryById = async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id)
      .populate("treatment", "title slug")
      .populate("assignedTo", "name email phone")
      .populate("preferredClinic", "name address")
      .populate("convertedToPatient", "name phone patientId")
      .populate("appointmentBooked", "appointmentNumber date")
      .populate("notes.addedBy", "name")
      .populate("statusHistory.changedBy", "name");

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    return ApiResponse.success(res, { enquiry });
  } catch (error) {
    console.error("Get enquiry error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Update enquiry status
 * PATCH /api/enquiries/:id/status
 * Admin only
 */
export const updateEnquiryStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const userId = req.user?._id;

    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    // Use the model's updateStatus method
    await enquiry.updateStatus(status, userId, note);

    return ApiResponse.success(
      res,
      { enquiry },
      `Status updated to ${status}`
    );
  } catch (error) {
    console.error("Update status error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Assign enquiry to staff member
 * PATCH /api/enquiries/:id/assign
 * Admin only
 */
export const assignEnquiry = async (req, res) => {
  try {
    const { assignedTo } = req.body;

    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    await enquiry.assignTo(assignedTo);

    // Populate assigned user for response
    await enquiry.populate("assignedTo", "name email");

    return ApiResponse.success(
      res,
      { enquiry },
      "Enquiry assigned successfully"
    );
  } catch (error) {
    console.error("Assign enquiry error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Add note to enquiry
 * POST /api/enquiries/:id/notes
 * Admin only
 */
export const addNote = async (req, res) => {
  try {
    const { text } = req.body;
    const userId = req.user?._id;

    if (!text || !text.trim()) {
      return ApiResponse.error(res, "Note text is required", 400);
    }

    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    await enquiry.addNote(text, userId);

    // Populate notes for response
    await enquiry.populate("notes.addedBy", "name");

    return ApiResponse.success(
      res,
      { notes: enquiry.notes },
      "Note added successfully"
    );
  } catch (error) {
    console.error("Add note error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Schedule follow-up
 * PATCH /api/enquiries/:id/follow-up
 * Admin only
 */
export const scheduleFollowUp = async (req, res) => {
  try {
    const { nextFollowUp } = req.body;

    if (!nextFollowUp) {
      return ApiResponse.error(res, "Follow-up date is required", 400);
    }

    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    await enquiry.scheduleFollowUp(new Date(nextFollowUp));

    return ApiResponse.success(
      res,
      { nextFollowUp: enquiry.nextFollowUp },
      "Follow-up scheduled successfully"
    );
  } catch (error) {
    console.error("Schedule follow-up error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Get enquiry statistics
 * GET /api/enquiries/stats
 * Admin only
 */
export const getEnquiryStats = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const stats = await Enquiry.getStats(dateFrom, dateTo);

    return ApiResponse.success(res, { stats });
  } catch (error) {
    console.error("Get stats error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Get today's enquiries
 * GET /api/enquiries/today
 * Admin only
 */
export const getTodayEnquiries = async (req, res) => {
  try {
    const enquiries = await Enquiry.getTodayEnquiries();

    return ApiResponse.success(res, {
      enquiries,
      count: enquiries.length,
    });
  } catch (error) {
    console.error("Get today's enquiries error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Get pending follow-ups
 * GET /api/enquiries/pending-follow-ups
 * Admin only
 */
export const getPendingFollowUps = async (req, res) => {
  try {
    // If user is not admin, only show their assigned follow-ups
    const userId = req.user?.role !== "admin" ? req.user?._id : null;

    const enquiries = await Enquiry.getPendingFollowUps(userId);

    return ApiResponse.success(res, {
      enquiries,
      count: enquiries.length,
    });
  } catch (error) {
    console.error("Get pending follow-ups error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Get enquiries by treatment
 * GET /api/enquiries/treatment/:treatmentId
 * Admin only
 */
export const getEnquiriesByTreatment = async (req, res) => {
  try {
    const { treatmentId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [enquiries, total] = await Promise.all([
      Enquiry.find({ treatment: treatmentId })
        .populate("assignedTo", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Enquiry.countDocuments({ treatment: treatmentId }),
    ]);

    return ApiResponse.success(res, {
      enquiries,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total,
      },
    });
  } catch (error) {
    console.error("Get enquiries by treatment error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Update enquiry (general update)
 * PATCH /api/enquiries/:id
 * Admin only
 */
export const updateEnquiry = async (req, res) => {
  try {
    const allowedFields = [
      "name",
      "phone",
      "email",
      "message",
      "preferredDate",
      "preferredTime",
      "preferredClinic",
      "isUrgent",
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const enquiry = await Enquiry.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    )
      .populate("treatment", "title slug")
      .populate("assignedTo", "name email");

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    return ApiResponse.success(res, { enquiry }, "Enquiry updated successfully");
  } catch (error) {
    console.error("Update enquiry error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Mark enquiry as spam
 * PATCH /api/enquiries/:id/spam
 * Admin only
 */
export const markAsSpam = async (req, res) => {
  try {
    const { isSpam } = req.body;

    const enquiry = await Enquiry.findByIdAndUpdate(
      req.params.id,
      {
        isSpam: isSpam !== undefined ? isSpam : true,
        status: isSpam ? "invalid" : "new",
      },
      { new: true }
    );

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    return ApiResponse.success(
      res,
      { enquiry },
      isSpam ? "Marked as spam" : "Removed spam flag"
    );
  } catch (error) {
    console.error("Mark as spam error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Delete enquiry
 * DELETE /api/enquiries/:id
 * Admin only
 */
export const deleteEnquiry = async (req, res) => {
  try {
    const enquiry = await Enquiry.findByIdAndDelete(req.params.id);

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    return ApiResponse.success(res, null, "Enquiry deleted successfully");
  } catch (error) {
    console.error("Delete enquiry error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};

/**
 * Mark enquiry as converted (linked to patient)
 * PATCH /api/enquiries/:id/convert
 * Admin only
 */
export const markConverted = async (req, res) => {
  try {
    const { patientId } = req.body;
    const userId = req.user?._id;

    if (!patientId) {
      return ApiResponse.error(res, "Patient ID is required", 400);
    }

    const enquiry = await Enquiry.findById(req.params.id);

    if (!enquiry) {
      return ApiResponse.error(res, "Enquiry not found", 404);
    }

    await enquiry.markConverted(patientId, userId);

    await enquiry.populate("convertedToPatient", "name phone patientId");

    return ApiResponse.success(
      res,
      { enquiry },
      "Enquiry marked as converted"
    );
  } catch (error) {
    console.error("Mark converted error:", error);
    return ApiResponse.error(res, error.message, 500);
  }
};
