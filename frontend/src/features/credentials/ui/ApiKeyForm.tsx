'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Form,
  TextField,
} from '@bcgov/design-system-react-components';
import { CredentialFieldsSchema } from '@soba/lib';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import { apiErrorMessage, messageForDataError } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { TabFormSection, TabFormUnavailable } from '@/src/features/workspaces/ui/TabForm';
import styles from '@/src/features/workspaces/ui/WorkspaceForm.module.css';
import type { Dictionary } from '@/src/types/dictionary';
import type {
  CredentialMetadata,
  CredentialOwner,
  CredentialSecret,
  CredentialType,
} from '@/src/types/credentials';
import { useCredential } from '../data/useCredential';
import { useCredentialWriter } from '../data/useCredentialWriter';
import { ApiKeyModal, type ApiKeyModalStage } from './ApiKeyModal';

export interface ApiKeyFormProps {
  dict: Dictionary;
  owner: CredentialOwner;
  /** The key to edit. Left out, the form generates one. */
  credentialId?: string;
  /** Whether the issuer can generate keys. */
  available: boolean;
  /** Told whether the form is issuing, showing or holding an unsaved new key. */
  onHoldChange?: (held: boolean) => void;
  onDone: () => void;
}

/**
 * Add or edit an API key. Generate creates the key and shows it once; Save then stores the label,
 * notes and types. Editing reads the key on its own, so the fields start from the key as it is now.
 */
export function ApiKeyForm({
  dict,
  owner,
  credentialId,
  available,
  onHoldChange,
  onDone,
}: Readonly<ApiKeyFormProps>) {
  const t = dict.apiKeys;
  const authDefaults = useAuthErrorDefaults();
  const record = useCredential(owner, credentialId ?? null);
  // The fields start from the first read and then hold the key themselves, so a later read that
  // fails or pauses cannot take a key off the screen.
  const [seed, setSeed] = useState<CredentialMetadata | null>(null);
  if (record.credential && !seed) setSeed(record.credential);

  let content: React.ReactNode;
  if (!credentialId || seed) {
    content = (
      <ApiKeyFields
        key={seed?.id ?? 'new'}
        dict={dict}
        owner={owner}
        credential={seed}
        available={available}
        onHoldChange={onHoldChange}
        onDone={onDone}
      />
    );
  } else if (record.error) {
    content = (
      <TabFormUnavailable
        message={messageForDataError(record.error, { ...authDefaults, failed: t.keyLoadError })}
        testId="api-key-load-error"
        cancelLabel={t.cancel}
        cancelTestId="api-key-cancel"
        onCancel={onDone}
      />
    );
  } else {
    content = <CenteredProgress label={dict.general.loading} />;
  }

  return (
    <TabFormSection
      heading={credentialId ? t.editHeading : t.addHeading}
      testId={credentialId ? 'api-key-edit-form' : 'api-key-create-form'}
    >
      {content}
    </TabFormSection>
  );
}

interface ApiKeyFieldsProps {
  dict: Dictionary;
  owner: CredentialOwner;
  /** The key as read for this form, or null to generate one. Seeds the fields on mount. */
  credential: CredentialMetadata | null;
  available: boolean;
  onHoldChange?: (held: boolean) => void;
  onDone: () => void;
}

type Busy = 'generate' | 'save' | null;

/** The key just issued, else a regenerate waiting to be confirmed. */
const modalStage = (
  shownKey: string | null,
  confirming: boolean,
  saved: CredentialMetadata | null,
): ApiKeyModalStage | null => {
  if (shownKey) return { kind: 'key', apiKey: shownKey };
  if (confirming && saved) return { kind: 'confirm', label: saved.label };
  return null;
};

