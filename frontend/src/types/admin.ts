/** Platform-administration payloads served by the backend `/admin/*` routes. */
import type { FeatureScopeItem } from '@soba/lib';
import type { JobStatus } from './jobs';
import type { ListQueryArgs } from './list';

export type {
  SobaAdminItem,
  ListSobaAdminsResponse as SobaAdminsResponse,
  AddSobaAdminBody,
  FeatureScopeItem,
  ListFeatureScopesResponse as FeatureScopesResponse,
  UpsertFeatureScopeBody,
  DocumentGenerationAuditItem,
  ListDocumentGenerationAuditsResponse as DocumentGenerationAuditsResponse,
  JobListItem,
  ListJobsResponse as JobsResponse,
  JobDetail,
  JobSummary,
  JobEmailCounts,
  JobTypeItem,
  ListJobTypesResponse as JobTypesResponse,
} from '@soba/lib';

export type { JobStatus };

/** The filters the jobs list sends; ids are sent only once they are uuids. */
export type JobFilters = {
  status?: JobStatus;
  type?: string;
  workspaceId?: string;
  formId?: string;
  submissionId?: string;
};

export type JobsQuery = ListQueryArgs & JobFilters;

export type FeatureScopeType = FeatureScopeItem['scopeType'];

export type FeatureScopeStatus = FeatureScopeItem['status'];

export type DocumentGenerationAuditsQuery = ListQueryArgs & {
  workspaceId?: string;
  formId?: string;
};
