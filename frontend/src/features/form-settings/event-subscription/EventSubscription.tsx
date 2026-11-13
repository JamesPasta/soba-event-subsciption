'use client';

import { useEffect, useRef, useState } from 'react';
import { InlineAlert, TextField } from '@bcgov/design-system-react-components';

import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { classifyDataError, messageForDataError } from '@/src/shared/api/dataError';
import { ApiError, isConflict } from '@/src/shared/api/sobaHelpers';
import { revealFormEventSubscriptionToken } from '@/src/features/form-settings/data/api';
import { useFormSettings } from '@/src/features/form-settings/data/useFormSettings';
import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import {
  EVENT_SUBSCRIPTION_SETTINGS_KEY,
  SetEventSubscriptionSettingsBodySchema,
  type EventSubscriptionSettings,
  type SetEventSubscriptionSettingsBody,
} from '@/src/types/formSettings';

export default function EventSubscription({ dict, drawerName, formId }: FormSettingsSectionProps) {
  const { token, authenticated, idTokenParsed } = useKeycloak();
  return (
    <EventSubscriptionContent
      key={`${formId}:${authenticated ? (idTokenParsed?.sub ?? 'authenticated') : ''}`}
      dict={dict}
      drawerName={drawerName}
      formId={formId}
      token={token}
    />
  );
}

