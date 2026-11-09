import {
  POST_SUBMISSION_EMAIL_MAX_ADDRESSES,
  PostSubmissionEmailAddressSchema,
  type PostSubmissionActionValues,
} from '@/src/types/postSubmission';

/** The addresses in the email action's options; none when the options hold no list. */
export function addressesOf(values: PostSubmissionActionValues): string[] {
  const to = values.options.to;
  return Array.isArray(to) ? to.filter((address) => typeof address === 'string') : [];
}

/** The email action's values with this list; an empty list keeps no options. */
export function withAddresses(
  values: PostSubmissionActionValues,
  addresses: readonly string[],
): PostSubmissionActionValues {
  return { ...values, options: addresses.length > 0 ? { to: [...addresses] } : {} };
}

/** True when the emails are on with nobody to send them to, which cannot be saved. */
export const needsAddress = (values: PostSubmissionActionValues): boolean =>
  values.enabled && addressesOf(values).length === 0;

const SEPARATORS = new Set([',', ';', '\n', '\r']);

/** The text between commas, semicolons and line breaks, except those inside quotes. */
function entries(text: string): string[] {
  const found: string[] = [];
  let entry = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && SEPARATORS.has(char)) {
      found.push(entry);
      entry = '';
    } else {
      entry += char;
    }
  }
  found.push(entry);
  return found;
}

/**
 * Typed or pasted text as candidate addresses. An entry with a name, such as Outlook's
 * `"Smith, Jane" <jane@example.com>`, gives the address in its angle brackets; any other entry
 * gives each word in it, so text that is not an address comes back to be shown.
 */
export function splitAddresses(text: string): string[] {
  return entries(text)
    .flatMap((entry) => {
      const bracketed = [...entry.matchAll(/<([^<>]*)>/g)].map((match) => match[1]);
      return bracketed.length > 0 ? bracketed : entry.split(/[\s",;]+/);
    })
    .map((part) => part.trim())
    .filter(Boolean);
}

/** What adding candidates to a list did, and what stays in the field. */
export interface AddedAddresses {
  list: string[];
  added: string[];
  duplicates: string[];
  invalid: string[];
  /** Valid addresses past the limit. */
  overflow: string[];
}

/**
 * Adds each candidate the address rule accepts, lower-cased, once, up to the limit. Anything else
 * is returned to stay in the field.
 */
export function addAddresses(
  current: readonly string[],
  candidates: readonly string[],
  max: number = POST_SUBMISSION_EMAIL_MAX_ADDRESSES,
): AddedAddresses {
  const result: AddedAddresses = {
    list: [...current],
    added: [],
    duplicates: [],
    invalid: [],
    overflow: [],
  };
  for (const candidate of candidates) {
    const parsed = PostSubmissionEmailAddressSchema.safeParse(candidate);
    if (!parsed.success) {
      result.invalid.push(candidate);
    } else if (result.list.includes(parsed.data)) {
      result.duplicates.push(parsed.data);
    } else if (result.list.length >= max) {
      result.overflow.push(parsed.data);
    } else {
      result.list.push(parsed.data);
      result.added.push(parsed.data);
    }
  }
  return result;
}
