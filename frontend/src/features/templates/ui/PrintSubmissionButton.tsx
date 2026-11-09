'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { saveBlob } from '@/src/shared/util/saveBlob';
import { PrintChoice } from '@/src/types/templates';
import type { SubmissionPrint } from '../data/useSubmissionPrint';
import { printFailureMessages } from '../printError';
import { printFileName } from '../printFileName';
import { StaffPrintDialog } from './StaffPrintDialog';

type PrintSubmissionButtonProps = {
  print: SubmissionPrint;
  /** The download's name, without an extension. */
  baseName: string;
};

/**
 * Prints a submission the way its print choice says: the browser's print, a PDF of the stored
 * template, or the staff options.
 */
export function PrintSubmissionButton({ print, baseName }: Readonly<PrintSubmissionButtonProps>) {
  const dict = useDictionary();
  const notifyError = useDataErrorNotice();
  const [rendering, setRendering] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const browserPrintPending = useRef(false);

  // Print only once the options have closed so they are not in the printout.
  useEffect(() => {
    if (!browserPrintPending.current || optionsOpen) return;
    browserPrintPending.current = false;
    window.print();
  }, [optionsOpen]);

  const printTemplate = async () => {
    setRendering(true);
    try {
      const rendered = await print.printTemplate({ convertTo: 'pdf', reportName: baseName });
      saveBlob(rendered, printFileName(baseName, rendered));
    } catch (cause: unknown) {
      notifyError(
        cause,
        printFailureMessages(cause, dict.apiErrors, dict.form.templates.print.failed),
      );
    } finally {
      setRendering(false);
    }
  };

  const onPress = () => {
    if (print.choice === PrintChoice.browser) {
      // Within the click, never after an await.
      window.print();
    } else if (print.choice === PrintChoice.template) {
      void printTemplate();
    } else if (print.choice === PrintChoice.options) {
      setOptionsOpen(true);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="small"
        isPending={print.choice === null || rendering}
        onPress={onPress}
        data-testid="print-submission-button"
      >
        {dict.form.templates.print.button}
      </Button>
      {optionsOpen && print.staff ? (
        <StaffPrintDialog
          staff={print.staff}
          printTemplate={print.printTemplate}
          baseName={baseName}
          onBrowserPrint={() => {
            browserPrintPending.current = true;
            setOptionsOpen(false);
          }}
          onClose={() => setOptionsOpen(false)}
        />
      ) : null}
    </>
  );
}
