import mongoose from "mongoose";

/**
 * NOTIFICATION MODEL
 *
 * For sending notifications to patients and staff
 *
 * Types of notifications:
 * - Appointment reminders
 * - Payment reminders
 * - Treatment updates
 * - Membership expiry alerts
 * - General announcements
 */

const notificationSchema = new mongoose.Schema(
  {
    // Notification title
    title: {
      type: String,
      required: [true, "Notification title is required"],
    },

    // Notification message/body
    message: {
      type: String,
      required: [true, "Notification message is required"],
    },

    // Notification type
    type: {
      type: String,
      enum: [
        "appointment_reminder",
        "appointment_confirmation",
        "appointment_cancellation",
        "appointment_reschedule",
        "payment_reminder",
        "payment_received",
        "treatment_update",
        "test_result",
        "membership_expiry",
        "membership_renewal",
        "general",
        "promotional",
      ],
      required: [true, "Notification type is required"],
    },

    // Priority level
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },

    // -------- Recipients --------

    // Recipient type
    recipientType: {
      type: String,
      enum: ["patient", "user", "all_patients", "all_users"],
      required: true,
    },

    // Single recipient (patient or user)
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "recipientModel",
    },

    recipientModel: {
      type: String,
      enum: ["Patient", "User"],
    },

    // -------- Delivery Channels --------

    // Send via SMS?
    sendSms: {
      type: Boolean,
      default: false,
    },

    // Send via Email?
    sendEmail: {
      type: Boolean,
      default: false,
    },

    // Send via WhatsApp?
    sendWhatsapp: {
      type: Boolean,
      default: false,
    },

    // Show in app/dashboard?
    showInApp: {
      type: Boolean,
      default: true,
    },

    // -------- Delivery Status --------

    // SMS delivery status
    smsStatus: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String,
    },

    // Email delivery status
    emailStatus: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String,
    },

    // WhatsApp delivery status
    whatsappStatus: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String,
    },

    // -------- Read Status --------

    // Has the recipient read this notification?
    isRead: {
      type: Boolean,
      default: false,
    },

    // When was it read?
    readAt: Date,

    // -------- Related Entities --------

    // Related appointment (optional)
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
    },

    // Related invoice (optional)
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },

    // Related treatment (optional)
    treatment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Treatment",
    },

    // -------- Scheduling --------

    // Scheduled to send at (for future notifications)
    scheduledFor: Date,

    // Has been processed/sent?
    isProcessed: {
      type: Boolean,
      default: false,
    },

    // Processed at
    processedAt: Date,

    // -------- Meta --------

    // Created by (admin who created the notification)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Additional data (JSON)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// ============ INDEXES ============

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipientType: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ isRead: 1 });
notificationSchema.index({ scheduledFor: 1, isProcessed: 1 });

// ============ METHODS ============

/**
 * Mark notification as read
 */
notificationSchema.methods.markAsRead = function () {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

/**
 * Mark notification as unread
 */
notificationSchema.methods.markAsUnread = function () {
  this.isRead = false;
  this.readAt = null;
  return this.save();
};

/**
 * Update SMS status
 */
notificationSchema.methods.updateSmsStatus = function (sent, error = null) {
  this.smsStatus = {
    sent,
    sentAt: sent ? new Date() : null,
    error,
  };
  return this.save();
};

/**
 * Update Email status
 */
notificationSchema.methods.updateEmailStatus = function (sent, error = null) {
  this.emailStatus = {
    sent,
    sentAt: sent ? new Date() : null,
    error,
  };
  return this.save();
};

/**
 * Mark as processed
 */
notificationSchema.methods.markAsProcessed = function () {
  this.isProcessed = true;
  this.processedAt = new Date();
  return this.save();
};

// ============ STATICS ============

/**
 * Get unread notifications for a recipient
 */
notificationSchema.statics.getUnread = function (recipientId, recipientModel) {
  return this.find({
    recipient: recipientId,
    recipientModel,
    isRead: false,
    showInApp: true,
  }).sort({ createdAt: -1 });
};

/**
 * Get all notifications for a recipient (with pagination)
 */
notificationSchema.statics.getForRecipient = function (recipientId, recipientModel, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return this.find({
    recipient: recipientId,
    recipientModel,
    showInApp: true,
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

/**
 * Get unread count for a recipient
 */
notificationSchema.statics.getUnreadCount = function (recipientId, recipientModel) {
  return this.countDocuments({
    recipient: recipientId,
    recipientModel,
    isRead: false,
    showInApp: true,
  });
};

/**
 * Mark all as read for a recipient
 */
notificationSchema.statics.markAllAsRead = function (recipientId, recipientModel) {
  return this.updateMany(
    {
      recipient: recipientId,
      recipientModel,
      isRead: false,
    },
    {
      isRead: true,
      readAt: new Date(),
    }
  );
};

/**
 * Get scheduled notifications that need to be sent
 */
notificationSchema.statics.getScheduledToSend = function () {
  return this.find({
    scheduledFor: { $lte: new Date() },
    isProcessed: false,
  });
};

/**
 * Create appointment reminder notification
 */
notificationSchema.statics.createAppointmentReminder = async function (appointment, patient) {
  const notification = new this({
    title: "Appointment Reminder",
    message: `Your appointment is scheduled for ${new Date(appointment.date).toLocaleDateString()} at ${appointment.timeSlot}. Please arrive 10 minutes early.`,
    type: "appointment_reminder",
    recipientType: "patient",
    recipient: patient._id,
    recipientModel: "Patient",
    sendSms: true,
    sendWhatsapp: true,
    showInApp: true,
    appointment: appointment._id,
    priority: "high",
  });

  return notification.save();
};

/**
 * Create payment reminder notification
 */
notificationSchema.statics.createPaymentReminder = async function (invoice, patient) {
  const notification = new this({
    title: "Payment Reminder",
    message: `You have a pending payment of ₹${invoice.balanceDue} for invoice ${invoice.invoiceNumber}. Please make the payment at your earliest convenience.`,
    type: "payment_reminder",
    recipientType: "patient",
    recipient: patient._id,
    recipientModel: "Patient",
    sendSms: true,
    showInApp: true,
    invoice: invoice._id,
    priority: "normal",
  });

  return notification.save();
};

// Create and export the model
const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
