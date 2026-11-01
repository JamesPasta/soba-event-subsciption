'use client';

import { useState } from 'react';
import { Button, InlineAlert, TextField } from '@bcgov/design-system-react-components';
import { Modal } from '@/src/components/Modal';
import type { Dictionary } from '@/src/types/dictionary';

/** What the modal holds: a regenerate to confirm for the named key, or a key to show once. */
export type ApiKeyModalStage = { kind: 'confirm'; label: string } | { kind: 'key'; apiKey: string };

type CopyState = 'idle' | 'copied' | 'failed';

export interface ApiKeyModalProps {
  dict: Dictionary;
  stage: ApiKeyModalStage;
  /** A regenerate is in progress; the modal cannot be closed until it ends. */
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * One modal for issuing a key. A regenerate asks first, then shows the new key in place. A key is
 * shown once: Escape and a backdrop click do not close it, so only Done or the close button drop it.
 */
export function ApiKeyModal({
  dict,
  stage,
  pending,
  onConfirm,
  onClose,
}: Readonly<ApiKeyModalProps>) {
  const t = dict.apiKeys;
  const confirming = stage.kind === 'confirm';
  const confirmLabel = pending ? t.generating : t.regenerate;
  return (
    <Modal
      show
      title={confirming ? t.regenerateConfirmTitle : t.secretTitle}
      size="md"
      isDismissable={confirming && !pending}
      isCloseable={!pending}
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <Button
              variant="primary"
              isDisabled={pending}
              onPress={onConfirm}
              data-testid="api-key-regenerate-confirm"
            >
              {confirmLabel}
            </Button>
            <Button
              variant="secondary"
              isDisabled={pending}
              onPress={onClose}
              data-testid="api-key-regenerate-cancel"
            >
              {t.cancel}
            </Button>
          </>
        ) : (
          <Button variant="primary" onPress={onClose} data-testid="api-key-done">
            {t.done}
          </Button>
        )
      }
    >
      {stage.kind === 'confirm' ? (
        <p className="m-0" data-testid="api-key-regenerate-message">
          {t.regenerateConfirmMessage.replace('{label}', () => stage.label)}
        </p>
      ) : (
        <ApiKeyShown dict={dict} apiKey={stage.apiKey} />
      )}
    </Modal>
  );
}

function ApiKeyShown({ dict, apiKey }: Readonly<{ dict: Dictionary; apiKey: string }>) {
  const t = dict.apiKeys;
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };
  return (
    <div className="d-flex flex-column gap-3" data-testid="api-key-secret-panel">
      <InlineAlert
        variant="warning"
        title={t.onceTitle}
        description={t.onceBody}
        data-testid="api-key-once-warning"
      />
      <TextField
        label={t.yourKey}
        value={apiKey}
        isReadOnly
        autoComplete="off"
        spellCheck="false"
        data-testid="api-key-secret"
      />
      <div>
        {/* The button that asked for the key is disabled or gone by now, so focus moves here. */}
        <Button
          variant="secondary"
          autoFocus
          data-testid="api-key-copy"
          onPress={() => void copy()}
        >
          {t.copy}
        </Button>
      </div>
      {/* Kept in the page so a screen reader announces the text when it appears. */}
      <p role="status" className="m-0" data-testid="api-key-copied">
        {copyState === 'copied' ? t.copied : ''}
      </p>
      {copyState === 'failed' && (
        <p role="alert" data-testid="api-key-copy-error">
          {t.copyError}
        </p>
      )}
    </div>
  );
}
