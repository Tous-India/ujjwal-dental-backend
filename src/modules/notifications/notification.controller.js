import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { sendEmail } from "../../utils/email.js";
import Notification from "./notification.model.js";
import Patient from "../patients/patient.model.js";
import User from "../users/user.model.js";
import mongoose from "mongoose";
import { parseIstDateRange } from "../../utils/istDateRange.js";

/**
 * NOTIFICATION CONTROLLER
 *
 * Handles:
 * - Notification CRUD
 * - Read/Unread status
 * - Multi-channel delivery (app, SMS, email, WhatsApp)
 */

/**
 * @desc    Get all notifications for current user
 * @route   GET /api/notifications?read=&type=
 * @access  Private (Admin / Patient)
 */
export const getAllNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, read, type } = req.query;

  // Determine recipient based on who is logged in
  let recipientId, recipientModel;

  if (req.user) {
    recipientId = req.user._id;
    recipientModel = "User";
  } else if (req.patient) {
    recipientId = req.patient._id;
    recipientModel = "Patient";
  } else {
    return ApiResponse.error(res, "Unauthorized", 401);
  }

  // Build query
  const query = {
    recipient: recipientId,
    recipientModel,
    showInApp: true,
  };

  if (read !== undefined) {
    query.isRead = read === "true";
  }

  if (type) {
    query.type = type;
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .populate("appointment", "date timeSlot")
      .populate("invoice", "invoiceNumber grandTotal")
      .populate("treatment", "treatmentNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Notification.countDocuments(query),
  ]);

  ApiResponse.paginated(res, notifications, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get notification by ID
 * @route   GET /api/notifications/:id
 * @access  Private (Admin / Patient)
 */
export const getNotificationById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid notification ID", 400);
  }

  const notification = await Notification.findById(id)
    .populate("appointment")
    .populate("invoice")
    .populate("treatment")
    .populate("createdBy", "name");

  if (!notification) {
    return ApiResponse.error(res, "Notification not found", 404);
  }

  // Verify ownership
  const isOwner = verifyOwnership(req, notification);
  if (!isOwner) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  ApiResponse.success(res, { notification }, "Notification fetched successfully");
});

/**
 * @desc    Get unread notification count
 * @route   GET /api/notifications/unread-count
 * @access  Private (Admin / Patient)
 */
export const getUnreadCount = asyncHandler(async (req, res) => {
  let recipientId, recipientModel;

  if (req.user) {
    recipientId = req.user._id;
    recipientModel = "User";
  } else if (req.patient) {
    recipientId = req.patient._id;
    recipientModel = "Patient";
  } else {
    return ApiResponse.error(res, "Unauthorized", 401);
  }

  const count = await Notification.getUnreadCount(recipientId, recipientModel);

  ApiResponse.success(res, { count }, "Unread count fetched successfully");
});

/**
 * @desc    Get unread notifications
 * @route   GET /api/notifications/unread
 * @access  Private (Admin / Patient)
 */
export const getUnreadNotifications = asyncHandler(async (req, res) => {
  let recipientId, recipientModel;

  if (req.user) {
    recipientId = req.user._id;
    recipientModel = "User";
  } else if (req.patient) {
    recipientId = req.patient._id;
    recipientModel = "Patient";
  } else {
    return ApiResponse.error(res, "Unauthorized", 401);
  }

  const notifications = await Notification.getUnread(recipientId, recipientModel);

  ApiResponse.success(res, { notifications }, "Unread notifications fetched successfully");
});

/**
 * @desc    Mark notification as read
 * @route   PATCH /api/notifications/:id/read
 * @access  Private (Admin / Patient)
 */
export const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid notification ID", 400);
  }

  const notification = await Notification.findById(id);

  if (!notification) {
    return ApiResponse.error(res, "Notification not found", 404);
  }

  // Verify ownership
  const isOwner = verifyOwnership(req, notification);
  if (!isOwner) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  await notification.markAsRead();

  ApiResponse.success(res, { notification }, "Notification marked as read");
});

/**
 * @desc    Mark notification as unread
 * @route   PATCH /api/notifications/:id/unread
 * @access  Private (Admin / Patient)
 */
export const markAsUnread = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid notification ID", 400);
  }

  const notification = await Notification.findById(id);

  if (!notification) {
    return ApiResponse.error(res, "Notification not found", 404);
  }

  // Verify ownership
  const isOwner = verifyOwnership(req, notification);
  if (!isOwner) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  await notification.markAsUnread();

  ApiResponse.success(res, { notification }, "Notification marked as unread");
});

/**
 * @desc    Mark all notifications as read
 * @route   PATCH /api/notifications/read-all
 * @access  Private (Admin / Patient)
 */
