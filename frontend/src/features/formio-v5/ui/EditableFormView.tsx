'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FormType, Submission } from '@formio/react';
import { withFilesReadOnly } from '@/src/features/formio-v5/filesReadOnly';
import { DynamicForm } from './DynamicForm';
import styles from './EditableFormView.module.css';

/** What an editor reads of the live webform. */
export type EditableFormInstance = {
  data: Record<string, unknown>;
  /** With `dirty`, marks the invalid fields as well as reporting them. */
  checkValidity: (data: Record<string, unknown>, dirty: boolean) => boolean;
  /** Form.io's blur, scheduled to run a moment after a field loses focus. */
  pendingBlur?: { cancel?: () => void } | null;
};

/**
 * Render a form schema editable with a given submission, reporting each change of its answers. It
 * has no submit of its own: staff save through their own Update, and the server validates. Form.io
 * writes to the submission it is given, so `submission` must be this form's own copy, and rebuilds
 * the webform when `onFormReady` changes, so that must be stable.
 */
export function EditableFormView({
  schema,
  submission,
  onDataChange,
  onFormReady,
  testId,
}: Readonly<{
  schema: FormType;
  submission: Submission;
  onDataChange: (data: Record<string, unknown>) => void;
  onFormReady?: (instance: EditableFormInstance) => void;
  testId?: string;
}>) {
  // Stable, so the webform is not rebuilt as the answers change.
  const options = useMemo(() => ({ readOnly: false, noAlerts: true }), []);
  const form = useMemo(() => withFilesReadOnly(schema), [schema]);
  const instance = useRef<EditableFormInstance | null>(null);
  // Whether the user has acted in the form. Form.io changes the answers itself as they load, and
  // leaves `modified` off for some real edits, such as removing a grid row, so neither the flag nor
  // a comparison with the loaded answers says what the user changed.
  const touched = useRef(false);
  const markTouched = useCallback(() => {
    touched.current = true;
  }, []);

  // A field that loses focus as the form unmounts leaves Form.io a blur to run a moment later on the
  // destroyed webform, where it throws.
  useEffect(() => {
    const current = instance;
    return () => current.current?.pendingBlur?.cancel?.();
  }, []);

  const handleFormReady = useCallback(
    (webform: unknown) => {
      const ready = webform as EditableFormInstance;
      instance.current = ready;
      onFormReady?.(ready);
    },
    [onFormReady],
  );

  return (
    <div
      className={`formio-v5-chrome ${styles.editing}`}
      data-soba-formio-chrome
      data-testid={testId}
      onPointerDownCapture={markTouched}
      onKeyDownCapture={markTouched}
    >
      <DynamicForm
        className="formio-v5-form-root"
        src=""
        form={form}
        submission={submission}
        options={options}
        onFormReady={handleFormReady}
        onChange={(
          value: { data?: Record<string, unknown> },
          _flags: unknown,
          modified: boolean,
        ) => {
          if (value?.data && (modified || touched.current)) onDataChange(value.data);
        }}
      />
    </div>
  );
}
