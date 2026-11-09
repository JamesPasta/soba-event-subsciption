import { z } from 'zod';

/** A settings row's version: it moves on with every save, and a save names the one it started from. */
export const SettingsVersionSchema = z.number().int().positive();

/** A form's view of a settings group its workspace shares. `own` is null while the form inherits. */
export interface InheritableSettings<T> {
  inherit: boolean;
  own: T | null;
  workspace: T;
  effective: T;
  version: number;
}

/** A form either inherits, which drops its own values, or keeps its own. */
export type InheritChoice<T> = { inherit: true } | { inherit: false; values: T };

/** A save of a form's choice, made from `version`. */
export type SetInheritableSettingsBody<T> = InheritChoice<T> & { version: number };

/** A workspace's values for a group its forms share, as read and as saved. */
export interface WorkspaceSettings<T> {
  values: T;
  version: number;
}

/**
 * The schemas of a settings group whose values a workspace shares with its forms. A body that mixes
 * the two choices, such as inherit with values, is refused rather than half applied. `version`
 * replaces the row version rule for a group whose rows a first save creates.
 */
export const inheritableSettingsSchemas = <T extends z.ZodType>(
  values: T,
  version: z.ZodType<number> = SettingsVersionSchema,
) => {
  const choice = <E extends z.ZodRawShape>(extra: E) =>
    z.discriminatedUnion('inherit', [
      z.strictObject({ inherit: z.literal(true), ...extra }),
      z.strictObject({ inherit: z.literal(false), values, ...extra }),
    ]);
  return {
    workspace: z.strictObject({ values, version }),
    // workspace precedes own: the OpenAPI generator marks a named values component itself nullable
    // when it first meets it through own.
    form: z.object({
      inherit: z.boolean(),
      workspace: values,
      own: values.nullable(),
      effective: values,
      version,
    }),
    /** A new form's choice, which has no version yet. */
    formChoice: choice({}),
    formBody: choice({ version }),
  };
};
