declare const safeHtml: unique symbol;

/** Markup built by `markup`. Nothing else can make one, and a look-alike object is refused. */
export interface SafeHtml {
  readonly [safeHtml]: true;
}

/** What `markup` accepts: text and numbers are escaped, and null, undefined and false render nothing. */
export type HtmlValue =
  | string
  | number
  | SafeHtml
  | null
  | undefined
  | false
  | readonly HtmlValue[];

const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/** Text safe in HTML content and in a quoted attribute value. */
const escapeHtml = (value: string): string =>
  value.replaceAll(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char);

// Keyed by the frozen object `markup` returns; an object not in here was not built by `markup`.
const built = new WeakMap<object, string>();

const render = (value: HtmlValue): string => {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(render).join('');
  const text = typeof value === 'object' ? built.get(value) : undefined;
  if (text === undefined) {
    throw new TypeError('Only text, numbers and markup built by markup can go into an email');
  }
  return text;
};

/**
 * Email markup. Every value is escaped unless it is markup this tag built. Named `markup`, not
 * `html`, so Prettier leaves the markup as written.
 */
export const markup = (
  strings: TemplateStringsArray,
  ...values: readonly HtmlValue[]
): SafeHtml => {
  const text = strings.reduce(
    (out, part, index) => out + part + (index < values.length ? render(values[index]) : ''),
    '',
  );
  const result = Object.freeze({}) as SafeHtml;
  built.set(result, text);
  return result;
};

/** The markup as text, for the email body. */
export const toHtmlString = (value: SafeHtml): string => render(value);
