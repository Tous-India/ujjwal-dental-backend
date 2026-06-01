import Notification from "../modules/notifications/notification.model.js";
import { processNotificationDelivery } from "../modules/notifications/notification.controller.js";

export const notify = async ({
  recipientId,
  recipientModel = "Patient",
  type = "general",
  title,
  message,
  sendEmail = false,
  appointment,
  invoice,
  treatment,
  createdBy,
}) => {
  try {
    const notification = await Notification.create({
      title,
      message,
      type,
      recipientType: recipientModel === "Patient" ? "patient" : "user",
      recipient: recipientId,
      recipientModel,
      sendEmail,
      showInApp: true,
      ...(appointment && { appointment }),
      ...(invoice && { invoice }),
      ...(treatment && { treatment }),
      ...(createdBy && { createdBy }),
    });

    if (sendEmail) {
      processNotificationDelivery(notification).catch(() => {});
    }
  } catch (err) {
    console.error("Notification helper error:", err.message);
  }
};
