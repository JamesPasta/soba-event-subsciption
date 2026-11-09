'use client';

import { useRef, useState } from 'react';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import { useWorkspaceSettings } from '@/src/features/form-settings/data/useWorkspaceSettings';
import type {
  ActionEditorHandle,
  PostSubmissionActionUi,
} from '@/src/features/post-submission/actions/types';
import type { Dictionary } from '@/src/types/dictionary';
import {
  POST_SUBMISSION_SETTINGS_KEY,
  type PostSubmissionActionValues,
} from '@/src/types/postSubmission';
import ActionDrawerIntro from './ActionDrawerIntro';
import { useActionDrawer } from './useActionDrawer';

/** One action on a workspace's After Submission tab: the values its forms use unless they set their own. */
export default function WorkspaceActionDrawer({
  dict,
  workspaceId,
  code,
  ui,
}: Readonly<{
  dict: Dictionary;
  workspaceId: string;
  code: string;
  ui: PostSubmissionActionUi;
}>) {
  const id = code;
  const { settings, error, save } = useWorkspaceSettings<PostSubmissionActionValues>(
    `${POST_SUBMISSION_SETTINGS_KEY}/${code}`,
    workspaceId,
  );
  const [edited, setEdited] = useState<PostSubmissionActionValues | null>(null);
  const drawer = useActionDrawer(dict, () => setEdited(null));
  const editor = useRef<ActionEditorHandle>(null);
  const { Editor } = ui;

  const values = edited ?? settings?.values ?? null;
  const problem = values ? ui.problem(values, dict) : null;
  const canSave =
    !!settings &&
    (edited !== null || drawer.pending) &&
    !drawer.saving &&
    !drawer.invalid &&
    (!problem || drawer.pending);

  const saveChanges = () => {
    if (!settings) return;
    // Text still in the fields is added first; text that cannot be saved stops the save there.
    const current = editor.current ? editor.current.commitText() : values;
    if (!current || ui.problem(current, dict)) return;
    void drawer.run((token) =>
      save(token, { values: ui.saved(current), version: settings.version }),
    );
  };

  return (
    <FormSettingsDrawers
      dict={dict}
      id={id}
      label={ui.label(dict)}
      onSave={saveChanges}
      onCancel={drawer.reset}
      canSave={canSave}
    >
      <ActionDrawerIntro dict={dict} id={id} description={ui.description(dict)} error={error} />
      {values && (
        <Editor
          key={drawer.editorKey}
          ref={editor}
          dict={dict}
          values={values}
          onChange={setEdited}
          isDisabled={drawer.saving}
          onFieldStateChange={drawer.setFieldState}
          problem={problem}
        />
      )}
    </FormSettingsDrawers>
  );
}
