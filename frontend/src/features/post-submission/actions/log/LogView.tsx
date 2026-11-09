'use client';

import { statusText } from '@/src/features/post-submission/actions/status';
import type { ActionViewProps } from '@/src/features/post-submission/actions/types';
import styles from '../fields.module.css';
import { noteOf } from './note';

/** The log action's values read-only. */
export default function LogView({ dict, values }: ActionViewProps) {
  const note = noteOf(values);
  return (
    <div className={styles.fields} data-testid="post-submission-log-view">
      <p>{statusText(dict, values.enabled)}</p>
      {note && <p>{dict.postSubmission.log.noteValue.replace('{note}', note)}</p>}
    </div>
  );
}
