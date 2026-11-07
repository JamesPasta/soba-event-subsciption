'use client';

import { useRef, useState } from 'react';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { useFormWriter } from '../data/useForm';

export function DeleteFormModal({
  formId,
  name,
  onClose,
}: Readonly<{ formId: string; name: string; onClose: () => void }>) {
  const dict = useDictionary();
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const reportError = useDataErrorNotice();
  const writer = useFormWriter(formId);
  const [pending, setPending] = useState(false);
  const writing = useRef(false);

  const remove = async () => {
    if (!token || writing.current) return;
    writing.current = true;
    setPending(true);
    try {
      await writer.remove(token);
      addNotification({ text: dict.form.deleteSuccess, type: 'success' });
      onClose();
    } catch (error) {
      reportError(error, { failed: dict.form.deleteError });
    } finally {
      writing.current = false;
      setPending(false);
    }
  };

  return (
    <ConfirmModal
      show
      danger
      title={dict.form.deleteTitle}
      message={dict.form.deleteMessage.replace('{name}', () => name)}
      confirmLabel={dict.form.deleteTitle}
      pending={pending}
      confirmDisabled={!token}
      onConfirm={() => void remove()}
      onCancel={() => {
        if (!writing.current) onClose();
      }}
    />
  );
}