export const markAllAsRead = asyncHandler(async (req, res) => {
  let recipientId, recipientModel;

  if (req.user) {
    recipientId = req.user._id;
    recipientModel = "User";
  } else if (req.patient) {
    recipientId = req.patient._id;
    recipientModel = "Patient";
  } else {
    return ApiResponse.error(res, "Unauthorized", 401);
  }

  const result = await Notification.markAllAsRead(recipientId, recipientModel);

  ApiResponse.success(
    res,
    { modifiedCount: result.modifiedCount },
    "All notifications marked as read"
  );
});

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:id
 * @access  Private (Admin / Patient)
 */
export const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid notification ID", 400);
  }

  const notification = await Notification.findById(id);

  if (!notification) {
    return ApiResponse.error(res, "Notification not found", 404);
  }

  // Verify ownership
  const isOwner = verifyOwnership(req, notification);
  if (!isOwner) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  await Notification.findByIdAndDelete(id);

  ApiResponse.success(res, null, "Notification deleted successfully");
});

// ==================== ADMIN OPERATIONS ====================

/**
 * @desc    Send notification manually
 * @route   POST /api/notifications/send
 * @access  Admin
 */
export const sendNotification = asyncHandler(async (req, res) => {
  const {
    recipientType,
    recipientId,
    type,
    title,
    message,
    priority,
    sendSms,
    sendEmail,
    sendWhatsapp,
    showInApp,
    scheduledFor,
    appointment,
    invoice,
    treatment,
    metadata,
  } = req.body;

  // Validation
  if (!recipientType || !type || !title || !message) {
    return ApiResponse.error(res, "Recipient type, notification type, title and message are required", 400);
  }

  // Determine recipient model
  let recipientModel;
  if (recipientType === "patient") {
    recipientModel = "Patient";
    // Verify patient exists if single recipient
    if (recipientId) {
      const patient = await Patient.findById(recipientId);
      if (!patient) {
        return ApiResponse.error(res, "Patient not found", 404);
      }
    }
  } else if (recipientType === "user") {
    recipientModel = "User";
    // Verify user exists if single recipient
    if (recipientId) {
      const user = await User.findById(recipientId);
      if (!user) {
        return ApiResponse.error(res, "User not found", 404);
      }
    }
  }

  // Create notification
  const notification = await Notification.create({
    title,
    message,
    type,
    priority: priority || "normal",
    recipientType,
    recipient: recipientId,
    recipientModel,
    sendSms: sendSms || false,
    sendEmail: sendEmail || false,
    sendWhatsapp: sendWhatsapp || false,
    showInApp: showInApp !== false,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    appointment,
    invoice,
    treatment,
    metadata,
    createdBy: req.user._id,
  });

  // If not scheduled for later, process immediately
  if (!scheduledFor) {
    await processNotificationDelivery(notification);
  }

  ApiResponse.created(res, { notification }, "Notification sent successfully");
});

/**
 * @desc    Send bulk notifications
 * @route   POST /api/notifications/send-bulk
 * @access  Admin
 */
export const sendBulkNotifications = asyncHandler(async (req, res) => {
  const {
    recipientType, // 'all_patients', 'all_users', or 'selected'
    recipientIds, // Array of IDs if 'selected'
    type,
    title,
    message,
    priority,
    sendSms,
    sendEmail,
    sendWhatsapp,
    showInApp,
  } = req.body;

  // Validation
  if (!recipientType || !type || !title || !message) {
    return ApiResponse.error(res, "Recipient type, notification type, title and message are required", 400);
  }

  let recipients = [];
  let recipientModel;

  if (recipientType === "all_patients") {
    recipients = await Patient.find({ isActive: true }).select("_id");
    recipientModel = "Patient";
  } else if (recipientType === "all_users") {
    recipients = await User.find({ isActive: true }).select("_id");
    recipientModel = "User";
  } else if (recipientType === "selected" && recipientIds?.length > 0) {
    recipients = recipientIds.map((id) => ({ _id: id }));
    recipientModel = req.body.recipientModel || "Patient";
  } else {
    return ApiResponse.error(res, "Invalid recipient type or no recipients selected", 400);
  }

  // Create notifications for each recipient
  const notifications = [];
  for (const recipient of recipients) {
    const notification = await Notification.create({
      title,
      message,
      type,
      priority: priority || "normal",
      recipientType: recipientType === "all_patients" ? "patient" : recipientType === "all_users" ? "user" : "patient",
      recipient: recipient._id,
      recipientModel,
      sendSms: sendSms || false,
      sendEmail: sendEmail || false,
      sendWhatsapp: sendWhatsapp || false,
      showInApp: showInApp !== false,
      createdBy: req.user._id,
    });
    notifications.push(notification);

    // Process delivery
    await processNotificationDelivery(notification);
  }

  ApiResponse.success(
    res,
    {
      sentCount: notifications.length,
      notifications: notifications.slice(0, 5), // Return first 5 for reference
    },
    `${notifications.length} notifications sent successfully`
  );
});

/**
 * @desc    Create appointment reminder
 * @route   POST /api/notifications/appointment-reminder
 * @access  Admin
 */
