'use client';

import { statusText } from '@/src/features/post-submission/actions/status';
import type { ActionViewProps } from '@/src/features/post-submission/actions/types';
import styles from '../fields.module.css';
import { addressesOf } from './addresses';

/** The email action's values read-only: whether it sends, and its recipients as a plain list. */
export default function EmailAddressesView({ dict, values }: ActionViewProps) {
  const t = dict.postSubmission;
  const addresses = addressesOf(values);
  return (
    <div className={styles.fields} data-testid="post-submission-email-view">
      <p>{statusText(dict, values.enabled)}</p>
      <div>
        <p>{t.email.recipients}</p>
        {addresses.length > 0 ? (
          <ul className={styles.list} data-testid="post-submission-email-view-list">
            {addresses.map((address) => (
              <li key={address}>{address}</li>
            ))}
          </ul>
        ) : (
          <p>{t.email.none}</p>
        )}
      </div>
    </div>
  );
}
