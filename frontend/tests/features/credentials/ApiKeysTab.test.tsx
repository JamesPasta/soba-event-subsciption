import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import type { CredentialMetadata, CredentialOwner, CredentialState } from '@/src/types/credentials';
import { renderSignedIn } from '../workspaces/workspaceGroupsTestKit';

const { mockApi, mockAddNotification } = vi.hoisted(() => ({
  mockApi: {
    listCredentials: vi.fn(),
    getCredential: vi.fn(),
    issueCredential: vi.fn(),
    updateCredential: vi.fn(),
    regenerateCredential: vi.fn(),
    deleteCredential: vi.fn(),
  },
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/credentials/data/api', () => mockApi);
vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

const dict = { ...en, locale: 'en' } as unknown as Dictionary;
const t = dict.apiKeys;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/workspace/ws-1',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import ApiKeysTab from '@/src/features/credentials/ui/ApiKeysTab';

const key = (overrides: Partial<CredentialMetadata> & { id: string }): CredentialMetadata => ({
  scope: 'workspace',
  label: overrides.id,
  notes: '',
  types: ['api'],
  status: 'active',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  rotatedAt: null,
  ...overrides,
});
const state = (items: CredentialMetadata[], available = true): CredentialState => ({
  available,
  items,
  page: { offset: 0, limit: 10, total: items.length },
  filters: {},
  sort: 'createdAt:desc',
});
const workspace: CredentialOwner = { kind: 'workspace', id: 'ws-1' };
const form: CredentialOwner = { kind: 'form', id: 'form-1' };

const renderTab = (owner = workspace, cache = new Map()) =>
  renderSignedIn(<ApiKeysTab dict={dict} owner={owner} />, { cache });

async function generateNewKey(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('api-key-add'));
  await user.type(screen.getByRole('textbox', { name: new RegExp(t.label) }), 'New');
  await user.click(screen.getByTestId('api-key-type-api'));
  await user.click(screen.getByTestId('api-key-generate'));
}

describe('ApiKeysTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/en/workspace/ws-1');
    window.sessionStorage.clear();
    mockApi.listCredentials.mockResolvedValue(
      state([
        key({ id: 'k-active', label: 'Integration', types: ['api', 'web-component'] }),
        key({ id: 'k-unknown', status: 'unknown' }),
        key({ id: 'k-failed', status: 'failed' }),
      ]),
    );
  });

  it("reads the owner's keys and offers Edit, and Delete only where it can settle", async () => {
    renderTab();
    expect(await screen.findByTestId('api-key-label-k-active')).toHaveTextContent('Integration');
    expect(mockApi.listCredentials).toHaveBeenCalledWith('token', workspace, {
      offset: 0,
      limit: 10,
      sort: 'createdAt:desc',
      q: '',
      locale: 'en',
    });
    expect(screen.getByText(`${t.apiAccess}, ${t.webComponents}`)).toBeInTheDocument();
    expect(screen.getByTestId('api-key-status-k-unknown')).toHaveTextContent(t.statuses.unknown);
    expect(screen.getByTestId('api-key-status-k-failed')).toHaveTextContent(t.statuses.failed);
    for (const id of ['k-active', 'k-unknown', 'k-failed']) {
      expect(screen.getByTestId(`api-key-edit-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('api-key-delete-k-active')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-delete-k-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('api-key-delete-k-unknown')).not.toBeInTheDocument();
    // Workspace keys need no Belongs to column on the workspace's own drawer.
    expect(screen.queryByText(t.columns.scope)).not.toBeInTheDocument();
  });

  it("shows a form its workspace's keys read-only beside its own", async () => {
    mockApi.listCredentials.mockResolvedValue(
      state([key({ id: 'k-ws', label: 'Shared' }), key({ id: 'k-form', scope: 'form' })]),
    );
    renderTab(form);
    await screen.findByTestId('api-key-label-k-ws');
    expect(mockApi.listCredentials).toHaveBeenCalledWith('token', form, expect.anything());
    expect(screen.getByText(t.columns.scope)).toBeInTheDocument();
    expect(screen.getByText(t.scopeWorkspace)).toBeInTheDocument();
    expect(screen.getByText(t.scopeForm)).toBeInTheDocument();
    expect(screen.queryByTestId('api-key-edit-k-ws')).not.toBeInTheDocument();
    expect(screen.queryByTestId('api-key-delete-k-ws')).not.toBeInTheDocument();
    expect(screen.getByTestId('api-key-edit-k-form')).toBeInTheDocument();
    expect(screen.getByTestId('api-key-delete-k-form')).toBeInTheDocument();
  });

  it('says generation is unavailable and holds Add off', async () => {
    mockApi.listCredentials.mockResolvedValue(state([], false));
    renderTab();
    expect(await screen.findByTestId('api-key-unavailable')).toHaveTextContent(t.unavailable);
    expect(screen.getByTestId('api-key-add')).toBeDisabled();
  });

  it('deletes an active key once confirmed, warning that its consumer stays, then re-reads', async () => {
    const user = userEvent.setup();
    mockApi.deleteCredential.mockResolvedValue(undefined);
    renderTab();
    await user.click(await screen.findByTestId('api-key-delete-k-active'));
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
      t.deleteConfirmMessage.replace('{label}', 'Integration'),
    );
    const reads = mockApi.listCredentials.mock.calls.length;
    await user.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() =>
      expect(mockApi.deleteCredential).toHaveBeenCalledWith('token', workspace, 'k-active'),
    );
    expect(mockAddNotification).toHaveBeenCalledWith({ text: t.deleteSuccess, type: 'success' });
    await waitFor(() => expect(mockApi.listCredentials.mock.calls.length).toBeGreaterThan(reads));
  });

  it('tells the owner a failed key had nothing generated', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('api-key-delete-k-failed'));
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
      t.deleteFailedConfirmMessage.replace('{label}', 'k-failed'),
    );
  });

  it('keeps the dialog and reports a refused delete', async () => {
    const user = userEvent.setup();
    mockApi.deleteCredential.mockRejectedValue(new Error('409'));
    renderTab();
    await user.click(await screen.findByTestId('api-key-delete-k-active'));
    await user.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ text: t.deleteError, type: 'error' }),
      ),
    );
    expect(screen.getByTestId('confirm-modal-message')).toBeInTheDocument();
  });

  it.each([
    ['saved', 'api-key-save'],
    ['cancelled', 'api-key-cancel'],
  ])('holds Add and row actions off until a new key is %s', async (_name, finishTestId) => {
    const user = userEvent.setup();
    mockApi.issueCredential.mockResolvedValue({
      credential: key({ id: 'k-new', label: 'New' }),
      apiKey: 'shown-once',
    });
    renderTab();
    await generateNewKey(user);
    await screen.findByDisplayValue('shown-once');
    expect(screen.getByTestId('api-key-add')).toBeDisabled();
    expect(screen.getByTestId('api-key-edit-k-active')).toBeDisabled();
    expect(screen.getByTestId('api-key-delete-k-active')).toBeDisabled();

    // Closing the modal leaves the new key unsaved in the form, still held.
    await user.click(screen.getByTestId('api-key-done'));
    expect(screen.getByTestId('api-key-delete-k-active')).toBeDisabled();

    await user.click(screen.getByTestId(finishTestId));
    await waitFor(() => expect(screen.getByTestId('api-key-add')).toBeEnabled());
    expect(screen.getByTestId('api-key-edit-k-active')).toBeEnabled();
    expect(screen.getByTestId('api-key-delete-k-active')).toBeEnabled();
  });

  it('shows a new key while the list re-read is still running', async () => {
    const user = userEvent.setup();
    mockApi.issueCredential.mockResolvedValue({
      credential: key({ id: 'k-new', label: 'New' }),
      apiKey: 'shown-once',
    });
    renderTab();
    await screen.findByTestId('api-key-label-k-active');
    const reads = mockApi.listCredentials.mock.calls.length;
    mockApi.listCredentials.mockReturnValue(new Promise(() => undefined));
    await generateNewKey(user);
    expect(await screen.findByDisplayValue('shown-once')).toBeInTheDocument();
    await waitFor(() => expect(mockApi.listCredentials.mock.calls.length).toBeGreaterThan(reads));
  });

  it('keeps a generated key out of the cache, with the list mounted', async () => {
    const user = userEvent.setup();
    const cache = new Map();
    mockApi.issueCredential.mockResolvedValue({
      credential: key({ id: 'k-new', label: 'New' }),
      apiKey: 'shown-once',
    });
    renderTab(workspace, cache);
    await screen.findByTestId('api-key-label-k-active');
    const reads = mockApi.listCredentials.mock.calls.length;
    await generateNewKey(user);
    await screen.findByDisplayValue('shown-once');
    await waitFor(() => expect(mockApi.listCredentials.mock.calls.length).toBeGreaterThan(reads));
    expect(cache.size).toBeGreaterThan(0);
    for (const [cacheKey, value] of cache) {
      expect(JSON.stringify([cacheKey, value])).not.toContain('shown-once');
    }
  });

  it('opens the add form under the table, and the edit form for a row', async () => {
    const user = userEvent.setup();
    mockApi.getCredential.mockResolvedValue(key({ id: 'k-active', label: 'Integration' }));
    renderTab();
    await user.click(await screen.findByTestId('api-key-add'));
    expect(screen.getByTestId('api-key-create-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('api-key-edit-k-active'));
    expect(await screen.findByTestId('api-key-edit-form')).toBeInTheDocument();
    expect(mockApi.getCredential).toHaveBeenCalledWith('token', workspace, 'k-active');
  });
});
