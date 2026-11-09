'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { InlineAlert } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';
import { isUuid } from '@/src/shared/util/uuid';
import type { JobScopeRef, StaffJobActor, StaffJobDetail } from '@/src/types/jobs';
import { useScopedJob, useScopedJobWriter } from '../data/useScopedJobs';
import { Fact, JobFacts, JobView } from './JobView';

type StaffJobFactsProps = Readonly<{
  job: StaffJobDetail;
  scope: JobScopeRef;
  jobHref: (jobId: string) => string;
  submissionHref?: (submissionId: string) => string;
}>;

function StaffJobFacts({ job, scope, jobHref, submissionHref }: StaffJobFactsProps) {
  const dict = useDictionary();
  const facts = dict.jobs.detail.facts;
  const unknown = dict.general.unknown;
  // Someone outside the workspace who acted on its job is not named, only said where they stand.
  const who = (actor: StaffJobActor) => {
    if (actor.standing === 'platformAdministrator') return dict.jobs.platformAdministrator;
    if (actor.standing === 'formerMember') return dict.jobs.formerMember;
    return actor.displayLabel ?? unknown;
  };
  const code = job.confirmationCode ?? '—';

  return (
    <JobFacts
      job={job}
      jobHref={jobHref}
      createdBy={job.createdBy.displayLabel ?? unknown}
      rerunBy={job.lastRequeuedBy ? who(job.lastRequeuedBy) : unknown}
      stopBy={job.cancelRequestedBy ? who(job.cancelRequestedBy) : null}
      scopeFacts={
        <>
          {scope.kind === 'workspace' ? (
            <Fact name={facts.form} testId="form">
              {job.formName ?? unknown}
            </Fact>
          ) : null}
          <Fact name={facts.submission} testId="submission">
            {job.submissionId && submissionHref ? (
              <Link href={submissionHref(job.submissionId)} data-testid="job-submission-link">
                {code}
              </Link>
            ) : (
              code
            )}
          </Fact>
        </>
      }
    />
  );
}

type ScopedJobDetailPanelProps = Readonly<{
  scope: JobScopeRef;
  jobId: string;
  /** The jobs list, as the reader left it. */
  backHref: string;
  jobHref: (jobId: string) => string;
  /** The submission's page, when the reader may open it. */
  submissionHref?: (submissionId: string) => string;
}>;

/** One job a form's or a workspace's submission started: its facts, Run again or Stop. */
export function ScopedJobDetailPanel({
  scope,
  jobId,
  backHref,
  jobHref,
  submissionHref,
}: ScopedJobDetailPanelProps) {
  const dict = useDictionary();
  const dictDetail = dict.jobs.detail;
  const authDefaults = useAuthErrorDefaults();
  const knownId = isUuid(jobId);
  const { data: job, error, refresh } = useScopedJob(scope, knownId ? jobId : null);
  const { rerun, stop } = useScopedJobWriter(scope);
  const messages = useMemo(
    () => ({ ...authDefaults, notFound: dictDetail.notFound, failed: dictDetail.loadError }),
    [authDefaults, dictDetail.notFound, dictDetail.loadError],
  );

  const back = (
    <p>
      <Link href={backHref} data-testid="job-back">
        {dictDetail.back}
      </Link>
    </p>
  );

  // A failed background read keeps the job already on screen.
  if (job) {
    return (
      <JobView
        job={job}
        refreshFailed={error !== null}
        refresh={refresh}
        back={back}
        facts={
          <StaffJobFacts
            job={job}
            scope={scope}
            jobHref={jobHref}
            submissionHref={submissionHref}
          />
        }
        rerun={rerun}
        stop={stop}
      />
    );
  }
  // Finished jobs are deleted under retention, so a job that is gone is expected, not a failure.
  if (!knownId || error?.kind === 'notFound') {
    return (
      <div>
        {back}
        <InlineAlert
          title={dictDetail.heading}
          description={dictDetail.notFound}
          variant="info"
          data-testid="job-not-found"
        />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {back}
        <LoadErrorAlert
          error={error}
          messages={messages}
          testIds={{
            sessionExpired: 'job-session-expired',
            forbidden: 'job-noaccess',
            failed: 'job-load-error',
          }}
        />
      </div>
    );
  }
  return <CenteredProgress label={dict.general.loading} />;
}
