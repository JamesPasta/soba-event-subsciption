import type { ClaimedJob } from '../../core/db/repos/jobRepo';
import type { PostSubmissionActionNotifications } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { getSystemUser } from '../../core/services/systemUser';
import { jobNotifications } from '../notifications/jobNotifications';

const systemUserId = async (): Promise<string> => {
  const systemUser = await getSystemUser();
  if (!systemUser) throw new Error('The system user is missing');
  return systemUser.id;
};

/**
 * The notification service for one action job. Sends are attributed to the system user, since the
 * submitter chose neither the recipients nor the text.
 */
export const actionNotifications = (job: ClaimedJob): PostSubmissionActionNotifications =>
  jobNotifications(job, systemUserId);
