import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    general: { cancel: 'Cancel', loading: 'Loading...', sessionExpired: 'Ended.', noAccess: 'No.' },
    apiErrors: { render_failed: 'Could not print from this template.' },
    dataTable: {},
    modal: { dialogActions: 'Dialog actions' },
    form: {
      templates: {
        fileLabel: 'Template File',
        acceptedTypes: 'Accepted file types: {types}.',
        print: {
          button: 'Print',
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

const mocks = vi.hoisted(() => ({ notify: vi.fn(), saveBlob: vi.fn() }));
vi.mock('@/src/shared/api/useDataErrorNotice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/shared/api/useDataErrorNotice')>()),
  useDataErrorNotice: () => mocks.notify,
}));
vi.mock('@/src/shared/util/saveBlob', () => ({ saveBlob: mocks.saveBlob }));

import { ApiError } from '@/src/shared/api/sobaHelpers';
import type { SubmissionPrint } from '@/src/features/templates/data/useSubmissionPrint';
import { PrintSubmissionButton } from '@/src/features/templates/ui/PrintSubmissionButton';

const pdf = new Blob(['doc'], { type: 'application/pdf' });

const printOf = (overrides: Partial<SubmissionPrint>): SubmissionPrint => ({
  choice: 'browser',
  printTemplate: vi.fn().mockResolvedValue(pdf),
  staff: null,
  ...overrides,
});

const renderButton = (print: SubmissionPrint) =>
  render(<PrintSubmissionButton print={print} baseName="Receipt ABC123" />);

const press = () => fireEvent.click(screen.getByTestId('print-submission-button'));

describe('PrintSubmissionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'print').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing while its print choice is loading', () => {
    const print = printOf({ choice: null });
    renderButton(print);
    press();
    expect(window.print).not.toHaveBeenCalled();
    expect(print.printTemplate).not.toHaveBeenCalled();
  });

  it('opens the browser print within the click', () => {
    renderButton(printOf({ choice: 'browser' }));
    press();
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('downloads a PDF of the stored template, named for the submission', async () => {
    const print = printOf({ choice: 'template' });
    renderButton(print);
    press();

    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledWith(pdf, 'Receipt ABC123.pdf'));
    expect(print.printTemplate).toHaveBeenCalledWith({
      convertTo: 'pdf',
      reportName: 'Receipt ABC123',
    });
    expect(window.print).not.toHaveBeenCalled();
  });

  it('reports a refused render with the message for its code', async () => {
    const refused = new ApiError('nope', 422, 'render_failed');
    renderButton(
      printOf({ choice: 'template', printTemplate: vi.fn().mockRejectedValue(refused) }),
    );
    press();

    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(refused, {
        failed: 'Could not print from this template.',
        forbidden: 'Could not print from this template.',
      }),
    );
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('reports an uncoded failure with the generic message', async () => {
    const offline = new TypeError('Failed to fetch');
    renderButton(
      printOf({ choice: 'template', printTemplate: vi.fn().mockRejectedValue(offline) }),
    );
    press();

    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(offline, {
        failed: 'Failed to generate the document.',
      }),
    );
  });

  it('opens the staff options, and prints from the browser once they close', async () => {
    renderButton(
      printOf({
        choice: 'options',
        staff: { template: null, error: null, printUploaded: vi.fn() },
      }),
    );
    press();
    expect(await screen.findByTestId('print-method')).toBeTruthy();
    expect(window.print).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('print-submission-print'));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('print-method')).toBeNull();
  });

  it('closes the staff options on cancel without printing', async () => {
    renderButton(
      printOf({
        choice: 'options',
        staff: { template: null, error: null, printUploaded: vi.fn() },
      }),
    );
    press();
    fireEvent.click(await screen.findByTestId('print-submission-cancel'));

    await waitFor(() => expect(screen.queryByTestId('print-method')).toBeNull());
    expect(window.print).not.toHaveBeenCalled();
  });
});
