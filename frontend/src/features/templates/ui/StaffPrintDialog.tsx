'use client';

import { useId, useState } from 'react';
import { Button, InlineAlert, Radio, RadioGroup } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { Modal } from '@/src/components/Modal';
import { classifyDataError, messageForDataError } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import {
  templateExtensionsText,
  templateFileAccept,
  templateFileTypeFor,
  type PrintOptions,
} from '@/src/types/templates';
import { saveBlob } from '@/src/shared/util/saveBlob';
import type {
  StaffPrintOptions,
  StaffPrintTemplate,
  SubmissionPrint,
} from '../data/useSubmissionPrint';
import { printFailureMessages } from '../printError';
import { printFileName } from '../printFileName';

type PrintMethod = 'browser' | 'stored' | 'upload';

type StaffPrintDialogProps = {
  staff: StaffPrintOptions;
  printTemplate: SubmissionPrint['printTemplate'];
  /** The download's name, without an extension. */
  baseName: string;
  onBrowserPrint: () => void;
  onClose: () => void;
};

function StoredTemplateDetails({ template }: Readonly<{ template: StaffPrintTemplate }>) {
  const text = useDictionary().form.templates.print;
  const formatLongDate = useFormatLongDate();
  return (
    <dl className="mt-3 mb-0" data-testid="print-stored-template">
      <dt>{text.fileNameColumn}</dt>
      <dd>{template.filename}</dd>
      <dt>{text.uploadDateColumn}</dt>
      <dd>{formatLongDate(template.createdAt)}</dd>
    </dl>
  );
}

function TemplateFileInput({
  onChange,
  error,
  isDisabled,
}: Readonly<{ onChange: (file: File | null) => void; error: string | null; isDisabled: boolean }>) {
  const text = useDictionary().form.templates;
  const inputId = useId();
  const typesId = useId();
  return (
    <div className="mt-3">
      <label htmlFor={inputId} className="form-label">
        {text.fileLabel}
      </label>
      <input
        id={inputId}
        type="file"
        className="form-control"
        accept={templateFileAccept('cdogs')}
        aria-describedby={typesId}
        data-testid="print-template-file-input"
        disabled={isDisabled}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <div id={typesId} className="form-text">
        {text.acceptedTypes.replace('{types}', templateExtensionsText('cdogs'))}
      </div>
      {error ? (
        <div className="text-danger small mt-1" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Staff choose the browser's print, the form version's stored template, or a one-off upload. */
export function StaffPrintDialog({
  staff,
  printTemplate,
  baseName,
  onBrowserPrint,
  onClose,
}: Readonly<StaffPrintDialogProps>) {
  const dict = useDictionary();
  const text = dict.form.templates;
  const authDefaults = useAuthErrorDefaults();

  const canUseStored = !!staff.template && !staff.error;
  const canUpload = !staff.error;
  const [picked, setPicked] = useState<PrintMethod>(canUseStored ? 'stored' : 'browser');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  // A template method stops being offered when the facts fail while the dialog is open.
  const unavailable = (picked === 'stored' && !canUseStored) || (picked === 'upload' && !canUpload);
  const method: PrintMethod = unavailable ? 'browser' : picked;

  const pickMethod = (next: PrintMethod) => {
    setPicked(next);
    setFile(null);
    setFileError(null);
    setPrintError(null);
  };

  const pickFile = (chosen: File | null) => {
    setPrintError(null);
    const accepted = !chosen || !!templateFileTypeFor('cdogs', chosen.name);
    setFile(accepted ? chosen : null);
    setFileError(accepted ? null : text.uploadWrongType);
  };

  const print = async () => {
    if (method === 'browser') {
      onBrowserPrint();
      return;
    }
    setPrinting(true);
    setPrintError(null);
    const options: PrintOptions = { convertTo: 'pdf', reportName: baseName };
    try {
      const rendered =
        method === 'upload' && file
          ? await staff.printUploaded(file, options)
          : await printTemplate(options);
      saveBlob(rendered, printFileName(baseName, rendered));
      onClose();
    } catch (cause: unknown) {
      setPrintError(
        messageForDataError(classifyDataError(cause), {
          ...authDefaults,
          ...printFailureMessages(cause, dict.apiErrors, text.print.failed),
        }),
      );
    } finally {
      setPrinting(false);
    }
  };

  const loadErrorText = staff.error
    ? messageForDataError(staff.error, { ...authDefaults, failed: text.loadError })
    : null;
  const canPrint = !printing && (method !== 'upload' || file !== null);

  return (
    <Modal
      show
      title={text.print.modalTitle}
      onClose={onClose}
      size="md"
      isDismissable={!printing}
      isCloseable={!printing}
      footer={
        <>
          <Button
            variant="primary"
            isDisabled={!canPrint}
            onPress={() => void print()}
            data-testid="print-submission-print"
          >
            {printing ? text.print.printing : text.print.print}
          </Button>
          <Button
            variant="secondary"
            isDisabled={printing}
            onPress={onClose}
            data-testid="print-submission-cancel"
          >
            {dict.general.cancel}
          </Button>
        </>
      }
    >
      {loadErrorText ? (
        <div className="mb-3">
          <InlineAlert
            variant="danger"
            role="alert"
            title={loadErrorText}
            data-testid="print-options-load-error"
          />
        </div>
      ) : null}
      <RadioGroup
        label={text.print.methodLabel}
        value={method}
        onChange={(value) => pickMethod(value as PrintMethod)}
        isDisabled={printing}
        data-testid="print-method"
      >
        <Radio value="browser" data-testid="print-method-browser">
          {text.print.browserOption}
        </Radio>
        <Radio value="stored" isDisabled={!canUseStored} data-testid="print-method-stored">
          {text.print.storedOption}
        </Radio>
        <Radio value="upload" isDisabled={!canUpload} data-testid="print-method-upload">
          {text.print.uploadOption}
        </Radio>
      </RadioGroup>
      {method === 'stored' && staff.template ? (
        <StoredTemplateDetails template={staff.template} />
      ) : null}
      {method === 'upload' ? (
        <TemplateFileInput onChange={pickFile} error={fileError} isDisabled={printing} />
      ) : null}
      {printError ? (
        <div className="mt-3">
          <InlineAlert
            variant="danger"
            role="alert"
            title={printError}
            data-testid="print-submission-error"
          />
        </div>
      ) : null}
    </Modal>
  );
}
