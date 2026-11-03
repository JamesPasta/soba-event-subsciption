'use client';

import { Accordion } from '@bcgov/design-system-react-components';
import ApiKeysTab from '@/src/features/credentials/ui/ApiKeysTab';
import type { WorkspaceSettingsSectionProps } from '../types';

export default function WorkspaceApiKeyDrawer({
  dict,
  drawerName,
  workspaceId,
}: WorkspaceSettingsSectionProps) {
  return (
    <Accordion id={drawerName} data-testid={`accordion-${drawerName}`} label={dict.apiKeys.heading}>
      <div className="d-block w-100">
        <p>{dict.apiKeys.workspaceScope}</p>
        <ApiKeysTab key={workspaceId} dict={dict} owner={{ kind: 'workspace', id: workspaceId }} />
      </div>
    </Accordion>
  );
}
