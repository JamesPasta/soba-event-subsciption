import express from 'express';
import { validateRequest } from '../shared/validation';
import { sortLocale } from '../../middleware/sortLocale';
import {
  loadSubmitterForm,
  loadSubmitterFormVersion,
  loadSubmitterSubmission,
  requireSignedInSubmitter,
  requireSubmissionDelete,
  requireSubmissionRead,
  requireSubmissionRevise,
  requireSubmissionStart,
  requireSubmissionWrite,
  requireVersionSchemaRead,
} from '../../middleware/formSubmitAccess';
import {
  getSubmitFillBundle,
  getSubmitForm,
  getSubmitFormVersionSchema,
  getSubmitSubmission,
  getSubmitSubmissionData,
  getSubmitSubmissionSchema,
  listMyForms,
  listMySubmissions,
  listMyWorkspaces,
  reviseOwnSubmission,
} from './controller';
import { requireDraftSave } from './draftSave';
import { replayRecordedOpen, replayRecordedSave, replayRecordedSubmit } from './replay';
import {
  openSubmission,
  saveSubmission,
  submitSubmission,
  deleteUnsubmittedSubmission,
} from '../submissions/controller';
import {
  OpenSubmissionBodySchema,
  SubmissionDataBodySchema,
  SubmissionIdParamsSchema,
  SubmitSubmissionBodySchema,
} from '../submissions/schema';
import {
  ListMyFormsQuerySchema,
  ListMySubmissionsQuerySchema,
  MyWorkspaceLookupQuerySchema,
  ReviseSubmissionBodySchema,
  SubmitFormIdParamsSchema,
  SubmitFormVersionIdParamsSchema,
} from './schema';

// Submit-mode: mounted under /api/v1/submit with optional auth (anonymous resolves to the public user).
// A route on one submission, form or form version reads it once, then one guard decides with the
// @soba/lib rules. A repeated open, save or submit gets its recorded answer before any guard. The
// caller's own lists need a signed-in caller.
const router = express.Router();

const submissionParams = validateRequest({ params: SubmissionIdParamsSchema });

router.post(
  '/submissions',
  validateRequest({ body: OpenSubmissionBodySchema }),
  replayRecordedOpen,
  loadSubmitterForm,
  requireSubmissionStart,
  openSubmission,
);
router.post(
  '/submissions/:id/save',
  validateRequest({ params: SubmissionIdParamsSchema, body: SubmissionDataBodySchema }),
  loadSubmitterSubmission,
  replayRecordedSave,
  requireSubmissionWrite,
  requireDraftSave,
  saveSubmission,
);
router.post(
  '/submissions/:id/submit',
  validateRequest({ params: SubmissionIdParamsSchema, body: SubmitSubmissionBodySchema }),
  loadSubmitterSubmission,
  replayRecordedSubmit,
  requireSubmissionWrite,
  submitSubmission,
);
// The owner sends their own submitted submission back to revise, when the form's review settings
// allow it. A retry under the same id is answered as made.
router.post(
  '/submissions/:id/revise',
  validateRequest({ params: SubmissionIdParamsSchema, body: ReviseSubmissionBodySchema }),
  loadSubmitterSubmission,
  requireSubmissionRevise,
  reviseOwnSubmission,
);

router.get(
  '/forms/mine',
  validateRequest({ query: ListMyFormsQuerySchema }),
  sortLocale,
  requireSignedInSubmitter,
  listMyForms,
);

// Registered after /forms/mine, which it would otherwise take as a form id. The form a caller may
// start, with its facts; refused as an open would be.
router.get(
  '/forms/:formId',
  validateRequest({ params: SubmitFormIdParamsSchema }),
  loadSubmitterForm,
  requireSubmissionStart,
  getSubmitForm,
);

// The published version's schema, to render a new submission before it is opened.
router.get(
  '/form-versions/:id/schema',
  validateRequest({ params: SubmitFormVersionIdParamsSchema }),
  loadSubmitterFormVersion,
  requireVersionSchemaRead,
  getSubmitFormVersionSchema,
);

router.get(
  '/workspaces/mine',
  validateRequest({ query: MyWorkspaceLookupQuerySchema }),
  sortLocale,
  requireSignedInSubmitter,
  listMyWorkspaces,
);

// Registered before /submissions/:id, which would otherwise take `mine` as an id.
router.get(
  '/submissions/mine',
  validateRequest({ query: ListMySubmissionsQuerySchema }),
  sortLocale,
  requireSignedInSubmitter,
  listMySubmissions,
);

router.get(
  '/submissions/:id',
  submissionParams,
  loadSubmitterSubmission,
  requireSubmissionRead,
  getSubmitSubmission,
);
router.get(
  '/submissions/:id/data',
  submissionParams,
  loadSubmitterSubmission,
  requireSubmissionRead,
  getSubmitSubmissionData,
);

// The submission's own form-version schema, for rendering its read-only confirmation.
router.get(
  '/submissions/:id/schema',
  submissionParams,
  loadSubmitterSubmission,
  requireSubmissionRead,
  getSubmitSubmissionSchema,
);

// The one bundle the fill page needs: workflow state, schema and any saved answers (resume), with the
// caller's role and the form's facts, from which the page decides writing and draft saves.
router.get(
  '/submissions/:id/fill',
  submissionParams,
  loadSubmitterSubmission,
  requireSubmissionRead,
  getSubmitFillBundle,
);

// The owner deletes their own submission before it is submitted.
router.delete(
  '/submissions/:id',
  submissionParams,
  loadSubmitterSubmission,
  requireSubmissionDelete,
  deleteUnsubmittedSubmission,
);

export { router as submitRouter };
