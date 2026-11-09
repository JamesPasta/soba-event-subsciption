'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { InlineAlert } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { ListPageAuthGate } from '@/src/components/ListPageLayout';
import { SecondaryText } from '@/src/components/SecondaryText';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { Fact, JobFacts, JobView } from '@/src/features/jobs/ui/JobView';
import { JOBS_LIST_QUERY, listLink, navLink } from '@/src/shared/list/listQueryMemory';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { isUuid } from '@/src/shared/util/uuid';
import type { JobDetail, JobTypeItem } from '@/src/types/admin';
import { useJob, useJobTypes, useJobWriter } from '../data/useAdminData';
import { useIsSobaAdmin } from '../useIsSobaAdmin';

type AdminJobFactsProps = Readonly<{
  job: JobDetail;
  locale: string;
  types: readonly JobTypeItem[];
}>;

/** Every fact, ids included, with links to the jobs list filtered by the job's form or submission. */
function AdminJobFacts({ job, locale, types }: AdminJobFactsProps) {
  const dict = useDictionary();
  const dictAdmin = dict.admin.jobs;
  const facts = dict.jobs.detail.facts;
  const jobsLink = (params: Record<string, string>) =>
    listLink(`/${locale}/admin/jobs`, JOBS_LIST_QUERY, params);
  const unknown = dict.general.unknown;

  return (
    <JobFacts
      job={job}
      types={types}
      jobHref={(id) => `/${locale}/admin/jobs/${id}`}
      createdBy={job.createdBy.displayLabel ?? unknown}
      rerunBy={job.lastRequeuedBy?.displayLabel ?? unknown}
      stopBy={job.cancelRequestedBy ? (job.cancelRequestedBy.displayLabel ?? unknown) : null}
      scopeFacts={
        <>
          <Fact name={dictAdmin.detail.facts.workspace} testId="workspace">
            <span className="d-inline-flex flex-column">
              <span>{job.workspaceName}</span>
              <SecondaryText>{job.workspaceId}</SecondaryText>
            </span>
          </Fact>
          <Fact name={facts.form} testId="form">
            {job.formId ? (
              <span className="d-inline-flex flex-column">
                <span>{job.formName ?? unknown}</span>
                <SecondaryText>{job.formId}</SecondaryText>
                <Link href={jobsLink({ formId: job.formId })} data-testid="job-form-jobs">
                  {dictAdmin.detail.formJobs}
                </Link>
              </span>
            ) : (
              '—'
            )}
          </Fact>
          <Fact name={facts.submission} testId="submission">
            {job.submissionId ? (
              <span className="d-inline-flex flex-column">
                <SecondaryText>{job.submissionId}</SecondaryText>
                <Link
                  href={jobsLink({ submissionId: job.submissionId })}
                  data-testid="job-submission-jobs"
                >
                  {dictAdmin.detail.submissionJobs}
                </Link>
              </span>
            ) : (
              '—'
            )}
          </Fact>
          <Fact name={dictAdmin.detail.facts.revision} testId="revision">
            {job.revisionId ? <SecondaryText>{job.revisionId}</SecondaryText> : '—'}
          </Fact>
        </>
      }
      extraFacts={
        <Fact name={dictAdmin.detail.facts.options} testId="options">
          {job.optionNames.length > 0 ? job.optionNames.join(', ') : dict.jobs.detail.none}
        </Fact>
      }
    />
  );
}

/** One background job for platform administrators: its facts, its related jobs, and Run again or Stop. */
export function JobDetailPanel({ jobId }: Readonly<{ jobId: string }>) {
  const dict = useDictionary();
  const dictDetail = dict.jobs.detail;
  const { authenticated } = useKeycloak();
  const { isSobaAdmin, initializing } = useIsSobaAdmin();
  const locale = getLocaleFromPath(usePathname());

  const types = useJobTypes(isSobaAdmin);
  const knownId = isUuid(jobId);
  const { data: job, isLoading, error, refresh } = useJob(isSobaAdmin && knownId ? jobId : null);
  const { rerun, stop } = useJobWriter();

  if (initializing) {
    return <CenteredProgress label={dict.general.loading} />;
  }
  if (!authenticated) {
    return <ListPageAuthGate>{dict.general.notAuthenticated}</ListPageAuthGate>;
  }
  if (!isSobaAdmin) {
    return <ListPageAuthGate>{dict.admin.forbidden}</ListPageAuthGate>;
  }
  if (isLoading) {
    return <CenteredProgress label={dict.general.loading} />;
  }

  const back = (
    <p>
      <Link href={navLink(`/${locale}/admin/jobs`)} data-testid="job-back">
        {dictDetail.back}
      </Link>
    </p>
  );

  if (!job) {
    const notFound = !knownId || error?.kind === 'notFound';
    return (
      <div>
        {back}
        <InlineAlert
          title={dictDetail.heading}
          description={notFound ? dictDetail.notFound : dictDetail.loadError}
          variant={notFound ? 'info' : 'warning'}
          data-testid="job-load-error"
        />
      </div>
    );
  }

  return (
    <JobView
      job={job}
      refreshFailed={error !== null}
      refresh={refresh}
      back={back}
      facts={<AdminJobFacts job={job} locale={locale} types={types} />}
      rerun={rerun}
      stop={stop}
    />
  );
}

export default JobDetailPanel;
