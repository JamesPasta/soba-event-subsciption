'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { Button } from '@bcgov/design-system-react-components';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { SecondaryText } from '@/src/components/SecondaryText';
import { StatusTag } from '@/src/components/StatusTag';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { isConflict } from '@/src/shared/api/dataError';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import { useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { formatFileSize } from '@/src/shared/util/fileSize';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import type {
  JobEmailCounts,
  JobResult,
  JobSummary,
  JobTypeItem,
  JobViewModel,
} from '@/src/types/jobs';
import {
  canRerunJob,
  isExportJob,
  isActiveJobStatus,
  jobStatusVariant,
  jobTypeLabel,
  queuedItsActions,
  type JobTypeLabel,
} from '../jobs';
import styles from './Jobs.module.css';

type JobAction = 'rerun' | 'stop';

type FactProps = Readonly<{ name: string; testId: string; children: ReactNode }>;

/** One fact on a job page, as a term and its description. */
export const Fact = ({ name, testId, children }: FactProps) => (
  <>
    <dt className="col-sm-4">{name}</dt>
    <dd className="col-sm-8" data-testid={`job-fact-${testId}`}>
      {children}
    </dd>
  </>
);

export const TypeLabel = ({ label }: Readonly<{ label: JobTypeLabel }>) => (
  <span lang={label.lang}>{label.text}</span>
);

/** The file a job produced: its name and size and how long it is kept, or when it expired. */
function ResultFacts({ result }: Readonly<{ result: JobResult }>) {
  const dict = useDictionary();
  const detail = dict.jobs.detail;
  const formatDateTime = useFormatLongDateTime();
  const locale = useSortLocale();
  const expires = formatDateTime(result.expiresAt);
  if (result.state === 'expired') return <>{fillTemplate(detail.resultExpired, { expires })}</>;
  return (
    <>
      {fillTemplate(detail.resultValue, {
        filename: result.filename ?? '—',
        size: result.size == null ? '—' : formatFileSize(result.size, locale),
        expires,
      })}
    </>
  );
}

type JobLinkProps = Readonly<{
  job: JobSummary;
  href: string;
  types: readonly JobTypeItem[];
}>;

function JobLink({ job, href, types }: JobLinkProps) {
  const dict = useDictionary();
  return (
    <div className="d-inline-flex align-items-center gap-2">
      <Link href={href} data-testid={`job-related-${job.id}`}>
        <TypeLabel label={jobTypeLabel(job.type, dict, types)} />
      </Link>
      <StatusTag label={dict.jobs.statuses[job.status]} variant={jobStatusVariant(job.status)} />
    </div>
  );
}

type JobFactsProps = Readonly<{
  job: JobViewModel;
  /** Where a related job's page is. */
  jobHref: (jobId: string) => string;
  types?: readonly JobTypeItem[];
  /** Where the job belongs, shown after its attempts. */
  scopeFacts?: ReactNode;
  /** Shown after its last error. */
  extraFacts?: ReactNode;
  createdBy: string;
  rerunBy: string;
  /** Null when no one is recorded as having asked. */
  stopBy: string | null;
}>;

/** What every reader of a job sees about it, with room for the facts only some readers see. */
export function JobFacts({
  job,
  jobHref,
  types = [],
  scopeFacts,
  extraFacts,
  createdBy,
  rerunBy,
  stopBy,
}: JobFactsProps) {
  const dict = useDictionary();
  const dictJobs = dict.jobs;
  const facts = dictJobs.detail.facts;
  const formatDateTime = useFormatLongDateTime();
  const when = (value: string | null) => (value ? formatDateTime(value) : '—');
  const by = (at: string, who: string) =>
    fillTemplate(dictJobs.detail.byValue, { at: formatDateTime(at), by: who });

  return (
    <dl className="row">
      <Fact name={facts.type} testId="type">
        <TypeLabel label={jobTypeLabel(job.type, dict, types)} />
      </Fact>
      <Fact name={facts.attempts} testId="attempts">
        {fillTemplate(dictJobs.attemptsValue, {
          attempts: String(job.attempts),
          max: String(job.maxAttempts),
        })}
      </Fact>
      {scopeFacts}
      <Fact name={facts.created} testId="created">
        {by(job.createdAt, createdBy)}
      </Fact>
      <Fact name={facts.started} testId="started">
        {when(job.startedAt)}
      </Fact>
      {job.status === 'queued' ? (
        <Fact name={facts.nextAttempt} testId="next-attempt">
          {formatDateTime(job.runAfter)}
        </Fact>
      ) : null}
      <Fact name={facts.finished} testId="finished">
        {when(job.finishedAt)}
      </Fact>
      {job.progress ? (
        <Fact name={facts.progress} testId="progress">
          {job.progress.total === null
            ? String(job.progress.done)
            : fillTemplate(dictJobs.detail.progressValue, {
                done: String(job.progress.done),
                total: String(job.progress.total),
              })}
        </Fact>
      ) : null}
      {job.result ? (
        <Fact name={facts.result} testId="result">
          <ResultFacts result={job.result} />
        </Fact>
      ) : null}
      {job.cancelRequestedAt ? (
        <Fact name={facts.stopRequested} testId="stop-requested">
          {stopBy ? by(job.cancelRequestedAt, stopBy) : formatDateTime(job.cancelRequestedAt)}
        </Fact>
      ) : null}
      <Fact name={facts.reruns} testId="reruns">
        {job.lastRequeuedAt
          ? fillTemplate(dictJobs.detail.rerunsValue, {
              count: String(job.requeueCount),
              at: formatDateTime(job.lastRequeuedAt),
              by: rerunBy,
            })
          : String(job.requeueCount)}
      </Fact>
      <Fact name={facts.lastError} testId="last-error">
        {job.lastError ? <span lang="en">{job.lastError}</span> : '—'}
      </Fact>
      {extraFacts}
      {job.recordedActions.length > 0 ? (
        <Fact name={facts.recordedActions} testId="recorded-actions">
          {job.recordedActions.map((code, index) => (
            <span key={code}>
              {index > 0 ? ', ' : null}
              <TypeLabel label={jobTypeLabel(code, dict, types)} />
            </span>
          ))}
        </Fact>
      ) : null}
      {job.parentJobId ? (
        <Fact name={facts.parent} testId="parent">
          {job.parent ? (
            <JobLink job={job.parent} href={jobHref(job.parent.id)} types={types} />
          ) : (
            dictJobs.detail.parentGone
          )}
        </Fact>
      ) : null}
      {job.children.length > 0 ? (
        <Fact name={facts.children} testId="children">
          <ul className="list-unstyled mb-0">
            {job.children.map((child) => (
              <li key={child.id}>
                <JobLink job={child} href={jobHref(child.id)} types={types} />
              </li>
            ))}
          </ul>
        </Fact>
      ) : null}
    </dl>
  );
}

function JobEmails({ counts }: Readonly<{ counts: JobEmailCounts }>) {
  const dict = useDictionary();
  const dictEmails = dict.jobs.detail.emails;
  return (
    <section aria-labelledby="job-emails-heading" data-testid="job-emails">
      <h2 id="job-emails-heading" className="h5">
        {dictEmails.heading}
      </h2>
      <dl className="row">
        <Fact name={dictEmails.addresses} testId="emails-addresses">
          {counts.addresses}
        </Fact>
        <Fact name={dictEmails.sent} testId="emails-sent">
          {counts.sent}
        </Fact>
        <Fact name={dictEmails.refused} testId="emails-refused">
          {counts.refused}
        </Fact>
        <Fact name={dictEmails.pending} testId="emails-pending">
          {counts.pending}
        </Fact>
      </dl>
    </section>
  );
}

type JobStatusLineProps = Readonly<{
  job: JobViewModel;
  refreshFailed: boolean;
  ref: Ref<HTMLDivElement>;
}>;

/**
 * Announced as it changes while the page follows the job. A div, not a p or an output, which take
 * text only: the status tag renders a div.
 */
function JobStatusLine({ job, refreshFailed, ref }: JobStatusLineProps) {
  const dict = useDictionary();
  const dictDetail = dict.jobs.detail;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-live="polite"
      aria-atomic="true"
      className="mb-3"
      data-testid="job-status-line"
    >
      <div className="d-flex align-items-center gap-2">
        <span>{dictDetail.facts.status}</span>
        <StatusTag
          label={dict.jobs.statuses[job.status]}
          variant={jobStatusVariant(job.status)}
          data-testid="job-status"
        />
        {isActiveJobStatus(job.status) && job.cancelRequestedAt ? (
          <SecondaryText>{dictDetail.stopPending}</SecondaryText>
        ) : null}
      </div>
      {refreshFailed ? (
        <SecondaryText data-testid="job-refresh-error">{dictDetail.refreshError}</SecondaryText>
      ) : null}
    </div>
  );
}

