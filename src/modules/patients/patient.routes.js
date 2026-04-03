import { Router } from 'express';
import * as patientController from './patient.controller.js';

const router = Router();

/**
 * PATIENT ROUTES
 * Base path: /api/patients
 * Access: Admin (full), Patient (own data only via portal)
 */

// Get all patients (with pagination & search)
router.get('/', patientController.getAllPatients);

// Search patients by name or phone
router.get('/search', patientController.searchPatients);

// Get single patient by ID
router.get('/:id', patientController.getPatientById);

// Create new patient
router.post('/', patientController.createPatient);

// Update patient
router.patch('/:id', patientController.updatePatient);

// Delete (deactivate) patient
router.delete('/:id', patientController.deletePatient);

// Get patient's appointments
router.get('/:id/appointments', patientController.getPatientAppointments);

// Get patient's treatments
router.get('/:id/treatments', patientController.getPatientTreatments);

// Get patient's payments
router.get('/:id/payments', patientController.getPatientPayments);

// Get patient's reports
router.get('/:id/reports', patientController.getPatientReports);

// Get patient's tests
router.get('/:id/tests', patientController.getPatientTests);

// Get patient's membership details
router.get('/:id/membership', patientController.getPatientMembership);

export default router;
