import { db } from '../../core/db/client';
import { Features } from '../../core/db/codes';
import type { ClaimedJob } from '../../core/db/repos/jobRepo';
import type {
  PostSubmissionActionPluginDefinition,
  PostSubmissionActionSubmission,
} from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { getEnabledPostSubmissionActionCodes } from '../../core/integrations/post-submission-action/PostSubmissionActionRegistry';
import { getPostSubmissionActionPluginDefinitions } from '../../core/integrations/plugins/PluginRegistry';
import type { JobTypeDefinition } from '../../core/jobs/registry';
import { JobCancelledError } from '../../core/jobs/settlement';
import { log } from '../../core/logging';
import { isFeatureAvailable } from '../../core/services/featureAvailabilityService';
import { actionNotifications } from './notifications';
import { ActionJobParamsSchema } from './params';
import { findActionSettingRows, findLiveSubmission } from './repo';
import { actionFeatureAvailable, isWorkspaceConfigurable } from './resolve';
import { effectiveAction, formActionScopes, rowsFor } from './rules';

const GONE = 'The submission, its form or its workspace is gone';

/** What an action job checks before it runs. */
export interface ActionRunFacts {
  postSubmissionAvailable: boolean;
  enabledHere: boolean;
  featureAvailable: boolean;
  live: boolean;
  stillEnabled: boolean;
}

/** Why an action job should end cancelled instead of running; null to run it. */
export const cancelReason = (facts: ActionRunFacts): string | null => {
  if (!facts.postSubmissionAvailable) return 'Post-submission is not available for the form';
  if (!facts.enabledHere) return 'The action is not enabled in this environment';
  if (!facts.featureAvailable) return "The action's feature is not available for the form";
  if (!facts.live) return GONE;
  if (!facts.stillEnabled) return 'The action was turned off';
  return null;
};

const runFacts = async (
  plugin: PostSubmissionActionPluginDefinition,
  job: ClaimedJob,
): Promise<{ facts: ActionRunFacts; submission: PostSubmissionActionSubmission | null }> => {
  const scope = { workspaceId: job.workspaceId, formId: job.formId ?? undefined };
  const [postSubmissionAvailable, featureAvailable, workspaceConfigurable, submission, rows] =
    await Promise.all([
      isFeatureAvailable(Features.post_submission, scope),
      actionFeatureAvailable(plugin, scope),
      isWorkspaceConfigurable(plugin, job.workspaceId),
      job.submissionId === null
        ? Promise.resolve(null)
        : findLiveSubmission(db, { workspaceId: job.workspaceId, submissionId: job.submissionId }),
      job.formId === null
        ? Promise.resolve([])
        : findActionSettingRows(db, job.workspaceId, job.formId),
    ]);
  const { workspaceRow, formRow } = rowsFor(rows, plugin.code);
  const scopes = formActionScopes(plugin.scopes, workspaceConfigurable);
  return {
    facts: {
      postSubmissionAvailable,
      enabledHere: getEnabledPostSubmissionActionCodes().includes(plugin.code),
      featureAvailable,
      live: submission !== null,
      stillEnabled: effectiveAction(workspaceRow, formRow, scopes).values.enabled,
    },
    submission,
  };
};

/**
 * The job type for one action plugin. Before the plugin runs, the job ends cancelled if the
 * feature or the action was turned off, or the submission is gone; that is how a queued action is
 * stopped. The options are the ones recorded when the submission was received.
 */
export const actionJobDefinition = (
  plugin: PostSubmissionActionPluginDefinition,
): JobTypeDefinition => ({
  type: plugin.code,
  pool: plugin.job.pool,
  maxAttempts: plugin.job.maxAttempts,
  timeoutMs: plugin.job.timeoutMs,
  run: async ({ job, signal, log }) => {
    const { facts, submission } = await runFacts(plugin, job);
    const reason = cancelReason(facts);
    if (reason || submission === null) throw new JobCancelledError(reason ?? GONE);
    const params = ActionJobParamsSchema.parse(job.params);
    const options = plugin.optionsSchema.parse(params.options);
    await plugin.job.run({
      job,
      options,
      source: params.source,
      submission,
      services: { notifications: actionNotifications(job) },
      signal,
      log,
    });
  },
});

/**
 * One job type per installed action plugin; the start check cancels those not enabled here. Warns
 * once about enabled codes with no plugin; those never run.
 */
export const postSubmissionActionJobs = (): JobTypeDefinition[] => {
  const installed = getPostSubmissionActionPluginDefinitions();
  const notInstalled = getEnabledPostSubmissionActionCodes().filter(
    (code) => !installed.some((plugin) => plugin.code === code),
  );
  if (notInstalled.length > 0) {
    log.warn({ codes: notInstalled }, 'POST_SUBMISSION_ACTION_PLUGINS names plugins not installed');
  }
  return installed.map(actionJobDefinition);
};