type JobViewProps = Readonly<{
  job: JobViewModel;
  /** The last read failed; the page shows what it read before and keeps trying. */
  refreshFailed: boolean;
  refresh: () => Promise<void>;
  back: ReactNode;
  /** The reader's facts list, built with `JobFacts`. */
  facts: ReactNode;
  rerun: (token: string, jobId: string) => Promise<unknown>;
  stop: (token: string, jobId: string) => Promise<WriteOutcome<{ stopped: boolean }>>;
}>;

/** The job's status, Run again or Stop as it allows, its facts and its emails. */
export function JobView({ job, refreshFailed, refresh, back, facts, rerun, stop }: JobViewProps) {
  const dict = useDictionary();
  const dictDetail = dict.jobs.detail;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const notifyError = useDataErrorNotice();
  // Kept after the dialog closes, so its text does not change while it fades out.
  const [action, setAction] = useState<JobAction>('rerun');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const focusStatusOnClose = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  // The button that opened the dialog can be gone once the job changes, so focus goes to the
  // status line instead. Moved after the dialog closes: while it is open it keeps focus inside it.
  useEffect(() => {
    if (confirmOpen || !focusStatusOnClose.current) return;
    focusStatusOnClose.current = false;
    statusRef.current?.focus();
  }, [confirmOpen]);

  const confirm = (next: JobAction) => {
    setAction(next);
    setConfirmOpen(true);
  };

  const handleConfirm = useCallback(() => {
    if (!token) return;
    setPending(true);
    const done =
      action === 'rerun'
        ? rerun(token, job.id).then(() => dictDetail.rerunSuccess)
        : stop(token, job.id).then((outcome) =>
            outcome.status === 'applied' && outcome.value.stopped
              ? dictDetail.stopSuccess
              : dictDetail.stopRequested,
          );
    done
      .then((text) => addNotification({ text, type: 'success' }))
      .catch((cause: unknown) => {
        if (isConflict(cause)) {
          // The job changed since it was read; the server says how, in English.
          notifyError(cause, {
            failed: fillTemplate(dictDetail.refused, { reason: (cause as Error).message }),
          });
          void refresh();
          return;
        }
        notifyError(cause, {
          failed: action === 'rerun' ? dictDetail.rerunError : dictDetail.stopError,
          notFound: dictDetail.notFound,
        });
      })
      .finally(() => {
        focusStatusOnClose.current = true;
        setPending(false);
        setConfirmOpen(false);
      });
  }, [token, action, job.id, rerun, stop, refresh, addNotification, notifyError, dictDetail]);

  const counts = job.emailCounts;
  const rerunMessage = counts
    ? `${dictDetail.rerunMessage} ${fillTemplate(dictDetail.rerunEmails, {
        count: String(counts.pending + counts.refused),
      })}`
    : dictDetail.rerunMessage;
  const endedExport = canRerunJob(job.status) && isExportJob(job.type);
  const rerunnable = canRerunJob(job.status) && !endedExport;
  const actionsQueued = rerunnable && queuedItsActions(job);
  const canStop = isActiveJobStatus(job.status) && job.cancelRequestedAt === null;
  const stopping = action === 'stop';

  return (
    <div>
      {back}
      <JobStatusLine job={job} refreshFailed={refreshFailed} ref={statusRef} />
      <div className={`${styles.actions} mb-4`}>
        {rerunnable && !actionsQueued ? (
          <Button
            variant="primary"
            isDisabled={pending}
            onPress={() => confirm('rerun')}
            data-testid="job-rerun"
          >
            {dictDetail.rerun}
          </Button>
        ) : null}
        {canStop ? (
          <Button
            variant="secondary"
            isDisabled={pending}
            onPress={() => confirm('stop')}
            data-testid="job-stop"
          >
            {dictDetail.stop}
          </Button>
        ) : null}
      </div>
      {actionsQueued ? <p data-testid="job-actions-queued">{dictDetail.actionsQueued}</p> : null}
      {endedExport ? <p data-testid="job-export-ended">{dictDetail.exportEnded}</p> : null}

      {facts}
      {counts ? <JobEmails counts={counts} /> : null}

      <ConfirmModal
        show={confirmOpen}
        title={stopping ? dictDetail.stopTitle : dictDetail.rerunTitle}
        message={stopping ? dictDetail.stopMessage : rerunMessage}
        confirmLabel={stopping ? dictDetail.stop : dictDetail.rerun}
        pending={pending}
        onConfirm={handleConfirm}
        onCancel={() => {
          // The action in flight closes the dialog when it settles.
          if (!pending) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
