import { v7 as uuidv7 } from 'uuid';

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A storage key prefix: lowercase words joined by dashes, in one or more slash-separated segments
 * (`attachments`, `soba/dev`).
 */
export const isStoragePrefix = (value: string): boolean =>
  value.split('/').every((segment) => SEGMENT.test(segment));

/**
 * The name a file's bytes are stored under: a unique time-ordered id. The file's own name stays in
 * the database, so it never reaches a storage key or path.
 */
export const storedObjectName = (): string => uuidv7();
