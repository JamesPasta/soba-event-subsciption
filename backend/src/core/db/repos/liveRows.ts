import { and, isNull } from 'drizzle-orm';
import { formVersions, forms, submissions } from '../schema';

/** The form is not deleted. */
export const liveForm = isNull(forms.deletedAt);

/** Neither the form version nor its form is deleted. Expects `forms` joined. */
export const liveFormVersion = and(isNull(formVersions.deletedAt), liveForm);

/** Neither the submission, its form nor its form version is deleted. Expects `forms` and `formVersions` joined. */
export const liveSubmission = and(isNull(submissions.deletedAt), liveFormVersion);
