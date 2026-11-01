import { postSubmissionActionJobs } from '../../features/post-submission/actionJob';
import { fanOutSubmitted } from '../../features/post-submission/fanOut';
import { submissionExportJob } from '../../features/submission-export/job';
import { JobRegistry } from './registry';
import { submissionSubmittedJob } from './submissionSubmitted';

let registry: JobRegistry | undefined;

/**
 * Every job type this backend runs: the submitted fan-out, submission export, and one type per
 * installed action plugin. Built on first use, so plugins load when jobs start rather than when a
 * module imports this.
 */
export const getJobRegistry = (): JobRegistry => {
  if (!registry) {
    const built = new JobRegistry()
      .register({ ...submissionSubmittedJob, run: fanOutSubmitted })
      .register(submissionExportJob);
    for (const job of postSubmissionActionJobs()) built.register(job);
    registry = built;
  }
  return registry;
};
