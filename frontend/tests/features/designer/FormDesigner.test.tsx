import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { useKeycloak as useKeycloakHook } from '@/lib/hooks/useKeycloak';

// Use a mutable keycloakState so tests can set it per-case.
let keycloakState: Partial<ReturnType<typeof useKeycloakHook>> = {
  authenticated: false,
  initializing: true,
};
vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => keycloakState,
}));

// The props the designer hands the Form.io builder.
const builder = vi.hoisted(() => ({
  props: null as { initialForm?: unknown; options?: Record<string, unknown> } | null,
}));
vi.mock('@formio/react', () => ({
  FormBuilder: (props: { initialForm?: unknown; options?: Record<string, unknown> }) => {
    builder.props = props;
    return <div data-testid="formio-builder" />;
  },
}));
vi.mock('@/src/features/formio-v5/registerBcgovFormio', () => ({
  ensureBcgovFormioRegistered: () => Promise.resolve({ filesEnabled: false }),
}));
vi.mock('@/lib/hooks/useFormioV5FormChrome', () => ({
  useFormioV5FormChrome: () => undefined,
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    form: {},
    general: { loading: 'Loading…', loginRequired: 'Login Required' },
  }),
}));

import makeStore from '@/lib/store';
import FormDesigner from '@/src/features/designer/ui/FormDesigner';

let store: ReturnType<typeof makeStore>;

function renderDesigner() {
  return render(
    <Provider store={store}>
      <FormDesigner onUpdateModel={() => {}} initialModel={null} />
    </Provider>,
  );
}

describe('FormDesigner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
  });

  it('shows the loading indicator when initializing', () => {
    keycloakState = { authenticated: false, initializing: true };
    renderDesigner();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows login required when not authenticated', () => {
    keycloakState = { authenticated: false, initializing: false };
    renderDesigner();
    expect(screen.getByText('Login Required')).toBeInTheDocument();
  });

  // The builder's own default Submit would be drawn but never saved.
  it('starts an empty model from a Submit button and turns off the builder default', async () => {
    keycloakState = { authenticated: true, initializing: false, token: 'token' };
    renderDesigner();

    await screen.findByTestId('formio-builder');
    expect(builder.props?.options).toMatchObject({ noDefaultSubmitButton: true });
    expect(builder.props?.initialForm).toEqual({
      components: [expect.objectContaining({ type: 'button', key: 'submit', action: 'submit' })],
    });
  });
});
