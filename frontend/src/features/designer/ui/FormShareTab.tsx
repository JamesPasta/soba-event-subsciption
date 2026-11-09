'use client';
import { useCallback, useMemo } from 'react';
import { Heading, Button, Link } from '@bcgov/design-system-react-components';
import { useRouter, usePathname } from 'next/navigation';

import type { Dictionary } from '@/src/types/dictionary';
import { useForm } from '@/src/features/designer/data/useForm';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { getFormsAppBaseUrl } from '@/src/shared/config/runtimeConfig';
import { codeLabel } from '@/src/shared/util/codeList';

interface FormShareTabProps {
  dict: Dictionary;
  formId?: string;
  formName: string;
  formDesc: string;
  workspaceId: string | null;
}

export default function FormShareTab({
  dict,
  formId,
  formName,
  formDesc,
}: Readonly<FormShareTabProps>) {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const { addNotification } = useNotificationStore();
  const { form } = useForm(formId ?? '');

  const link = useMemo(() => {
    return `${getFormsAppBaseUrl()}/${locale}/form/${formId}`;
  }, [locale, formId]);

  const copyToClipboard = useCallback(() => {
    // Chained so a missing clipboard (insecure context) also lands in catch.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(link))
      .then(() => addNotification({ text: dict.form.copiedNotification, type: 'success' }))
      .catch((cause: unknown) =>
        addNotification({
          text: dict.form.copyFailedNotification,
          type: 'error',
          consoleError: cause,
        }),
      );
  }, [link, addNotification, dict.form.copiedNotification, dict.form.copyFailedNotification]);

  return (
    <>
      <Heading level={2} isUnstyled className="mt-5" data-testid="share-tab-formName">
        {formName}
      </Heading>
      <p data-testid="share-tab-formDesc">{formDesc}</p>
      <p data-testid="share-tab-ministryOrOrg">
        {dict.form.ministryOrOrg}: {codeLabel(dict.ministries, form?.org) ?? dict.general.unknown}
      </p>
      <p>
        <Button variant="secondary" data-testid="share-tab-copyToClip" onPress={copyToClipboard}>
          {dict.form.copy}
        </Button>
        <Link
          className="bcds-react-aria-Link medium false ms-2"
          data-testid="share-tab-form-link"
          onPress={() => {
            router.push(link);
          }}
        >
          {link}
        </Link>
      </p>
    </>
  );
}
