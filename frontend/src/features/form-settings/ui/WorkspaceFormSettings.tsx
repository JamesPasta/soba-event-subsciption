'use client';

import { AccordionGroup } from '@bcgov/design-system-react-components';
import type { Dictionary } from '@/src/types/dictionary';
import { useWorkspaceSettingsSections } from '../data/sections';

/** A workspace's Form Settings tab: a drawer for each of its sections. */
export default function WorkspaceFormSettings({
  dict,
  workspaceId,
}: Readonly<{ dict: Dictionary; workspaceId: string }>) {
  const sections = useWorkspaceSettingsSections();
  return (
    <>
      <p data-testid="workspace-form-settings-intro">{dict.workspaces.formSettingsIntro}</p>
      <AccordionGroup
        allowsMultipleExpanded={false}
        defaultExpandedKeys={sections[0] ? [sections[0].id] : []}
      >
        {sections.map(({ id, Drawer }) => (
          <Drawer key={id} drawerName={id} dict={dict} workspaceId={workspaceId} />
        ))}
      </AccordionGroup>
    </>
  );
}
