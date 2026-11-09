import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    general: { cancel: 'Cancel', sessionExpired: 'Session ended.', noAccess: 'No access.' },
    apiErrors: { render_failed: 'Could not print from this template.' },
    modal: { dialogActions: 'Dialog actions' },
    form: {
      templates: {
        fileLabel: 'Template File',
        acceptedTypes: 'Accepted file types: {types}.',
        uploadWrongType: 'Wrong type.',
        loadError: 'Failed to load templates.',
        print: {
          modalTitle: 'Print Submission',
          methodLabel: 'Print with',
          browserOption: 'Browser print',
          storedOption: 'Use default CDOGS template',
          uploadOption: 'Upload CDOGS template',
          print: 'Print',
          printing: 'Printing...',
          fileNameColumn: 'File Name',
          uploadDateColumn: 'Upload Date',
          failed: 'Failed to generate the document.',
        },
      },
    },
  }),
}));

const mocks = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/src/shared/util/saveBlob', () => ({ saveBlob: mocks.saveBlob }));

import { ApiError } from '@/src/shared/api/sobaHelpers';
import type {
  StaffPrintOptions,
  StaffPrintTemplate,
} from '@/src/features/templates/data/useSubmissionPrint';
import { StaffPrintDialog } from '@/src/features/templates/ui/StaffPrintDialog';

const pdf = new Blob(['doc'], { type: 'application/pdf' });
const OPTIONS = { convertTo: 'pdf', reportName: 'Receipt ABC123' };
const RECEIPT: StaffPrintTemplate = {
  id: 'tpl-1',
  name: 'Receipt',
  filename: 'receipt.docx',
  createdAt: '2026-01-02T03:04:05.000Z',
};

const printTemplate = vi.fn();
const printUploaded = vi.fn();
const onBrowserPrint = vi.fn();
const onClose = vi.fn();

const renderDialog = (staff: Partial<StaffPrintOptions> = {}) =>
  render(
    <StaffPrintDialog
      staff={{ template: RECEIPT, error: null, printUploaded, ...staff }}
      printTemplate={printTemplate}
      baseName="Receipt ABC123"
      onBrowserPrint={onBrowserPrint}
      onClose={onClose}
    />,
  );

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const printButton = () => screen.getByTestId('print-submission-print');
const pickFile = (file: File) =>
  fireEvent.change(screen.getByTestId('print-template-file-input'), { target: { files: [file] } });

describe('StaffPrintDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    printTemplate.mockResolvedValue(pdf);
    printUploaded.mockResolvedValue(pdf);
  });

  it('starts on the stored template, shows its file, and prints a PDF of it', async () => {
    renderDialog();
    expect(radio('Use default CDOGS template').checked).toBe(true);
    expect(screen.getByText('receipt.docx')).toBeTruthy();

    fireEvent.click(printButton());
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledWith(pdf, 'Receipt ABC123.pdf'));
    expect(printTemplate).toHaveBeenCalledWith(OPTIONS);
    expect(printUploaded).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('starts on the browser print when there is no stored template', () => {
    renderDialog({ template: null });
    expect(radio('Browser print').checked).toBe(true);
    expect(radio('Use default CDOGS template').disabled).toBe(true);

    fireEvent.click(printButton());
    expect(onBrowserPrint).toHaveBeenCalled();
    expect(printTemplate).not.toHaveBeenCalled();
  });

  it('prints an uploaded template once an accepted file is chosen', async () => {
    renderDialog();
    fireEvent.click(radio('Upload CDOGS template'));
    expect(printButton().hasAttribute('disabled')).toBe(true);

    pickFile(new File(['x'], 'mine.pdf'));
    expect(await screen.findByText('Wrong type.')).toBeTruthy();
    expect(printButton().hasAttribute('disabled')).toBe(true);

    const file = new File(['x'], 'mine.docx');
    pickFile(file);
    await waitFor(() => expect(printButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(printButton());

    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledWith(pdf, 'Receipt ABC123.pdf'));
    expect(printUploaded).toHaveBeenCalledWith(file, OPTIONS);
  });

  it('keeps the dialog open with the message for a refused render', async () => {
    printTemplate.mockRejectedValue(new ApiError('nope', 422, 'render_failed'));
    renderDialog();
    fireEvent.click(printButton());

    expect((await screen.findByTestId('print-submission-error')).textContent).toContain(
      'Could not print from this template.',
    );
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers only the browser print when the facts fail', () => {
    renderDialog({ error: { kind: 'failed', cause: new Error('down') } });
    expect(screen.getByTestId('print-options-load-error').textContent).toContain(
      'Failed to load templates.',
    );
    expect(radio('Browser print').checked).toBe(true);
    expect(radio('Use default CDOGS template').disabled).toBe(true);
    expect(radio('Upload CDOGS template').disabled).toBe(true);
  });

  it('hides its close button while it prints', async () => {
    let finish: (value: Blob) => void = () => undefined;
    printTemplate.mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve)));
    renderDialog();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();

    fireEvent.click(printButton());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).toBeNull());
    finish(pdf);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
