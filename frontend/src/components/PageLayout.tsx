import type { CSSProperties, ReactNode } from 'react';
import { PageHeaderProvider } from './PageHeader';
import styles from './PageLayout.module.css';

export type PageWidth = 'narrow' | 'default' | 'wide';

// The default is shared with the header and footer, which stop their content at the same edge.
const MAX_WIDTH: Record<PageWidth, string> = {
  narrow: '45rem',
  default: 'var(--app-page-max-width)',
  wide: '90rem',
};

// CSSProperties admits no custom properties.
const columnStyle = (width: PageWidth) =>
  ({ '--page-max-width': MAX_WIDTH[width] }) as CSSProperties;

type PageLayoutProps = {
  /** Referenced by aria-labelledby, so it must match the heading the layout renders. */
  headingId: string;
  /** Stands until a client child registers its own through usePageHeading. */
  heading: string;
  width?: PageWidth;
  children: ReactNode;
};

/** The content column PageLayout sits in, for states rendered before a page mounts. */
export function PageColumn({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles.page} style={columnStyle('default')}>
      {children}
    </div>
  );
}

/**
 * The page shell: owns content width and the heading block. Pages pass content, never arrangement,
 * so every page keeps the same rhythm.
 */
export function PageLayout({
  headingId,
  heading,
  width = 'default',
  children,
}: Readonly<PageLayoutProps>) {
  return (
    <section className={styles.page} style={columnStyle(width)} aria-labelledby={headingId}>
      <PageHeaderProvider headingId={headingId} heading={heading}>
        {children}
      </PageHeaderProvider>
    </section>
  );
}
