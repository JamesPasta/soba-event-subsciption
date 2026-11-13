'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';
import { Button } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { SecondaryText } from '@/src/components/SecondaryText';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';
import { apiErrorMessage, failureDetail, isOutcomeUnknown } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { useDownload } from '@/src/shared/api/useDownload';
import type { DownloadedFile } from '@/src/shared/api/sobaHelpers';
import type { Dictionary } from '@/src/types/dictionary';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { formatFileSize } from '@/src/shared/util/fileSize';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import { saveBlob } from '@/src/shared/util/saveBlob';

/** One line of the details under the outcome. */
export type FileDownloadFact = Readonly<{ name: string; value: string; testId: string }>;

type FileDownloadProps = {
  load: (token: string) => Promise<DownloadedFile>;
  /** Shown when the server has no such file; "This file could not be found." by default. */
  notFound?: string;
  /** What the page knows about the file, such as its ids, shown with the outcome. */
  facts?: readonly FileDownloadFact[];
};

/** The server's code for a failed read and the id its logs carry for it. */
const errorFacts = (cause: unknown, text: Dictionary['fileDownload']): FileDownloadFact[] => {
  const { code, requestId } = failureDetail(cause);
  const facts: FileDownloadFact[] = [];
  if (code) facts.push({ name: text.errorCode, value: code, testId: 'error-code' });
  if (requestId) facts.push({ name: text.reference, value: requestId, testId: 'reference' });
  return facts;
};

function Facts({ facts }: Readonly<{ facts: readonly FileDownloadFact[] }>) {
  const text = useDictionary().fileDownload;
  return (
    <section aria-labelledby="file-download-details-heading" className="mt-3 w-100">
      <h2 id="file-download-details-heading" className="h6">
        {text.detailsHeading}
      </h2>
      <dl className="row mb-0" data-testid="file-download-details">
        {facts.map(({ name, value, testId }) => (
          <Fragment key={testId}>
            <dt className="col-sm-3">{name}</dt>
            <dd className="col-sm-9 text-break" data-testid={`file-download-${testId}`}>
              {value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

/** Saves the loaded file once it arrives, with a button to save it again. */
export function FileDownload({ load, notFound, facts = [] }: Readonly<FileDownloadProps>) {
  const dict = useDictionary();
  const text = dict.fileDownload;
  const authDefaults = useAuthErrorDefaults();
  const formatDateTime = useFormatLongDateTime();
  const locale = useSortLocale();
  const { data, error, refresh } = useDownload(load);
  const saved = useRef(false);
  const failedAt = useMemo(() => (error ? new Date().toISOString() : ''), [error]);

  useEffect(() => {
    if (!data || saved.current) return;
    saved.current = true;
    saveBlob(data.blob, data.filename);
  }, [data]);

  if (error) {
    const { cause } = error;
    // Only a server failure or no response can succeed on a second read.
    const retryable = isOutcomeUnknown(cause);
    const failed =
      apiErrorMessage(cause, { file_unavailable: dict.apiErrors.file_unavailable }) ??
      text.loadError;
    return (
      <div className="mt-3 d-flex flex-column gap-2 align-items-start">
        <LoadErrorAlert
          error={error}
          messages={{
            ...authDefaults,
            notFound: notFound ?? dict.apiErrors.file_not_found,
            failed,
          }}
          testIds={{ notFound: 'file-download-notfound', failed: 'file-download-loaderror' }}
        />
        {retryable ? (
          <Button
            variant="secondary"
            onPress={() => void refresh()}
            data-testid="file-download-retry"
          >
            {dict.general.tryAgain}
          </Button>
        ) : null}
        <Facts
          facts={[
            ...facts,
            ...errorFacts(cause, text),
            { name: text.time, value: formatDateTime(failedAt), testId: 'time' },
          ]}
        />
      </div>
    );
  }
  if (!data) return <CenteredProgress label={text.loading} />;
  return (
    <div className="mt-3 d-flex flex-column gap-2 align-items-start">
      <SecondaryText elementType="p" data-testid="file-download-saved">
        {fillTemplate(text.saved, { name: data.filename })}
      </SecondaryText>
      <Button
        variant="secondary"
        onPress={() => saveBlob(data.blob, data.filename)}
        data-testid="file-download-again"
      >
        {text.again}
      </Button>
      <Facts
        facts={[
          ...facts,
          ...(data.blob.type ? [{ name: text.type, value: data.blob.type, testId: 'type' }] : []),
          { name: text.size, value: formatFileSize(data.blob.size, locale), testId: 'size' },
        ]}
      />
    </div>
  );
}
