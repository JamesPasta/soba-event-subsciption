import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import type { CredentialMetadata } from '@/src/types/credentials';
import { renderSignedIn } from '../workspaces/workspaceGroupsTestKit';

const { mockApi, mockAddNotification, session } = vi.hoisted(() => ({
  mockApi: {
    listCredentials: vi.fn(),
    getCredential: vi.fn(),
    issueCredential: vi.fn(),
    updateCredential: vi.fn(),
    regenerateCredential: vi.fn(),
    deleteCredential: vi.fn(),
  },
  mockAddNotification: vi.fn(),
  session: { token: 'token' as string | null },
}));

vi.mock('@/src/features/credentials/data/api', () => mockApi);
vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: session.token, initializing: false }),
}));
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

const dict = { ...en, locale: 'en' } as unknown as Dictionary;
const t = dict.apiKeys;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

import { ApiKeyForm } from '@/src/features/credentials/ui/ApiKeyForm';

const owner = { kind: 'form' as const, id: 'form-1' };
const saved: CredentialMetadata = {
  id: 'k-1',
  scope: 'form',
  label: 'Integration',
  notes: '',
  types: ['api'],
  status: 'active',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  rotatedAt: null,
};

const renderForm = (props: { credentialId?: string; available?: boolean } = {}) => {
  const onDone = vi.fn();
  renderSignedIn(
    <ApiKeyForm
      dict={dict}
      owner={owner}
      credentialId={props.credentialId}
      available={props.available ?? true}
      onDone={onDone}
    />,
  );
  return onDone;
};
const labelInput = () => screen.getByRole('textbox', { name: new RegExp(t.label) });
const notesInput = () => screen.getByRole('textbox', { name: new RegExp(t.notes) });

async function fillNewKey(user: ReturnType<typeof userEvent.setup>) {
  await user.type(labelInput(), 'Integration');
  await user.click(screen.getByTestId('api-key-type-api'));
}

