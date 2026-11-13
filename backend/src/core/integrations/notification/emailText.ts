const MAX_NAME_LENGTH = 200;

// A scheme and "://", or "www.", up to the next space: text a mail client would make a link of.
const LINK = /\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S*/giu;

/**
 * A name fit for an email: no control or format characters, no links (only the email's own link is
 * one), one line, at most 200 characters.
 */
export const cleanName = (value: string): string =>
  Array.from(
    value
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .replaceAll(LINK, '[link removed]')
      .replaceAll(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trimEnd();
