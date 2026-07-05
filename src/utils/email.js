import nodemailer from "nodemailer";

/**
 * EMAIL UTILITY
 *
 * Handles sending emails via SMTP (configured in .env)
 * Uses nodemailer for email delivery
 */

// Create transporter (reusable)
let transporter = null;

/**
 * Initialize the email transporter
 */
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

/**
 * Send an email
 */
export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const transport = getTransporter();
    const mailOptions = {
      from: `"Ujjwal Dental Clinic" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html: html || text,
    };
    const result = await transport.sendMail(mailOptions);
    console.log(`Email sent to ${to}: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send OTP email for patient login
 */
export const sendOtpEmail = async (email, otp, patientName = "Patient") => {
  const subject = "Your Login OTP - Ujjwal Dental Clinic";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
      <p>Hello ${patientName},</p>
      <p>Your One-Time Password (OTP) for login is:</p>
      <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1976d2;">${otp}</span>
      </div>
      <p>This OTP is valid for <strong>10 minutes</strong>.</p>
      <p style="color: #f44336; font-size: 13px;">Do not share this OTP with anyone.</p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Patient Portal</p>
    </div>
  `;
  const text = `Hello ${patientName}, Your OTP for login is: ${otp}. Valid for 10 minutes.`;
  return sendEmail({ to: email, subject, text, html });
};

export const CLINIC_NOTIFY_EMAIL =
  process.env.CLINIC_NOTIFY_EMAIL || process.env.SMTP_USER;

export const sendClinicBookingNotification = async (appointment) => {
  const to = CLINIC_NOTIFY_EMAIL;
  if (!to) return { success: false, error: "CLINIC_NOTIFY_EMAIL not configured" };

  const patient = appointment.patient || {};
  const clinic = appointment.clinic || {};
  const apptDate = appointment.date
    ? new Date(appointment.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "N/A";
  const addr = clinic.address
    ? [clinic.address.street, clinic.address.area, clinic.address.city]
        .filter(Boolean)
        .join(", ")
    : "";

  const subject = `New Appointment — #${appointment.appointmentNumber || "N/A"}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1976d2; margin-bottom: 4px;">New Appointment Booked</h2>
      <p style="color: #555; margin-top: 0;">${clinic.name || "Ujjwal Dental Clinic"}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666; width: 140px;">Appt #</td><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${appointment.appointmentNumber || "N/A"}</strong></td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Token</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${appointment.tokenNumber || "N/A"}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Patient</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${patient.name || "N/A"}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Phone</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${patient.phone || "N/A"}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Date</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${apptDate}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Time</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${appointment.timeSlot || "N/A"}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Reason</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${appointment.reason || "N/A"}</td></tr>
        <tr><td style="padding: 8px; color: #666;">Source</td><td style="padding: 8px; text-transform: capitalize;">${appointment.source || "N/A"}</td></tr>
      </table>
      <hr style="border: none; border-top: 1px solid #eee; margin-top: 24px;">
      <p style="text-align: center; color: #999; font-size: 12px;">Ujjwal Dental Clinic — Admin Notification</p>
    </div>
  `;
  const text = `New appointment booked. Patient: ${patient.name}, Phone: ${patient.phone}, Date: ${apptDate}, Time: ${appointment.timeSlot}, Appt#: ${appointment.appointmentNumber}, Token: ${appointment.tokenNumber}, Reason: ${appointment.reason || "N/A"}.`;

  return sendEmail({ to, subject, text, html });
};

export const sendPatientBookingConfirmation = async (appointment) => {
  const patient = appointment.patient || {};
  if (!patient.email) return { success: false, error: "No patient email" };

  const clinic = appointment.clinic || {};
  const apptDate = appointment.date
    ? new Date(appointment.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "N/A";
  const addr = clinic.address
    ? [clinic.address.street, clinic.address.area, clinic.address.city]
        .filter(Boolean)
        .join(", ")
    : "";
  const isMembership = appointment.isFree === true;

  const subject = `Appointment Confirmed — Ujjwal Dental Clinic`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1976d2; text-align: center;">Ujjwal Dental Clinic</h2>
      <p>Hello ${patient.name || "Patient"},</p>
      <p>Your appointment has been <strong style="color: #4caf50;">confirmed</strong>!</p>
      ${
        isMembership
          ? `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px;">
               <p style="margin: 0; color: #065f46; font-size: 13px;">✓ OPD fee waived — Membership benefit applied</p>
             </div>`
          : ""
      }
      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 6px 0;"><strong>Token #:</strong> ${appointment.tokenNumber || "N/A"}</p>
        <p style="margin: 6px 0;"><strong>Appointment #:</strong> ${appointment.appointmentNumber || "N/A"}</p>
        <p style="margin: 6px 0;"><strong>Date:</strong> ${apptDate}</p>
        <p style="margin: 6px 0;"><strong>Time:</strong> ${appointment.timeSlot || "N/A"}</p>
        <p style="margin: 6px 0;"><strong>Clinic:</strong> ${clinic.name || "Ujjwal Dental Clinic"}${addr ? ` — ${addr}` : ""}</p>
        ${clinic.phone ? `<p style="margin: 6px 0;"><strong>Clinic Phone:</strong> ${clinic.phone}</p>` : ""}
      </div>
      <p>Please arrive 10 minutes before your scheduled time.</p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="text-align: center; color: #666; font-size: 12px;">Ujjwal Dental Clinic | Patient Portal</p>
    </div>
  `;
  const text = `Hello ${patient.name}, your appointment is confirmed. Token: ${appointment.tokenNumber}, Appt#: ${appointment.appointmentNumber}, Date: ${apptDate}, Time: ${appointment.timeSlot}, Clinic: ${clinic.name || "Ujjwal Dental Clinic"}${addr ? ` (${addr})` : ""}. Please arrive 10 minutes early.`;

  return sendEmail({ to: patient.email, subject, text, html });
};

export default { sendEmail, sendOtpEmail };
