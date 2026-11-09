/**
 * Per-tab persistence of the submission currently being filled, so the CHEFS storage provider can
 * tag uploads with it (the backend derives the workspace from that submission and authorizes against
 * it) and send them as the fill session is: signed in, or anonymous. Backed by sessionStorage:
 * survives a refresh, is independent per tab, and clears on tab close. The fill form sets it on mount
 * and clears it on unmount; the provider reads it per upload. A submission not opened yet also
 * registers, in memory only, how to open it, and an upload waits for that before naming it.
 */
const STORAGE_KEY = 'soba.activeSubmission';

export type ActiveSubmission = { submissionId: string; signedIn: boolean };

function getStorage(): Storage | null {
  if (!('window' in globalThis)) return null;
  try {
    return globalThis.sessionStorage;
  } catch {
    // Access to sessionStorage can throw (e.g. sandboxed iframes, privacy modes).
    return null;
  }
}

const isActiveSubmission = (value: unknown): value is ActiveSubmission =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ActiveSubmission).submissionId === 'string' &&
  typeof (value as ActiveSubmission).signedIn === 'boolean';

export function getActiveSubmission(): ActiveSubmission | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    return isActiveSubmission(value) ? value : null;
  } catch {
    return null;
  }
}

export function setActiveSubmission(active: ActiveSubmission): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    // Ignore write failures.
  }
}

let activeOpener: (() => Promise<void>) | null = null;

/** How to open the active submission if it is not open yet; null when the form has none. */
export function setActiveOpener(open: (() => Promise<void>) | null): void {
  activeOpener = open;
}

/**
 * The active submission's id, once it is open: an upload must not name one that does not exist. The
 * id and its opener are read together, so a form mounted while the open is in flight does not rename
 * the upload.
 */
export async function openedActiveSubmissionId(): Promise<string> {
  const submissionId = getActiveSubmission()?.submissionId ?? '';
  const open = activeOpener;
  await open?.();
  return submissionId;
}

export function clearActiveSubmission(): void {
  activeOpener = null;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
