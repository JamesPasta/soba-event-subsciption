'use client';

import React from 'react';
import { Button } from '@bcgov/design-system-react-components';
import styles from './RowActionButton.module.css';

type RowActionButtonProps = {
  /** Marks the row's primary/default action (e.g. the form name or submission id). */
  main?: boolean;
  danger?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  'aria-label'?: string;
  'data-testid'?: string;
};

/**
 * Compact link-style button for table cells. Both tables use this so their
 * clickable cells look and behave the same. `main` marks the row's primary
 * action (rendered bolder) to set it apart from the secondary actions.
 *
 * The differentiator lives on a wrapper span: the BCDS Button manages its own
 * className and overwrites any passed in, so it can't be styled directly.
 */
export function RowActionButton({
  main = false,
  danger = false,
  isDisabled,
  onPress,
  children,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: Readonly<RowActionButtonProps>) {
  return (
    <span className={main ? styles.main : undefined}>
      <Button
        variant="link"
        danger={danger}
        size="small"
        aria-label={ariaLabel}
        data-testid={testId}
        isDisabled={isDisabled}
        onPress={onPress}
      >
        {children}
      </Button>
    </span>
  );
}
