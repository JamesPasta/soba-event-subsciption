'use client';

import { Select } from '@bcgov/design-system-react-components';

export type WorkspaceSelectorItem = { id: string; name: string; kind: string };

export function WorkspaceSelector({
  workspaces,
  selectedWorkspaceId,
  label,
  onChange,
  size = 'small',
  allLabel,
  description,
  className = '',
  isRequired = false,
}: Readonly<{
  workspaces: WorkspaceSelectorItem[];
  className?: string;
  selectedWorkspaceId: string | null;
  label: string;
  size?: 'small' | 'medium';
  /** When set, prepends an option covering every workspace, which selects null. */
  allLabel?: string;
  description?: string;
  isRequired?: boolean;
  onChange: (key: string | number | null) => void;
}>) {
  return (
    <Select
      size={size}
      id="workspace-select"
      data-testid="workspace-select"
      label={label}
      description={description}
      className={`mr-2 ${className}`}
      isRequired={isRequired}
      selectedKey={selectedWorkspaceId || (allLabel ? 'all' : null)}
      onSelectionChange={(key) => onChange(key === 'all' ? null : key)}
      items={[
        ...(allLabel ? [{ id: 'all', label: allLabel }] : []),
        ...workspaces.map((ws) => ({ id: ws.id, label: `${ws.name} (${ws.kind})` })),
      ]}
    />
  );
}