describe('ApiKeyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.token = 'token';
    mockApi.listCredentials.mockResolvedValue(undefined);
    mockApi.issueCredential.mockResolvedValue({ credential: saved, apiKey: 'shown-once' });
    mockApi.regenerateCredential.mockResolvedValue({ credential: saved, apiKey: 'shown-again' });
    mockApi.getCredential.mockResolvedValue(saved);
  });

  it('holds Save off until a key is generated, then shows the key once in a modal', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByTestId('api-key-generate')).toBeDisabled();
    expect(screen.getByTestId('api-key-save')).toBeDisabled();

    await fillNewKey(user);
    expect(screen.getByTestId('api-key-save')).toBeDisabled();
    await user.click(screen.getByTestId('api-key-generate'));

    await waitFor(() =>
      expect(mockApi.issueCredential).toHaveBeenCalledWith('token', owner, {
        label: 'Integration',
        notes: '',
        types: ['api'],
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: t.secretTitle });
    expect(within(dialog).getByTestId('api-key-once-warning')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('shown-once')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-copy')).toHaveFocus();
    await user.click(screen.getByTestId('api-key-done'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('api-key-save')).toBeEnabled();
    // The new key is now edited in place: the next issue is a regenerate.
    expect(screen.queryByTestId('api-key-generate')).not.toBeInTheDocument();
    expect(screen.getByTestId('api-key-regenerate')).toBeEnabled();
  });

  it('saves without a request when nothing changed after generating', async () => {
    const user = userEvent.setup();
    const onDone = renderForm();
    await fillNewKey(user);
    await user.click(screen.getByTestId('api-key-generate'));
    await screen.findByTestId('api-key-secret-panel');
    await user.click(screen.getByTestId('api-key-done'));
    await user.click(screen.getByTestId('api-key-save'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockApi.updateCredential).not.toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith({ text: t.saveSuccess, type: 'success' });
  });

  it('saves a change made after generating to the generated key', async () => {
    const user = userEvent.setup();
    mockApi.updateCredential.mockResolvedValue({ ...saved, notes: 'Vault path' });
    const onDone = renderForm();
    await fillNewKey(user);
    await user.click(screen.getByTestId('api-key-generate'));
    await screen.findByTestId('api-key-secret-panel');
    await user.click(screen.getByTestId('api-key-done'));
    await user.type(notesInput(), 'Vault path');
    await user.click(screen.getByTestId('api-key-save'));
    await waitFor(() =>
      expect(mockApi.updateCredential).toHaveBeenCalledWith('token', owner, 'k-1', {
        label: 'Integration',
        notes: 'Vault path',
        types: ['api'],
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('reports a failed generate and keeps Save off', async () => {
    const user = userEvent.setup();
    mockApi.issueCredential.mockRejectedValue(new Error('503'));
    renderForm();
    await fillNewKey(user);
    await user.click(screen.getByTestId('api-key-generate'));
    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ text: t.generateError, type: 'error' }),
      ),
    );
    expect(screen.queryByTestId('api-key-secret-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('api-key-save')).toBeDisabled();
    expect(screen.getByTestId('api-key-generate')).toBeEnabled();
  });

  it('cannot generate while the issuer is unavailable', async () => {
    const user = userEvent.setup();
    renderForm({ available: false });
    await fillNewKey(user);
    expect(screen.getByTestId('api-key-generate')).toBeDisabled();
  });

  it('regenerates an edited key after confirming, then shows the new key in the same modal', async () => {
    const user = userEvent.setup();
    renderForm({ credentialId: 'k-1' });
    expect(await screen.findByDisplayValue('Integration')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-save')).toBeEnabled();

    await user.click(screen.getByTestId('api-key-regenerate'));
    expect(screen.getByTestId('api-key-regenerate-message')).toHaveTextContent(
      t.regenerateConfirmMessage.replace('{label}', 'Integration'),
    );
    const dialog = screen.getByRole('dialog', { name: t.regenerateConfirmTitle });
    expect(mockApi.regenerateCredential).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('api-key-regenerate-confirm'));

    await waitFor(() =>
      expect(mockApi.regenerateCredential).toHaveBeenCalledWith('token', owner, 'k-1'),
    );
    expect(await screen.findByDisplayValue('shown-again')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: t.secretTitle })).toBe(dialog);
    expect(screen.getByTestId('api-key-copy')).toHaveFocus();
  });

  it('cannot be closed while a regenerate runs', async () => {
    const user = userEvent.setup();
    let finish: (secret: unknown) => void = () => undefined;
    mockApi.regenerateCredential.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderForm({ credentialId: 'k-1' });
    await screen.findByDisplayValue('Integration');
    await user.click(screen.getByTestId('api-key-regenerate'));
    await user.click(screen.getByTestId('api-key-regenerate-confirm'));

    await user.keyboard('{Escape}');
    const dialog = screen.getByRole('dialog', { name: t.regenerateConfirmTitle });
    expect(screen.getByTestId('api-key-regenerate-confirm')).toBeDisabled();
    expect(screen.getByTestId('api-key-regenerate-cancel')).toBeDisabled();
    // Only the two footer buttons: no close button.
    expect(within(dialog).getAllByRole('button')).toHaveLength(2);

    act(() => finish({ credential: saved, apiKey: 'late' }));
    expect(await screen.findByDisplayValue('late')).toBeInTheDocument();
  });

  it('keeps a key on screen when a later read of the key fails', async () => {
    const user = userEvent.setup();
    renderForm({ credentialId: 'k-1' });
    await screen.findByDisplayValue('Integration');
    await user.click(screen.getByTestId('api-key-regenerate'));
    await user.click(screen.getByTestId('api-key-regenerate-confirm'));
    await screen.findByDisplayValue('shown-again');

    mockApi.getCredential.mockClear();
    mockApi.getCredential.mockRejectedValue(new Error('offline'));
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(mockApi.getCredential).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('api-key-load-error')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('shown-again')).toBeInTheDocument();
  });

  it('closes the confirm step and says so when the session has ended', async () => {
    const user = userEvent.setup();
    const view = renderSignedIn(
      <ApiKeyForm dict={dict} owner={owner} credentialId="k-1" available onDone={vi.fn()} />,
    );
    await screen.findByDisplayValue('Integration');
    await user.click(screen.getByTestId('api-key-regenerate'));

    session.token = null;
    view.rerender();
    await user.click(screen.getByTestId('api-key-regenerate-confirm'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockAddNotification).toHaveBeenCalledWith({ text: t.regenerateError, type: 'error' });
    expect(mockApi.regenerateCredential).not.toHaveBeenCalled();
    // The paused read leaves the fields in place.
    expect(screen.getByDisplayValue('Integration')).toBeInTheDocument();
  });

  it('holds Regenerate off for a key that is not active', async () => {
    mockApi.getCredential.mockResolvedValue({ ...saved, status: 'unknown' });
    renderForm({ credentialId: 'k-1' });
    expect(await screen.findByDisplayValue('Integration')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-regenerate')).toBeDisabled();
    expect(screen.getByTestId('api-key-save')).toBeEnabled();
  });

  it('keeps the key on screen through Escape, closing only on Done', async () => {
    const user = userEvent.setup();
    const onDone = renderForm();
    await fillNewKey(user);
    await user.click(screen.getByTestId('api-key-generate'));
    await screen.findByRole('dialog', { name: t.secretTitle });
    await user.keyboard('{Escape}');
    expect(screen.getByDisplayValue('shown-once')).toBeInTheDocument();
    await user.click(screen.getByTestId('api-key-done'));
    expect(screen.queryByDisplayValue('shown-once')).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('starts the copy message afresh for each new key', async () => {
    const user = userEvent.setup();
    renderForm({ credentialId: 'k-1' });
    await screen.findByDisplayValue('Integration');
    await user.click(screen.getByTestId('api-key-regenerate'));
    await user.click(screen.getByTestId('api-key-regenerate-confirm'));
    await user.click(await screen.findByTestId('api-key-copy'));
    expect(screen.getByTestId('api-key-copied')).toHaveTextContent(t.copied);
    await user.click(screen.getByTestId('api-key-done'));

    mockApi.regenerateCredential.mockResolvedValue({ credential: saved, apiKey: 'third' });
    await user.click(screen.getByTestId('api-key-regenerate'));
    await user.click(screen.getByTestId('api-key-regenerate-confirm'));
    await screen.findByDisplayValue('third');
    expect(screen.getByTestId('api-key-copied')).toHaveTextContent('');
  });

  it.each([
    ['still active', 'enabled', () => mockApi.getCredential.mockResolvedValue(saved)],
    [
      'now unknown',
      'disabled',
      () => mockApi.getCredential.mockResolvedValue({ ...saved, status: 'unknown' }),
    ],
    ['unreadable', 'disabled', () => mockApi.getCredential.mockRejectedValue(new Error('503'))],
  ] as const)(
    'after a failed regenerate of a key that is %s, leaves Regenerate %s',
    async (_name, expected, arrangeRead) => {
      const user = userEvent.setup();
      mockApi.regenerateCredential.mockRejectedValue(new Error('503'));
      renderForm({ credentialId: 'k-1' });
      await screen.findByDisplayValue('Integration');
      mockApi.getCredential.mockClear();
      arrangeRead();
      await user.click(screen.getByTestId('api-key-regenerate'));
      await user.click(screen.getByTestId('api-key-regenerate-confirm'));

      await waitFor(() =>
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ text: t.regenerateError, type: 'error' }),
        ),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(mockApi.getCredential).toHaveBeenCalledWith('token', owner, 'k-1'),
      );
      await act(async () => {
        await Promise.resolve();
      });

      if (expected === 'enabled') {
        expect(screen.getByTestId('api-key-regenerate')).toBeEnabled();
      } else {
        expect(screen.getByTestId('api-key-regenerate')).toBeDisabled();
      }
    },
  );

  it('says so when the key cannot be read', async () => {
    mockApi.getCredential.mockRejectedValue(new Error('404'));
    renderForm({ credentialId: 'k-1' });
    expect(await screen.findByTestId('api-key-load-error')).toBeInTheDocument();
  });
});
