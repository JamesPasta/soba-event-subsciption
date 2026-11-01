import { getStorageAdapter } from '../integrations/plugins/PluginRegistry';
import { log } from '../logging';
import { getJobRegistry } from './catalog';
import { JobRunner } from './runner';
import { getJobSettings } from './settings';
import { JobSweeper } from './sweeper';

export { assertJobShutdownFits, getJobSettings } from './settings';

let runner: JobRunner | undefined;
let sweeper: JobSweeper | undefined;

/**
 * Start the runner and sweeper in this process. Call outside any request. Throws when the results
 * storage profile is not configured, rather than at the end of the first job that stores a file.
 */
export const startJobs = (): void => {
  if (runner) return;
  const settings = getJobSettings();
  getStorageAdapter(settings.resultsStorageProfile);
  runner = new JobRunner(getJobRegistry(), settings, log.child({ component: 'job-runner' }));
  sweeper = new JobSweeper(settings, log.child({ component: 'job-sweeper' }));
  runner.start();
  sweeper.start();
};

/** Stop claiming and sweeping. Resolves once running jobs finish, are released, or are left. */
export const stopJobs = async (): Promise<void> => {
  await Promise.all([runner?.stop(), sweeper?.stop()]);
};

/** Claim queued jobs of `type` now, when this process runs its pool. */
export const nudgeJobs = (type: string): void => {
  if (!runner) return;
  const definition = getJobRegistry().get(type);
  if (definition) runner.nudge(definition.pool);
};
