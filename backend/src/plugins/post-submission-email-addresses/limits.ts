import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type { PostSubmissionActionSendScope } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';

/** Sends allowed in an hour, per form, per workspace and for the whole environment. */
export type HourlyLimits = Record<PostSubmissionActionSendScope, number>;

const DEFAULTS: HourlyLimits = { form: 500, workspace: 2000, environment: 5000 };

// A limit below one full list would cancel every list of 100 addresses.
const MIN_LIMIT = 100;
const MAX_LIMIT = 1_000_000;

const KEYS: Record<PostSubmissionActionSendScope, string> = {
  form: 'FORM_HOURLY_LIMIT',
  workspace: 'WORKSPACE_HOURLY_LIMIT',
  environment: 'ENVIRONMENT_HOURLY_LIMIT',
};

const ENV_PREFIX = 'PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_';

/** The limits from PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_*; a value out of range is refused. */
export const readHourlyLimits = (config: PluginConfigReader): HourlyLimits => {
  const read = (scope: PostSubmissionActionSendScope): number => {
    const raw = config.getOptional(KEYS[scope]);
    const value = raw === undefined || raw.trim() === '' ? DEFAULTS[scope] : Number(raw);
    if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
      throw new Error(
        `${ENV_PREFIX}${KEYS[scope]} must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}`,
      );
    }
    return value;
  };
  return { form: read('form'), workspace: read('workspace'), environment: read('environment') };
};

/** The first limit that sending `toSend` more would pass, with what was already sent; or null. */
export const exceededLimit = (
  sent: Record<PostSubmissionActionSendScope, number>,
  toSend: number,
  limits: HourlyLimits,
): { scope: PostSubmissionActionSendScope; sent: number; limit: number } | null => {
  for (const scope of ['form', 'workspace', 'environment'] as const) {
    if (sent[scope] + toSend > limits[scope]) {
      return { scope, sent: sent[scope], limit: limits[scope] };
    }
  }
  return null;
};
