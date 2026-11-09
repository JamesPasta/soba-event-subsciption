import { v7 as uuidv7 } from 'uuid';
import { SubmissionService } from '../../core/services/submissionService';
import { mapInOrder } from '../../core/inOrder';

const submissionService = new SubmissionService();

/**
 * Opens a submission, then saves and submits in order, each write based on the revision the one
 * before produced. Returns the submission id.
 */
export async function seedSubmission(input: {
  workspaceId: string;
  formId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  data: Record<string, unknown>;
  events: ReadonlyArray<'saved' | 'submitted'>;
}): Promise<string> {
  const { formId, data, events, ...context } = input;
  const { record } = await submissionService.open({ id: uuidv7(), formId, ...context });
  if (!record.headRevisionId) throw new Error(`Submission ${record.id} has no head revision`);

  let baseRevisionId = record.headRevisionId;
  await mapInOrder(events, async (event) => {
    const write = {
      ...context,
      submissionId: record.id,
      data,
      revisionId: uuidv7(),
      baseRevisionId,
    };
    const { revision } = await (event === 'saved'
      ? submissionService.save(write)
      : submissionService.submit(write));
    baseRevisionId = revision.id;
  });
  return record.id;
}
