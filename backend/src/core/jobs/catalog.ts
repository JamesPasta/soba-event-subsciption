import { postSubmissionActionJobs } from '../../features/post-submission/actionJob';
import { fanOutSubmitted } from '../../features/post-submission/fanOut';
import { submissionExportJob } from '../../features/submission-export/job';
import { runStatusEmailJob } from '../../features/submission-review/statusEmailJob';
import { JobRegistry } from './registry';
import { submissionStatusEmailJob } from './submissionStatusEmail';
import { submissionSubmittedJob } from './submissionSubmitted';

let registry: JobRegistry | undefined;

/**
 * Every job type this backend runs: the submitted fan-out, submission export, review status emails,
 * and one type per installed action plugin. Built on first use, so plugins load when jobs start
 * rather than when a module imports this.
 */
export const getJobRegistry = (): JobRegistry => {
  if (!registry) {
    const built = new JobRegistry()
      .register({ ...submissionSubmittedJob, run: fanOutSubmitted })
      .register(submissionExportJob)
      .register({ ...submissionStatusEmailJob, run: runStatusEmailJob });
    for (const job of postSubmissionActionJobs()) built.register(job);
    registry = built;
  }
  return registry;
};
