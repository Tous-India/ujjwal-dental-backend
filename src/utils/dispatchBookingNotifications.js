import Appointment from "../modules/appointments/appointment.model.js";
import {
  sendClinicBookingNotification,
  sendPatientBookingConfirmation,
} from "./email.js";

/**
 * Fire-and-forget: send clinic + patient emails for a new booking,
 * then record timestamps / errors on the appointment document.
 * Never throws — all failures are logged and swallowed.
 */
const dispatchBookingNotifications = async (appointmentId) => {
  try {
    const appointment = await Appointment.findById(appointmentId)
      .populate("patient", "name email phone")
      .populate("clinic", "name address phone");

    if (!appointment) {
      console.error("[Notify] Appointment not found:", appointmentId);
      return;
    }

    const [clinicResult, patientResult] = await Promise.allSettled([
      sendClinicBookingNotification(appointment),
      sendPatientBookingConfirmation(appointment),
    ]);

    const update = {};
    const now = new Date();

    if (clinicResult.status === "fulfilled" && clinicResult.value?.success) {
      update["notifications.clinicEmailSentAt"] = now;
    } else {
      const err =
        clinicResult.reason?.message || clinicResult.value?.error || "unknown";
      update["notifications.clinicEmailError"] = err;
      console.error("[Notify] Clinic email failed:", err);
    }

    if (patientResult.status === "fulfilled" && patientResult.value?.success) {
      update["notifications.patientEmailSentAt"] = now;
    } else {
      const err =
        patientResult.reason?.message ||
        patientResult.value?.error ||
        "unknown";
      update["notifications.patientEmailError"] = err;
      console.error("[Notify] Patient email failed:", err);
    }

    if (Object.keys(update).length > 0) {
      await Appointment.findByIdAndUpdate(appointmentId, { $set: update });
    }
  } catch (err) {
    console.error("[Notify] dispatchBookingNotifications error:", err.message);
  }
};

export default dispatchBookingNotifications;
