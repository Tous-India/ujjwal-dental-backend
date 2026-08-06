import { checkPermission, checkPermissionIfStaff } from '../../middlewares/permission.middleware.js';
import { Router } from 'express';
import * as patientController from './patient.controller.js';
import authProtect, { anyAuth, patientSelfOrAdmin } from '../../middlewares/auth.middleware.js';
import * as authController from '../auth/auth.controller.js';
import { authLimiter } from '../../middlewares/rateLimit.middleware.js';

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

// ---- PUBLIC: WhatsApp OTP login for the patient portal ----
// Registered BEFORE '/:id' (and before the authProtect'd routes) so "auth" is
// never parsed as a patient id, and so these stay unauthenticated by design.
// Rate limiting is enforced per-phone inside the controller, on top of the
// app-wide limiter.
router.post('/auth/request-otp', authLimiter, authController.requestPatientLoginOtp);
router.post('/auth/verify-otp', authLimiter, authController.verifyPatientLoginOtp);

// Get all patients (with pagination & search) — admin/staff
router.get('/', authProtect, patientController.getAllPatients);

// Search patients by name or phone — admin/staff
router.get('/search', authProtect, patientController.searchPatients);

// Export patients as CSV/PDF (?format=csv|pdf), respecting the same search/
// isActive/membership filters as the list — admin/staff. Must stay above
// '/:id' or Express would treat 'export' as a patient ID.
router.get('/export', authProtect, patientController.exportPatients);

// Get single patient by ID — admin/staff OR the patient themselves
router.get('/:id', anyAuth, patientSelfOrAdmin, patientController.getPatientById);

// Create new patient — admin/staff
router.post('/', authProtect, checkPermission('patients', 'create'), patientController.createPatient);

// Update patient — admin/staff OR the patient themselves (own profile)
router.patch('/:id', anyAuth, patientSelfOrAdmin, checkPermissionIfStaff('patients', 'edit'), patientController.updatePatient);

// Delete (deactivate) patient — admin/staff
router.delete('/:id', authProtect, checkPermission('patients', 'delete'), patientController.deletePatient);

// Reactivate (un-deactivate) patient — admin/staff
router.patch('/:id/reactivate', authProtect, checkPermission('patients', 'edit'), patientController.reactivatePatient);

// Admin: set or reset a patient's password (set new OR generate temp). Never views it.
router.patch('/:id/reset-password', authProtect, checkPermission('patients', 'edit'), patientController.resetPatientPassword);

// Get patient's appointments — admin/staff
router.get('/:id/appointments', authProtect, patientController.getPatientAppointments);

// Get patient's treatments — admin/staff OR the patient themselves
router.get('/:id/treatments', anyAuth, patientSelfOrAdmin, patientController.getPatientTreatments);

// Get patient's payments — admin/staff OR the patient themselves
router.get('/:id/payments', anyAuth, patientSelfOrAdmin, patientController.getPatientPayments);

// Get patient's invoices — admin/staff OR the patient themselves
router.get('/:id/invoices', anyAuth, patientSelfOrAdmin, patientController.getPatientInvoices);

// Get patient's reports — admin/staff
router.get('/:id/reports', authProtect, patientController.getPatientReports);

// Get patient's tests — admin/staff
router.get('/:id/tests', authProtect, patientController.getPatientTests);

// Get patient's membership details — admin/staff OR the patient themselves
router.get('/:id/membership', anyAuth, patientSelfOrAdmin, patientController.getPatientMembership);

// Get patient's active treatment plans with outstanding invoices (admin only)
router.get('/:id/active-context', authProtect, patientController.getPatientActiveContext);

export default router;
