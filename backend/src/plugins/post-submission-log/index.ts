import { PostSubmissionLogOptionsSchema, type PostSubmissionLogOptions } from '@soba/lib';
import { JobPool } from '../../core/config/env';
import type { PostSubmissionActionPluginDefinition } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';

const CODE = 'post-submission-log';

/**
 * Logs that it ran, with the settings row it ran from and the names of its options, never their
 * values. Does nothing else; it is there to exercise the post-submission path.
 */
export const postSubmissionActionPluginDefinition: PostSubmissionActionPluginDefinition<PostSubmissionLogOptions> =
  {
    code: CODE,
    metadata: {
      code: CODE,
      name: 'Log',
      description: 'Logs that the action ran, and nothing else',
    },
    scopes: ['workspace', 'form'],
    optionsSchema: PostSubmissionLogOptionsSchema,
    job: {
      pool: JobPool.light,
      run: ({ job, options, source, log }) => {
        log.info(
          {
            submissionId: job.submissionId,
            revisionId: job.revisionId,
            source,
            optionKeys: Object.keys(options),
          },
          'Post-submission log action ran',
        );
        return Promise.resolve();
      },
    },
  };
