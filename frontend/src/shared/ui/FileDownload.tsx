'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { SecondaryText } from '@/src/components/SecondaryText';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';
import { isOutcomeUnknown } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { useDownload } from '@/src/shared/api/useDownload';
import type { DownloadedFile } from '@/src/shared/api/sobaHelpers';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import { saveBlob } from '@/src/shared/util/saveBlob';

type FileDownloadProps = {
  load: (token: string) => Promise<DownloadedFile>;
  /** Shown when the server has no such file; "This file could not be found." by default. */
  notFound?: string;
};

/** Saves the loaded file once it arrives, with a button to save it again. */
export function FileDownload({ load, notFound }: Readonly<FileDownloadProps>) {
  const dict = useDictionary();
  const text = dict.fileDownload;
  const authDefaults = useAuthErrorDefaults();
  const { data, error, refresh } = useDownload(load);
  const saved = useRef(false);

  useEffect(() => {
    if (!data || saved.current) return;
    saved.current = true;
    saveBlob(data.blob, data.filename);
  }, [data]);

  if (error) {
    // Only a server failure or no response can succeed on a second read.
    const retryable = isOutcomeUnknown(error.cause);
    return (
      <div className="mt-3 d-flex flex-column gap-2 align-items-start">
        <LoadErrorAlert
          error={error}
          messages={{
            ...authDefaults,
            notFound: notFound ?? dict.apiErrors.file_not_found,
            failed: text.loadError,
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
    </div>
  );
}
