'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, Heading, InlineAlert } from '@bcgov/design-system-react-components';
import styles from './WorkspaceForm.module.css';

interface TabFormSectionProps {
  heading: string;
  testId: string;
  children: ReactNode;
}

/** A create or edit form opened under a tab's table. */
export function TabFormSection({ heading, testId, children }: Readonly<TabFormSectionProps>) {
  const sectionRef = useRevealOnOpen();
  const headingId = useId();
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="mt-4 pt-3 border-top"
      data-testid={testId}
    >
      <Heading level={2} id={headingId}>
        {heading}
      </Heading>
      {children}
    </section>
  );
}

/**
 * The form opens under the table, which on a long list is below the fold. Bring it into view and
 * move focus to it, so the press visibly did something and a keyboard or screen reader user lands
 * on it rather than on the button above. Runs once per opening: the tab remounts the form for each.
 */
function useRevealOnOpen() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Optional: jsdom has no layout, so no scrollIntoView.
    element.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, []);
  return ref;
}

interface TabFormUnavailableProps {
  message: string;
  testId: string;
  cancelLabel: string;
  cancelTestId: string;
  onCancel: () => void;
}

/** What the form shows instead of its fields when something it needs failed to load. */
export function TabFormUnavailable({
  message,
  testId,
  cancelLabel,
  cancelTestId,
  onCancel,
}: Readonly<TabFormUnavailableProps>) {
  return (
    <>
      <InlineAlert description={message} variant="danger" data-testid={testId} />
      <div className={styles.actions}>
        <Button variant="secondary" onPress={onCancel} data-testid={cancelTestId}>
          {cancelLabel}
        </Button>
      </div>
    </>
  );
}
