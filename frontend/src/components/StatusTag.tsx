'use client';

import { Tag, type TagColor } from './Tag';
import {
  SubmissionWorkflowState,
  SubmitterReviewLabels,
  type SubmitterReviewLabel,
} from '@/src/types/submissions';

export type StatusTagVariant = 'primary' | 'info' | 'neutral' | 'success' | 'warning';

const VARIANT_COLORS: Record<StatusTagVariant, TagColor> = {
  primary: 'bcBlue',
  info: 'blue',
  neutral: 'grey',
  success: 'green',
  warning: 'yellow',
};

type StatusTagProps = {
  label: string;
  variant?: StatusTagVariant;
  'data-testid'?: string;
};

/**
 * Status/role pill for table cells. Shared by workspace roles and submission workflow states so
 * they look identical across list pages.
 */
export function StatusTag({
  label,
  variant = 'neutral',
  'data-testid': testId,
}: Readonly<StatusTagProps>) {
  return <Tag text={label} color={VARIANT_COLORS[variant]} shape="circular" data-testid={testId} />;
}

export function workspaceRoleToVariant(role?: string): StatusTagVariant {
  const normalized = (role || '').toLowerCase();
  if (normalized === 'owner') return 'primary';
  if (normalized === 'admin') return 'info';
  return 'neutral';
}

const WORKFLOW_STATE_VARIANTS: Readonly<Record<string, StatusTagVariant>> = {
  [SubmissionWorkflowState.submitted]: 'success',
  [SubmissionWorkflowState.revising]: 'warning',
};

/** A workflow state's colour; a review status reads the same, as Submitted and Revising do. */
export function workflowStateToVariant(state?: string): StatusTagVariant {
  return WORKFLOW_STATE_VARIANTS[(state || '').toLowerCase()] ?? 'neutral';
}

const SUBMITTER_REVIEW_VARIANTS: Readonly<Record<SubmitterReviewLabel, StatusTagVariant>> = {
  [SubmitterReviewLabels.submitted]: 'success',
  [SubmitterReviewLabels.inReview]: 'info',
  [SubmitterReviewLabels.completed]: 'success',
  [SubmitterReviewLabels.revisionRequested]: 'warning',
};

/** The colour of the review label a submitter sees. */
export function submitterReviewToVariant(label: SubmitterReviewLabel): StatusTagVariant {
  return SUBMITTER_REVIEW_VARIANTS[label];
}
