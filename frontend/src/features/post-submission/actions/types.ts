import type { ComponentType, Ref } from 'react';
import type { Dictionary } from '@/src/types/dictionary';
import type { PostSubmissionActionValues } from '@/src/types/postSubmission';

/**
 * Text in an action's fields that is not in its values yet: none, text that Save will add, or text
 * that cannot be saved as it is.
 */
export type FieldState = 'clear' | 'pending' | 'invalid';

/** What the drawer asks of an action's fields when Save is pressed. */
export interface ActionEditorHandle {
  /**
   * The values with any text still in the fields added to them, or null when that text cannot be
   * saved; the fields then say why.
   */
  commitText: () => PostSubmissionActionValues | null;
}

export type ActionEditorProps = Readonly<{
  /** Set by fields that hold text outside the values, so Save can add that text first. */
  ref?: Ref<ActionEditorHandle>;
  dict: Dictionary;
  /** The values being edited. */
  values: PostSubmissionActionValues;
  onChange: (values: PostSubmissionActionValues) => void;
  isDisabled: boolean;
  onFieldStateChange: (state: FieldState) => void;
  /** Why the values cannot be saved, shown with the fields; null when they can. */
  problem: string | null;
}>;

export type ActionViewProps = Readonly<{
  dict: Dictionary;
  values: PostSubmissionActionValues;
}>;

/** How the After Submission tab shows one action: its own words, fields and checks. */
export interface PostSubmissionActionUi {
  label: (dict: Dictionary) => string;
  description: (dict: Dictionary) => string;
  /** The fields, for values the person can change. */
  Editor: ComponentType<ActionEditorProps>;
  /** The values read-only, such as a workspace's while a form uses them. */
  View: ComponentType<ActionViewProps>;
  /** Why the values cannot be saved, or null. */
  problem: (values: PostSubmissionActionValues, dict: Dictionary) => string | null;
  /** The values as they are saved. */
  saved: (values: PostSubmissionActionValues) => PostSubmissionActionValues;
}
