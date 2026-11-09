'use client';

import { useCallback, useRef, useState } from 'react';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import { SubmissionWorkflowState, type SubmissionWriteResponse } from '@/src/types/submissions';
import { useSubmissionWriter } from './useSubmissionWriter';

export type FillWrite = 'save' | 'submit';
/** `resolve`: reloading or writing over after a held write. */
export type FillBusy = FillWrite | 'resolve';

/** The last draft save of this form, for a status line. */
export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: Date }
  | { state: 'held' }
  | { state: 'failed'; cause: unknown };

/** The reason a write refused without sending carries. */
export const BLOCKED_REASON = 'blocked';
const BLOCKED: WriteOutcome<SubmissionWriteResponse> = { status: 'held', reason: BLOCKED_REASON };

const saveStatusOf = (outcome: WriteOutcome<SubmissionWriteResponse>): SaveStatus => {
  switch (outcome.status) {
    case 'applied':
      return { state: 'saved', at: new Date() };
    case 'held':
      return { state: 'held' };
    case 'queued':
      return { state: 'idle' };
  }
};

const required = (base: { current: string | null }) => {
  if (base.current === null) throw new Error('No head revision to write on');
  return base.current;
};

export interface FillWriterOptions {
  /** The loaded head; null for a submission not opened yet. */
  headRevisionId: string | null;
  /** The page's session: a signed-in fill never writes anonymously. */
  signedIn: boolean;
  /** Opens a submission not opened yet and returns the head it recorded. */
  open?: () => Promise<string>;
}

/**
 * The writes of one loaded bundle. Each write is based on the head it knows: the loaded head, the
 * head the open recorded for a new submission, then each applied save, or the head re-read when the
 * filler keeps their version. A new submission is opened by its first save, submit or upload, one
 * open at a time, and a failed open is tried again by the next. A save opens it inside its own
 * flight, so a submit waiting on that save waits for the open too. A submit waits for a save in
 * flight and is based on the revision that save produces. A write held as a conflict blocks every
 * later write until the filler reloads or keeps theirs; a record found submitted blocks every later
 * write. A blocked write sends nothing and returns held with BLOCKED_REASON.
 */
export function useFillWriter(
  submissionId: string,
  { headRevisionId, signedIn, open }: FillWriterOptions,
) {
  const writer = useSubmissionWriter(submissionId, signedIn);

  const baseRef = useRef(headRevisionId);
  // The open in flight, or settled; cleared when it fails so the next write tries again.
  const openRef = useRef<Promise<void> | null>(null);
  const saveInFlightRef = useRef<Promise<unknown> | null>(null);
  const [busy, setBusy] = useState<FillBusy | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' });
  const [held, setHeld] = useState<FillWrite | null>(null);
  // Read by a submit that waited on a save, so it sees what that save left.
  const heldRef = useRef<FillWrite | null>(null);
  const hold = useCallback((kind: FillWrite | null) => {
    heldRef.current = kind;
    setHeld(kind);
  }, []);
  // The record is submitted; the caller leaves.
  const closedRef = useRef(false);
  const blocked = useCallback(() => heldRef.current !== null || closedRef.current, []);

  /** A head to write on, or a way to get one by opening. */
  const hasBase = useCallback(() => baseRef.current !== null || open !== undefined, [open]);

  /** Opens a new submission once; every write and upload before it lands waits on the same open. */
  const ensureOpened = useCallback((): Promise<void> => {
    if (baseRef.current !== null || !open) return Promise.resolve();
    openRef.current ??= open().then(
      (head) => {
        baseRef.current = head;
      },
      (err: unknown) => {
        openRef.current = null;
        throw err;
      },
    );
    return openRef.current;
  }, [open]);

  const settle = useCallback(
    (kind: FillWrite, outcome: WriteOutcome<SubmissionWriteResponse>) => {
      if (outcome.status === 'applied') {
        if (kind === 'save') baseRef.current = outcome.value.revision.id;
        hold(null);
      } else if (outcome.status === 'held') {
        if (outcome.reason === 'closed') closedRef.current = true;
        else hold(kind);
      }
      return outcome;
    },
    [hold],
  );

  const save = useCallback(
    async (data: Record<string, unknown>): Promise<WriteOutcome<SubmissionWriteResponse>> => {
      if (blocked()) return BLOCKED;
      setBusy('save');
      setSaveStatus({ state: 'saving' });
      const run = (async () => {
        await ensureOpened();
        return settle('save', await writer.save(data, required(baseRef)));
      })();
      const inFlight = run.catch(() => undefined);
      saveInFlightRef.current = inFlight;
      try {
        const outcome = await run;
        setSaveStatus(saveStatusOf(outcome));
        return outcome;
      } catch (err) {
        setSaveStatus({ state: 'failed', cause: err });
        throw err;
      } finally {
        if (saveInFlightRef.current === inFlight) saveInFlightRef.current = null;
        setBusy(null);
      }
    },
    [writer, settle, blocked, ensureOpened],
  );

  const submit = useCallback(
    async (data: Record<string, unknown>): Promise<WriteOutcome<SubmissionWriteResponse>> => {
      await saveInFlightRef.current;
      if (blocked()) return BLOCKED;
      setBusy('submit');
      try {
        await ensureOpened();
        return settle('submit', await writer.submit(data, required(baseRef)));
      } finally {
        setBusy(null);
      }
    },
    [writer, settle, blocked, ensureOpened],
  );

  /**
   * Re-reads the head and bases the next write on it, releasing the held write for the caller to
   * send again. `closed` when the record is now submitted; null when nothing is held.
   */
  const keepMine = useCallback(async (): Promise<FillWrite | 'closed' | null> => {
    const kind = heldRef.current;
    if (!kind) return null;
    setBusy('resolve');
    let head: Awaited<ReturnType<typeof writer.reloadHead>>;
    try {
      head = await writer.reloadHead();
    } catch (err) {
      setBusy(null);
      throw err;
    }
    // Stays busy: the caller leaves for the submitted record.
    if (head.workflowState === SubmissionWorkflowState.submitted) return 'closed';
    setBusy(null);
    baseRef.current = head.headRevisionId;
    hold(null);
    return kind;
  }, [writer, hold]);

  /**
   * Drops the held write once `reload` has mounted a new form on the latest bundle; writes stay
   * blocked until then. A reload whose read fails replaces the form with the load alert.
   */
  const discardMine = useCallback(
    async (reload: () => Promise<void>) => {
      setBusy('resolve');
      try {
        await reload();
        hold(null);
      } finally {
        setBusy(null);
      }
    },
    [hold],
  );

  return {
    signedIn,
    status: { busy, held, save: saveStatus },
    hasBase,
    ensureOpened,
    save,
    submit,
    keepMine,
    discardMine,
  };
}
