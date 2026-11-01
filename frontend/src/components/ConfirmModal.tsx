'use client';

import { Button } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { Modal } from './Modal';

export interface ConfirmModalProps {
  show: boolean;
  title: string;
  message: string;
  /** Label for the action being confirmed, e.g. "Delete". */
  confirmLabel: string;
  /** Label for backing out; "Cancel" unless that would read as the action itself. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  /** Holds the confirm button off, such as while the message waits on a read. */
  confirmDisabled?: boolean;
}

/** Prompt before an action that cannot be undone. */
export function ConfirmModal({
  show,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  pending = false,
  confirmDisabled = false,
}: Readonly<ConfirmModalProps>) {
  const dict = useDictionary();

  return (
    <Modal
      show={show}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button
            variant="primary"
            isDisabled={pending || confirmDisabled}
            onPress={onConfirm}
            data-testid="confirm-modal-confirm"
          >
            {confirmLabel}
          </Button>
          <Button
            variant="secondary"
            isDisabled={pending}
            onPress={onCancel}
            data-testid="confirm-modal-cancel"
          >
            {cancelLabel ?? dict.general.cancel}
          </Button>
        </>
      }
    >
      <p data-testid="confirm-modal-message">{message}</p>
    </Modal>
  );
}
