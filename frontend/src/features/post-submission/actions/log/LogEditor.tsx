'use client';

import { Checkbox, TextField } from '@bcgov/design-system-react-components';

import type { ActionEditorProps } from '@/src/features/post-submission/actions/types';
import { POST_SUBMISSION_LOG_NOTE_MAX } from '@/src/types/postSubmission';
import styles from '../fields.module.css';
import { noteOf, withNote } from './note';

/** The log action's fields: whether it logs, and an optional note. */
export default function LogEditor({ dict, values, onChange, isDisabled }: ActionEditorProps) {
  const t = dict.postSubmission.log;
  return (
    <div className={styles.fields}>
      <Checkbox
        isSelected={values.enabled}
        onChange={(enabled) => onChange({ ...values, enabled })}
        isDisabled={isDisabled}
        data-testid="post-submission-log-enabled"
      >
        {t.enabled}
      </Checkbox>
      <TextField
        label={t.note}
        description={t.noteHelp.replace('{max}', String(POST_SUBMISSION_LOG_NOTE_MAX))}
        value={noteOf(values)}
        onChange={(note) => onChange(withNote(values, note))}
        maxLength={POST_SUBMISSION_LOG_NOTE_MAX}
        isDisabled={isDisabled}
        data-testid="post-submission-log-note"
      />
    </div>
  );
}