function EventSubscriptionContent({
  dict,
  drawerName,
  formId,
  token,
}: FormSettingsSectionProps & { token: ReturnType<typeof useKeycloak>['token'] }) {
  const t = dict.form.settings;
  const { addNotification } = useNotificationStore();
  const { settings, error, save } = useFormSettings<
    EventSubscriptionSettings,
    SetEventSubscriptionSettingsBody
  >(EVENT_SUBSCRIPTION_SETTINGS_KEY, formId);
  const [editedUrl, setEditedUrl] = useState<string | null>(null);
  const [editedKey, setEditedKey] = useState<string | null>(null);
  const [newToken, setNewToken] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [saving, setSaving] = useState(false);
  const revealRequest = useRef(0);

  useEffect(() => {
    const requestId = ++revealRequest.current;
    if (settings?.hasToken && token) {
      void revealFormEventSubscriptionToken(token, formId)
        .then((savedToken) => {
          if (requestId === revealRequest.current) setRevealedToken(savedToken);
        })
        .catch((err: unknown) => {
          if (requestId !== revealRequest.current) return;
          addNotification({
            type: 'error',
            text: messageForDataError(classifyDataError(err), {
              sessionExpired: dict.general.sessionExpired,
              forbidden: dict.general.noAccess,
              failed: t.eventSubscriptionRevealError,
            }),
          });
        })
        .finally(() => {
          if (requestId === revealRequest.current) setRevealing(false);
        });
    }
    return () => {
      revealRequest.current += 1;
    };
  }, [
    formId,
    token,
    settings?.hasToken,
    addNotification,
    dict.general.sessionExpired,
    dict.general.noAccess,
    t.eventSubscriptionRevealError,
  ]);

  const endpointUrl = editedUrl ?? settings?.endpointUrl ?? '';
  const key = editedKey ?? settings?.key ?? '';
  const changed = editedUrl !== null || editedKey !== null || newToken.length > 0;

  const cancel = () => {
    revealRequest.current += 1;
    setEditedUrl(null);
    setEditedKey(null);
    setNewToken('');
    setRevealedToken(null);
    setShowToken(false);
    setRevealing(false);
  };

  const toggleToken = async () => {
    if (showToken) {
      setShowToken(false);
      return;
    }
    if (newToken || revealedToken) {
      setShowToken(true);
      return;
    }
    if (!token || !settings?.hasToken || revealing) return;
    const requestId = ++revealRequest.current;
    setRevealing(true);
    try {
      const savedToken = await revealFormEventSubscriptionToken(token, formId);
      if (requestId !== revealRequest.current) return;
      setRevealedToken(savedToken);
      setShowToken(true);
    } catch (err) {
      if (requestId !== revealRequest.current) return;
      addNotification({
        type: 'error',
        text: messageForDataError(classifyDataError(err), {
          sessionExpired: dict.general.sessionExpired,
          forbidden: dict.general.noAccess,
          failed: t.eventSubscriptionRevealError,
        }),
      });
    } finally {
      if (requestId === revealRequest.current) setRevealing(false);
    }
  };

  const saveChanges = async () => {
    if (!token || !settings || !changed || saving) return;
    const body: SetEventSubscriptionSettingsBody = {
      endpointUrl: endpointUrl.trim(),
      key,
      version: settings.version,
      ...(newToken ? { token: newToken } : {}),
    };
    const parsed = SetEventSubscriptionSettingsBodySchema.safeParse(body);
    if (!parsed.success) {
      addNotification({
        type: 'error',
        text: parsed.error.issues.some((issue) => issue.path[0] === 'endpointUrl')
          ? t.eventSubscriptionInvalidUrl
          : t.formSettingsDrawerSaveErrorMessage,
      });
      return;
    }
    setSaving(true);
    try {
      const savedToken = newToken || revealedToken;
      await save(token, parsed.data);
      cancel();
      if (savedToken) setRevealedToken(savedToken);
      addNotification({ type: 'success', text: t.formSettingsDrawerSaveSuccessMessage });
    } catch (err) {
      if (isConflict(err)) cancel();
      const missingKey =
        err instanceof ApiError &&
        err.status === 503 &&
        err.message === 'Endpoint token storage is not configured';
      let errorText = t.formSettingsDrawerSaveErrorMessage;
      if (isConflict(err)) errorText = t.settingsConflictMessage;
      else if (missingKey) errorText = t.eventSubscriptionTokenUnavailable;
      addNotification({
        type: 'error',
        text: errorText,
      });
    } finally {
      setSaving(false);
    }
  };

  const readError = error
    ? messageForDataError(error, {
        sessionExpired: dict.general.sessionExpired,
        forbidden: dict.general.noAccess,
        failed: t.eventSubscriptionLoadError,
      })
    : null;

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={t.eventSubscriptionDrawerLabel}
      onSave={saveChanges}
      onCancel={cancel}
      canSave={!!settings && changed && !saving}
    >
      {readError && (
        <InlineAlert variant="warning" title={readError} data-testid="event-subscription-error" />
      )}
      <div className="w-100 mb-3">
        <TextField
          label={t.eventSubscriptionEndpointUrl}
          description={t.eventSubscriptionEndpointExample}
          value={endpointUrl}
          onChange={setEditedUrl}
          validate={(value) =>
            SetEventSubscriptionSettingsBodySchema.shape.endpointUrl.safeParse(value.trim()).success
              ? null
              : t.eventSubscriptionInvalidUrl
          }
          errorMessage={t.eventSubscriptionInvalidUrl}
          isDisabled={!settings || saving}
          data-testid="event-subscription-url"
        />
      </div>
      <div className="w-100 mb-3">
        <TextField
          label={t.eventSubscriptionKey}
          value={key}
          onChange={setEditedKey}
          isDisabled={!settings || saving}
          data-testid="event-subscription-key"
        />
      </div>
      <div className="d-flex align-items-end gap-2">
        <TextField
          label={t.eventSubscriptionToken}
          type={showToken ? 'text' : 'password'}
          value={newToken || revealedToken || ''}
          onChange={(value) => {
            revealRequest.current += 1;
            setRevealedToken(null);
            setRevealing(false);
            setNewToken(value);
          }}
          isDisabled={!settings || saving || revealing}
          data-testid="event-subscription-token"
        />
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => void toggleToken()}
          aria-pressed={showToken}
          disabled={!settings || saving || revealing || (!newToken && !settings.hasToken)}
        >
          {showToken ? t.eventSubscriptionHideSecret : t.eventSubscriptionShowSecret}
        </button>
      </div>
    </FormSettingsDrawers>
  );
}
