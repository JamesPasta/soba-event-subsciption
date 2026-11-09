import {
  PostSubmissionEmailAddressesOptionsSchema,
  type PostSubmissionEmailAddressesOptions,
} from '@soba/lib';
import { env, JobPool } from '../../core/config/env';
import { createPluginConfigReader } from '../../core/config/pluginConfig';
import { Features } from '../../core/db/codes';
import type { PostSubmissionActionPluginDefinition } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { readHourlyLimits } from './limits';
import { designerLink } from './notice';
import { sendNotices } from './send';

const CODE = 'post-submission-email-addresses';

// Read when the plugin loads; a limit out of range keeps it from loading, with a warning.
const limits = readHourlyLimits(createPluginConfigReader(CODE));

/** Emails a fixed notice to a list of addresses when a form receives a submission. */
export const postSubmissionActionPluginDefinition: PostSubmissionActionPluginDefinition<PostSubmissionEmailAddressesOptions> =
  {
    code: CODE,
    metadata: {
      code: CODE,
      name: 'Email a list of addresses',
      description: 'Emails a notice to a list of addresses when the form receives a submission',
    },
    featureCode: Features.post_submission_email,
    scopes: ['workspace', 'form'],
    optionsSchema: PostSubmissionEmailAddressesOptionsSchema,
    job: {
      pool: JobPool.light,
      // About an hour of retries at the default backoff, to ride out a provider outage.
      maxAttempts: 8,
      timeoutMs: 300_000,
      run: (context) =>
        sendNotices(context, limits, designerLink(env.getDesignerAppUrl(), context.submission)),
    },
  };
