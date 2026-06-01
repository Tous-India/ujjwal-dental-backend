import { Router } from 'express';
import * as patientController from './patient.controller.js';
import authProtect, { anyAuth, patientSelfOrAdmin } from '../../middlewares/auth.middleware.js';

const router = Router();

/**
 * PATIENT ROUTES
 * Base path: /api/patients
 * Access:
 *   - Admin/staff only:        list, search, create, delete, and admin-only
 *                              sub-resource views (appointments, reports, tests)
 *   - Admin OR patient-self:   a patient's own record and the sub-resources the
 *                              portal reads (profile, treatments, payments,
 *                              membership) — guarded by anyAuth + patientSelfOrAdmin
 */

// Get all patients (with pagination & search) — admin/staff
router.get('/', authProtect, patientController.getAllPatients);

// Search patients by name or phone — admin/staff
router.get('/search', authProtect, patientController.searchPatients);

// Get single patient by ID — admin/staff OR the patient themselves
router.get('/:id', anyAuth, patientSelfOrAdmin, patientController.getPatientById);

// Create new patient — admin/staff
router.post('/', authProtect, patientController.createPatient);

// Update patient — admin/staff OR the patient themselves (own profile)
router.patch('/:id', anyAuth, patientSelfOrAdmin, patientController.updatePatient);

// Delete (deactivate) patient — admin/staff
router.delete('/:id', authProtect, patientController.deletePatient);

// Get patient's appointments — admin/staff
router.get('/:id/appointments', authProtect, patientController.getPatientAppointments);

// Get patient's treatments — admin/staff OR the patient themselves
router.get('/:id/treatments', anyAuth, patientSelfOrAdmin, patientController.getPatientTreatments);

// Get patient's payments — admin/staff OR the patient themselves
router.get('/:id/payments', anyAuth, patientSelfOrAdmin, patientController.getPatientPayments);

// Get patient's reports — admin/staff
router.get('/:id/reports', authProtect, patientController.getPatientReports);

// Get patient's tests — admin/staff
router.get('/:id/tests', authProtect, patientController.getPatientTests);

// Get patient's membership details — admin/staff OR the patient themselves
router.get('/:id/membership', anyAuth, patientSelfOrAdmin, patientController.getPatientMembership);

export default router;
