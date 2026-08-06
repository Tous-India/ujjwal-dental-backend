import { Router } from 'express';
import * as treatmentController from './treatment.controller.js';
import authProtect from '../../middlewares/auth.middleware.js';
import { checkPermission } from '../../middlewares/permission.middleware.js';

const router = Router();

/**
 * TREATMENT ROUTES
 * Base path: /api/treatments
 *
 * Two types of data:
 * 1. Treatment Master - Catalog of available treatments (15 treatments)
 * 2. Treatment Instance - Actual treatment given to a patient
 *
 * Access (consumed only by the admin app; patients read their own treatments
 * via the guarded /patients/:id/treatments route):
 *   - Master reads: authenticated staff/admin
 *   - Master writes (catalog config): admin only
 *   - Instances (patient medical data): authenticated staff/admin
 */

// ========== TREATMENT MASTER (Catalog) ==========

// Get all treatment types (catalog) — staff/admin
router.get('/master', authProtect, treatmentController.getAllTreatmentTypes);

// Get single treatment type — staff/admin
router.get('/master/:id', authProtect, treatmentController.getTreatmentTypeById);

// Create new treatment type — admin / clinic manager
// NOTE: master catalog routes use the separate "treatment_catalog" module,
// not "treatments" -- the catalog (price list config) is gated to
// admin/clinic_manager, while "treatments" covers ungated day-to-day patient
// treatment work below. See permission.constants.js for why these are split.
router.post('/master', authProtect, checkPermission("treatment_catalog", "create"), treatmentController.createTreatmentType);

// Update treatment type — admin / clinic manager
router.patch('/master/:id', authProtect, checkPermission("treatment_catalog", "edit"), treatmentController.updateTreatmentType);

// Delete (deactivate) treatment type — admin / clinic manager
router.delete('/master/:id', authProtect, checkPermission("treatment_catalog", "delete"), treatmentController.deleteTreatmentType);

// ========== TREATMENT INSTANCES (Patient Treatments) ==========

// Get all treatment instances — staff/admin
router.get('/', authProtect, treatmentController.getAllTreatments);

// Get single treatment instance — staff/admin
router.get('/:id', authProtect, treatmentController.getTreatmentById);

// Add treatment to appointment — staff/admin
router.post('/', authProtect, checkPermission('treatments', 'create'), treatmentController.createTreatment);

// Update treatment instance — staff/admin
router.patch('/:id', authProtect, checkPermission('treatments', 'edit'), treatmentController.updateTreatment);

// Update treatment status — staff/admin
router.patch('/:id/status', authProtect, checkPermission('treatments', 'edit'), treatmentController.updateTreatmentStatus);

// Add session to treatment (for multi-session treatments) — staff/admin
router.post('/:id/sessions', authProtect, checkPermission('treatments', 'edit'), treatmentController.addSession);

// Schedule follow-up for treatment — staff/admin
router.post('/:id/follow-up', authProtect, checkPermission('treatments', 'edit'), treatmentController.scheduleFollowUp);

export default router;