function ApiKeyFields({
  dict,
  owner,
  credential,
  available,
  onHoldChange,
  onDone,
}: Readonly<ApiKeyFieldsProps>) {
  const t = dict.apiKeys;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const writer = useCredentialWriter(owner);

  const [label, setLabel] = useState(credential?.label ?? '');
  const [notes, setNotes] = useState(credential?.notes ?? '');
  const [types, setTypes] = useState<CredentialType[]>(credential?.types ?? []);
  // The key as last stored: null until a new key is generated.
  const [saved, setSaved] = useState<CredentialMetadata | null>(credential);
  // The key just issued, shown once in a modal until it is closed.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // A failed regenerate may have left the key unknown, so Regenerate waits for a read of the key.
  const [regenerateFailed, setRegenerateFailed] = useState(false);

  // A key this add form generated is held until it is saved or the form is cancelled, so the table
  // cannot delete or open it underneath.
  const holdsNewKey = credential === null && saved !== null;
  const held = busy !== null || shownKey !== null || holdsNewKey;
  useEffect(() => {
    onHoldChange?.(held);
    return () => onHoldChange?.(false);
  }, [held, onHoldChange]);

  const fields = CredentialFieldsSchema.safeParse({ label, notes, types });
  const canGenerate = available && Boolean(token) && busy === null && fields.success;
  const canRegenerate =
    available && Boolean(token) && busy === null && saved?.status === 'active' && !regenerateFailed;
  const canSave = Boolean(token) && busy === null && saved !== null && fields.success;
  const generateLabel = busy === 'generate' ? t.generating : t.generate;

  const issue = async (
    call: (signedIn: string) => Promise<WriteOutcome<CredentialSecret>>,
    errorText: string,
  ): Promise<boolean> => {
    if (!token) {
      addNotification({ text: errorText, type: 'error' });
      setConfirmRegenerate(false);
      return false;
    }
    setBusy('generate');
    try {
      const outcome = await call(token);
      if (outcome.status !== 'applied') return false;
      setSaved(outcome.value.credential);
      setShownKey(outcome.value.apiKey);
      return true;
    } catch (err: unknown) {
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? errorText,
        type: 'error',
        consoleError: err,
      });
      return false;
    } finally {
      setBusy(null);
      setConfirmRegenerate(false);
    }
  };
  const generate = () => {
    if (fields.success)
      void issue((signedIn) => writer.generate(signedIn, fields.data), t.generateError);
  };
  const regenerate = async () => {
    if (!saved) return;
    const done = await issue(
      (signedIn) => writer.regenerate(signedIn, saved.id),
      t.regenerateError,
    );
    if (done) return;
    setRegenerateFailed(true);
    if (!token) return;
    try {
      setSaved(await writer.reread(token, saved.id));
      setRegenerateFailed(false);
    } catch {
      // Unread, the key could be in any state, so Regenerate stays off until the form is reopened.
    }
  };

  const stage = modalStage(shownKey, confirmRegenerate, saved);
  const closeModal = () => {
    if (busy !== null) return;
    setShownKey(null);
    setConfirmRegenerate(false);
  };

  const save = async () => {
    if (!token || !saved || !fields.success) return;
    setBusy('save');
    try {
      await writer.update(token, saved, fields.data);
      addNotification({ text: t.saveSuccess, type: 'success' });
      onDone();
    } catch (err: unknown) {
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? t.saveError,
        type: 'error',
        consoleError: err,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Form
        className={styles.fieldStack}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label={t.label}
          value={label}
          onChange={setLabel}
          maxLength={100}
          isRequired
          isDisabled={busy !== null}
          data-testid="api-key-label"
        />
        <TextField
          label={t.notes}
          value={notes}
          onChange={setNotes}
          maxLength={1000}
          isDisabled={busy !== null}
          data-testid="api-key-notes"
        />
        <CheckboxGroup
          label={t.types}
          description={t.typesHelp}
          value={types}
          onChange={(values) => setTypes(values as CredentialType[])}
          isRequired
          isDisabled={busy !== null}
        >
          <Checkbox value="api" data-testid="api-key-type-api">
            {t.apiAccess}
          </Checkbox>
          <Checkbox value="web-component" data-testid="api-key-type-web-component">
            {t.webComponents}
          </Checkbox>
        </CheckboxGroup>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" isDisabled={!canSave} data-testid="api-key-save">
            {busy === 'save' ? t.saving : t.save}
          </Button>
          {saved ? (
            <Button
              type="button"
              variant="secondary"
              isDisabled={!canRegenerate}
              onPress={() => setConfirmRegenerate(true)}
              data-testid="api-key-regenerate"
            >
              {t.regenerate}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              isDisabled={!canGenerate}
              onPress={generate}
              data-testid="api-key-generate"
            >
              {generateLabel}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            isDisabled={busy !== null}
            onPress={onDone}
            data-testid="api-key-cancel"
          >
            {t.cancel}
          </Button>
        </div>
      </Form>
      {stage && (
        <ApiKeyModal
          dict={dict}
          stage={stage}
          pending={busy === 'generate'}
          onConfirm={() => void regenerate()}
          onClose={closeModal}
        />
      )}
    </>
  );
}

export default ApiKeyForm;
