import { render, screen } from '@testing-library/react';
import { AccordionGroup } from '@bcgov/design-system-react-components';
import { describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';
import FormApiKeyDrawer from '@/src/features/form-settings/credentials/FormApiKeyDrawer';
import WorkspaceApiKeyDrawer from '@/src/features/form-settings/credentials/WorkspaceApiKeyDrawer';

vi.mock('@/src/features/credentials/ui/ApiKeysTab', () => ({
  default: ({ owner }: { owner: { kind: string; id: string } }) => (
    <p data-testid="credential-owner">
      {owner.kind}:{owner.id}
    </p>
  ),
}));

describe('API key settings drawers', () => {
  it("shows the form's keys from form Settings", () => {
    render(
      <AccordionGroup defaultExpandedKeys={['form-api-keys']}>
        <FormApiKeyDrawer dict={en} drawerName="form-api-keys" formId="form" />
      </AccordionGroup>,
    );
    expect(screen.getByTestId('credential-owner')).toHaveTextContent('form:form');
    expect(screen.getByText(en.apiKeys.formScope)).toBeInTheDocument();
  });
  it("shows the workspace's keys from Workspace Form Settings", () => {
    render(
      <AccordionGroup defaultExpandedKeys={['workspace-api-keys']}>
        <WorkspaceApiKeyDrawer dict={en} drawerName="workspace-api-keys" workspaceId="workspace" />
      </AccordionGroup>,
    );
    expect(screen.getByTestId('credential-owner')).toHaveTextContent('workspace:workspace');
    expect(screen.getByText(en.apiKeys.workspaceScope)).toBeInTheDocument();
  });
});
