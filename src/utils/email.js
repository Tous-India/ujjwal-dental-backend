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

export default { sendEmail, sendOtpEmail };
