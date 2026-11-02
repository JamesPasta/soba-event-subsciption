'use client';

import { useState } from 'react';
import { Button, TextArea } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { SecondaryText } from '@/src/components/SecondaryText';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { SUBMISSION_NOTE_MAX_LENGTH, type SubmissionNote } from '@/src/types/submissionReview';

type SubmissionNotesPanelProps = {
  notes: SubmissionNote[];
  /** Whether the caller may add a note; without it the notes are read only. */
  canAdd: boolean;
  /** Resolves true once the note is saved; the box keeps its text otherwise. */
  onAdd: (text: string) => Promise<boolean>;
};

/** Staff notes on a submission, newest first, with the box to add one. */
export function SubmissionNotesPanel({
  notes,
  canAdd,
  onAdd,
}: Readonly<SubmissionNotesPanelProps>) {
  const dictReview = useDictionary().submission.review;
  const formatLongDateTime = useFormatLongDateTime();
  const [text, setText] = useState('');
  // The design system's character count keeps its own tally, so a cleared box is a new one.
  const [box, setBox] = useState(0);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setSaving(true);
    const saved = await onAdd(text.trim());
    setSaving(false);
    if (!saved) return;
    setText('');
    setBox((current) => current + 1);
  };

  return (
    <div className="d-block w-100">
      {canAdd ? (
        <>
          <TextArea
            key={box}
            className="bcds-react-aria-TextArea w-100"
            aria-label={dictReview.noteLabel}
            description={dictReview.noteLimit.replace('{max}', String(SUBMISSION_NOTE_MAX_LENGTH))}
            maxLength={SUBMISSION_NOTE_MAX_LENGTH}
            value={text}
            isDisabled={saving}
            onChange={setText}
            data-testid="submission-note-input"
          />
          <div className="mt-3 mb-3">
            <Button
              isDisabled={saving || !text.trim()}
              onPress={() => void add()}
              data-testid="submission-note-add"
            >
              {dictReview.addNote}
            </Button>
          </div>
        </>
      ) : null}
      {notes.length === 0 ? (
        <SecondaryText elementType="p" data-testid="submission-notes-empty">
          {dictReview.noNotes}
        </SecondaryText>
      ) : null}
      <div data-testid="submission-notes-list">
        {notes.map((note) => (
          <div key={note.id} className="mb-3" data-testid={`submission-note-${note.id}`}>
            <strong>
              {dictReview.noteByline
                .replace('{author}', note.createdBy)
                .replace('{date}', formatLongDateTime(note.createdAt))}
            </strong>
            <div style={{ whiteSpace: 'pre-wrap' }}>{note.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