export const createAppointmentReminder = asyncHandler(async (req, res) => {
  const { appointmentId, patientId } = req.body;

  if (!appointmentId || !patientId) {
    return ApiResponse.error(res, "Appointment ID and Patient ID are required", 400);
  }

  // Import Appointment model
  const Appointment = mongoose.model("Appointment");
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return ApiResponse.error(res, "Appointment not found", 404);
  }

  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  const notification = await Notification.createAppointmentReminder(appointment, patient);

  // Process delivery
  await processNotificationDelivery(notification);

  ApiResponse.created(res, { notification }, "Appointment reminder sent successfully");
});

/**
 * @desc    Create payment reminder
 * @route   POST /api/notifications/payment-reminder
 * @access  Admin
 */
export const createPaymentReminder = asyncHandler(async (req, res) => {
  const { invoiceId, patientId } = req.body;

  if (!invoiceId || !patientId) {
    return ApiResponse.error(res, "Invoice ID and Patient ID are required", 400);
  }

  // Import Invoice model
  const Invoice = mongoose.model("Invoice");
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    return ApiResponse.error(res, "Invoice not found", 404);
  }

  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  const notification = await Notification.createPaymentReminder(invoice, patient);

  // Process delivery
  await processNotificationDelivery(notification);

  ApiResponse.created(res, { notification }, "Payment reminder sent successfully");
});

/**
 * @desc    Get all notifications (admin view)
 * @route   GET /api/notifications/admin/all
 * @access  Admin
 */
export const getAllNotificationsAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type, recipientType, from, to } = req.query;

  // Build query
  const query = {};

  if (type) {
    query.type = type;
  }

  if (recipientType) {
    query.recipientType = recipientType;
  }

  if (from || to) {
    query.createdAt = parseIstDateRange(from, to);
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .populate("recipient", "name phone email")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Notification.countDocuments(query),
  ]);

  ApiResponse.paginated(res, notifications, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get notification statistics
 * @route   GET /api/notifications/stats
 * @access  Admin
 */
export const getNotificationStats = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  // Date range (default: last 30 days)
  const istRange = parseIstDateRange(from, to);
  const startDate = istRange.$gte || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = istRange.$lte || new Date();

  const stats = await Notification.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$type",
        total: { $sum: 1 },
        read: { $sum: { $cond: ["$isRead", 1, 0] } },
        smsSent: { $sum: { $cond: ["$smsStatus.sent", 1, 0] } },
        emailSent: { $sum: { $cond: ["$emailStatus.sent", 1, 0] } },
      },
    },
  ]);

  const totalStats = {
    total: stats.reduce((sum, s) => sum + s.total, 0),
    read: stats.reduce((sum, s) => sum + s.read, 0),
    smsSent: stats.reduce((sum, s) => sum + s.smsSent, 0),
    emailSent: stats.reduce((sum, s) => sum + s.emailSent, 0),
    byType: stats,
  };

  ApiResponse.success(
    res,
    {
      stats: totalStats,
      dateRange: { from: startDate, to: endDate },
    },
    "Notification statistics fetched successfully"
  );
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Verify that the current user owns the notification
 */
function verifyOwnership(req, notification) {
  if (req.user) {
    return (
      notification.recipientModel === "User" &&
      notification.recipient.toString() === req.user._id.toString()
    );
  } else if (req.patient) {
    return (
      notification.recipientModel === "Patient" &&
      notification.recipient.toString() === req.patient._id.toString()
    );
  }
  return false;
}

/**
 * Process notification delivery across channels
 * This is a placeholder - actual implementation would integrate with SMS/Email providers
 */
export async function processNotificationDelivery(notification) {
  try {
    // Send SMS if enabled (TODO: integrate provider later)
    if (notification.sendSms) {
      console.log(`SMS pending setup: ${notification.title}`);
    }

    // Send Email if enabled
    if (notification.sendEmail) {
      try {
        const Model = notification.recipientModel === "Patient" ? Patient : User;
        const recipient = await Model.findById(notification.recipient);
        if (recipient?.email) {
          await sendEmail({
            to: recipient.email,
            subject: notification.title,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
              <h2 style="color:#003366">${notification.title}</h2>
              <p style="color:#555;line-height:1.6">${notification.message}</p>
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
              <p style="color:#999;font-size:12px">Ujjwal Dental Clinic — Caring For Your Smile</p>
            </div>`,
          });
          notification.emailStatus = { sent: true, sentAt: new Date() };
        }
      } catch (err) {
        notification.emailStatus = { sent: false, error: err.message };
      }
    }

    // Send WhatsApp if enabled (TODO: integrate provider later)
    if (notification.sendWhatsapp) {
      console.log(`WhatsApp pending setup: ${notification.title}`);
    }

    notification.isProcessed = true;
    notification.processedAt = new Date();
    await notification.save();
  } catch (error) {
    console.error("Error processing notification delivery:", error);
  }
}
