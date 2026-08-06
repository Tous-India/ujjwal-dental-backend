import { checkPermission } from "../../middlewares/permission.middleware.js";
import { Router } from "express";
import * as notificationController from "./notification.controller.js";
import { authProtect, anyAuth } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * NOTIFICATION ROUTES
 * Base path: /api/notifications
 *
 * Notification types:
 * - Appointment confirmation, reminder, cancellation
 * - Payment received, reminder
 * - Report uploaded
 * - Membership activated, expiry reminder
 * - Follow-up reminder
 *
 * Channels: App (in-app), Email, SMS
 */

// ==================== ADMIN OPERATIONS (must come before :id routes) ====================

// Get all notifications (Admin view - all users)
router.get("/admin/all", authProtect, notificationController.getAllNotificationsAdmin);

// Get notification statistics
router.get("/admin/stats", authProtect, notificationController.getNotificationStats);

// Send notification manually (Admin)
router.post("/send", authProtect, checkPermission("notifications", "create"), notificationController.sendNotification);

// Send bulk notifications (Admin)
router.post("/send-bulk", authProtect, checkPermission("notifications", "create"), notificationController.sendBulkNotifications);

// Create appointment reminder notification
router.post("/reminder/appointment", authProtect, checkPermission("notifications", "create"), notificationController.createAppointmentReminder);

// Create payment reminder notification
router.post("/reminder/payment", authProtect, checkPermission("notifications", "create"), notificationController.createPaymentReminder);

// ==================== USER NOTIFICATIONS ====================

// Get all notifications for current user (Admin or Patient)
router.get("/", anyAuth, notificationController.getAllNotifications);

// Get unread count
router.get("/unread-count", anyAuth, notificationController.getUnreadCount);

// Get unread notifications only
router.get("/unread", anyAuth, notificationController.getUnreadNotifications);

// Mark all notifications as read
router.patch("/mark-all-read", anyAuth, notificationController.markAllAsRead);

// Get single notification by ID (must come after static routes)
router.get("/:id", anyAuth, notificationController.getNotificationById);

// Mark single notification as read
router.patch("/:id/read", anyAuth, notificationController.markAsRead);

// Mark single notification as unread
router.patch("/:id/unread", anyAuth, notificationController.markAsUnread);

// Delete notification
router.delete("/:id", anyAuth, notificationController.deleteNotification);

export default router;
