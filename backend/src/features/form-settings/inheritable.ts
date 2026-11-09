import type { InheritableSettings } from '@soba/lib';

/** A form's row in a shared group: whether it inherits, and its own values when it does not. */
export interface InheritableRow<T> {
  inherit: boolean;
  own: T | null;
  version: number;
}

/**
 * A form's view of a shared group: its choice, its own values, the workspace's, and the values that
 * apply. A form that inherits uses the workspace's, read when asked, so a workspace change reaches
 * it with nothing copied. The submit-side facts query in submitterFormRepo applies the same rule in
 * SQL.
 */
export const toInheritableSettings = <T>(
  row: InheritableRow<T>,
  workspace: T,
): InheritableSettings<T> => {
  const own = row.inherit ? null : row.own;
  return {
    inherit: row.inherit,
    own,
    workspace,
    effective: own ?? workspace,
    version: row.version,
  };
};
