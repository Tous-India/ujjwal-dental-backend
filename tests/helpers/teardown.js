/**
 * Shared test teardown helpers.
 *
 * Invoice cleanup always runs before patient/appointment cleanup so that
 * referential integrity checks in the app (invoice.patient, etc.) can't
 * be tripped by partially-torn-down state inside a single test run.
 */
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

/**
 * Delete all invoices, payments, and appointments that belong to a patient.
 * Does NOT delete the patient document itself.
 */
export async function cleanupPatientRecords(patientId) {
  await Invoice.deleteMany({ patient: patientId });
  await Payment.deleteMany({ patient: patientId });
  await Appointment.deleteMany({ patient: patientId });
}

/**
 * Delete all records for a patient and then the patient document itself.
 */
export async function cleanupPatient(patientId) {
  await cleanupPatientRecords(patientId);
  await Patient.findByIdAndDelete(patientId);
}
