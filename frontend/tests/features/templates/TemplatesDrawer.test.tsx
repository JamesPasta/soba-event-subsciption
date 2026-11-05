import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import { Permissions } from '@/src/types/permissions';

const { state } = vi.hoisted(() => ({
  state: { formRead: true, permissions: [] as string[], types: ['print'] as string[] | null },
}));

const TEMPLATE = {
  id: 'tmpl-1',
  name: 'Receipt',
  type: 'print',
  formVersionNo: 1,
  filename: 'receipt.docx',
  size: 2048,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const dict = { ...en, locale: 'en' } as unknown as Dictionary;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: vi.fn() }),
}));

vi.mock('@/src/shared/hooks/useFormatLongDate', () => ({
  useFormatLongDate: () => (value: string) => value,
}));

vi.mock('@/src/features/designer/data/useForm', () => ({
  useForm: () => ({
    form: state.formRead ? { workspaceId: 'ws-1', permissions: state.permissions } : undefined,
    currentVersion: { id: 'v-1' },
    versions: [],
    versionsTruncated: false,
    versionsLimit: 100,
  }),
}));

vi.mock('@/src/features/templates/data/useTemplates', () => ({
  useTemplates: () => ({
    templates: [TEMPLATE],
    isLoading: false,
    error: null,
    upload: vi.fn(),
    replace: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));

vi.mock('@/src/features/templates/data/useTemplateTypes', () => ({
  useTemplateTypes: () => state.types,
}));

vi.mock('@/src/features/templates/ui/TemplateUploadForm', () => ({
  TemplateUploadForm: () => <div data-testid="template-upload-form" />,
}));

import TemplatesDrawer from '@/src/features/templates/ui/TemplatesDrawer';

const renderDrawer = () =>
  render(<TemplatesDrawer dict={dict} drawerName="templates" formId="form-1" />);

describe('TemplatesDrawer', () => {
  beforeEach(() => {
    state.formRead = true;
    state.permissions = [Permissions.form_read, Permissions.document_template_read];
    state.types = ['print'];
  });

  it('offers no upload or delete until the form, with its permissions, is read', () => {
    state.formRead = false;
    state.permissions = [Permissions.all];
    renderDrawer();
    expect(screen.queryByTestId('template-upload-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-tmpl-1-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-no-types')).not.toBeInTheDocument();
  });

  it('offers no upload or delete to someone who can only read templates', () => {
    renderDrawer();
    expect(screen.queryByTestId('template-upload-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-tmpl-1-delete')).not.toBeInTheDocument();
    expect(screen.getByTestId('template-tmpl-1-download')).toBeInTheDocument();
  });

  it('offers upload to a holder of document_template_create only', () => {
    state.permissions.push(Permissions.document_template_create);
    renderDrawer();
    expect(screen.getByTestId('template-upload-form')).toBeInTheDocument();
    expect(screen.queryByTestId('template-tmpl-1-delete')).not.toBeInTheDocument();
  });

  it('offers delete to a holder of document_template_delete only', () => {
    state.permissions.push(Permissions.document_template_delete);
    renderDrawer();
    expect(screen.getByTestId('template-tmpl-1-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('template-upload-form')).not.toBeInTheDocument();
  });

  it('offers both to a holder of the wildcard', () => {
    state.permissions = [Permissions.all];
    renderDrawer();
    expect(screen.getByTestId('template-upload-form')).toBeInTheDocument();
    expect(screen.getByTestId('template-tmpl-1-delete')).toBeInTheDocument();
  });

  it('only tells someone who could upload that no types are available', () => {
    state.types = [];
    const { unmount } = renderDrawer();
    expect(screen.queryByTestId('template-no-types')).not.toBeInTheDocument();
    unmount();

    state.permissions.push(Permissions.document_template_create);
    renderDrawer();
    expect(screen.getByTestId('template-no-types')).toBeInTheDocument();
  });
});
