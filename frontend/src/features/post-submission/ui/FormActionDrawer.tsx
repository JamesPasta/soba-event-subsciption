'use client';

import { useMemo, useRef } from 'react';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import InheritCheckbox from '@/src/features/form-settings/ui/InheritCheckbox';
import { useInheritableEdit } from '@/src/features/form-settings/ui/useInheritableEdit';
import { useFormSettings } from '@/src/features/form-settings/data/useFormSettings';
import type {
  ActionEditorHandle,
  PostSubmissionActionUi,
} from '@/src/features/post-submission/actions/types';
import type { Dictionary } from '@/src/types/dictionary';
import {
  POST_SUBMISSION_SETTINGS_KEY,
  type PostSubmissionActionValues,
  type PostSubmissionFormActionList,
  type PostSubmissionFormActionSettings,
  type SetPostSubmissionFormActionBody,
} from '@/src/types/postSubmission';
import ActionDrawerIntro from './ActionDrawerIntro';
import ReadOnlyActionDrawer from './ReadOnlyActionDrawer';
import { useActionDrawer } from './useActionDrawer';

type FormActionItem = PostSubmissionFormActionList['actions'][number];

/**
 * One action on a form's After Submission tab. The form uses the workspace's values or its own
 * when the workspace can set the action; it keeps its own when only the form can; an action set for
 * the workspace only is shown here read-only.
 */
export default function FormActionDrawer({
  dict,
  formId,
  action,
  ui,
}: Readonly<{
  dict: Dictionary;
  formId: string;
  action: FormActionItem;
  ui: PostSubmissionActionUi;
}>) {
  const t = dict.postSubmission;
  const id = action.code;
  const { settings, error, save } = useFormSettings<
    PostSubmissionFormActionSettings,
    SetPostSubmissionFormActionBody
  >(`${POST_SUBMISSION_SETTINGS_KEY}/${action.code}`, formId);

  const workspaceOnly = !action.scopes.includes('form');
  const canInherit = !workspaceOnly && action.workspaceConfigurable;
  // A form that cannot use the workspace's values edits its own from the start.
  const editable = useMemo(
    () => (settings && !canInherit ? { ...settings, inherit: false } : settings),
    [settings, canInherit],
  );
  const edit = useInheritableEdit<PostSubmissionActionValues>(editable);
  const drawer = useActionDrawer(dict, edit.reset);
  const editor = useRef<ActionEditorHandle>(null);
  const { Editor, View } = ui;

  if (workspaceOnly) {
    return (
      <ReadOnlyActionDrawer id={id} label={ui.label(dict)}>
        <ActionDrawerIntro dict={dict} id={id} description={ui.description(dict)} error={error} />
        {settings && <View dict={dict} values={settings.effective} />}
        <p data-testid={`${id}-workspace-only`}>{t.workspaceOnlyNote}</p>
      </ReadOnlyActionDrawer>
    );
  }

  // The workspace cannot set the action, so the form sets it alone. Until the form saves its own,
  // nothing is stored for it: it would follow the workspace if the workspace were given the action.
  const formOnly = !canInherit && action.scopes.includes('workspace');
  const unsaved = formOnly && !!settings?.inherit;
  const values = edit.values;
  const problem = values && !edit.inherit ? ui.problem(values, dict) : null;
  const canSave =
    !!settings &&
    (edit.changed || drawer.pending || unsaved) &&
    !drawer.saving &&
    !drawer.invalid &&
    (!problem || drawer.pending);

  const saveChanges = () => {
    if (!settings) return;
    const version = settings.version;
    if (edit.inherit) {
      void drawer.run((token) => save(token, { inherit: true, version }));
      return;
    }
    // Text still in the fields is added first; text that cannot be saved stops the save there.
    const current = editor.current ? editor.current.commitText() : values;
    if (!current || ui.problem(current, dict)) return;
    void drawer.run((token) => save(token, { inherit: false, values: ui.saved(current), version }));
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
      {canInherit && (
        <InheritCheckbox
          label={dict.form.settings.inheritWorkspaceLabel}
          isSelected={edit.inherit}
          onChange={(inherit) => {
            edit.setInherit(inherit);
            // The fields come and go with the choice, and their text with them.
            drawer.setFieldState('clear');
          }}
          isDisabled={drawer.saving || !settings}
          testId={`${id}-inherit`}
        />
      )}
      {formOnly && (
        <div data-testid={`${id}-form-only`}>
          <p>{t.formOnlyNote}</p>
          {unsaved && <p data-testid={`${id}-unsaved`}>{t.formOnlyUnsaved}</p>}
        </div>
      )}
      {values &&
        (edit.inherit ? (
          <View dict={dict} values={values} />
        ) : (
          <Editor
            key={drawer.editorKey}
            ref={editor}
            dict={dict}
            values={values}
            onChange={edit.setValues}
            isDisabled={drawer.saving}
            onFieldStateChange={drawer.setFieldState}
            problem={problem}
          />
        ))}
    </FormSettingsDrawers>
  );
}
