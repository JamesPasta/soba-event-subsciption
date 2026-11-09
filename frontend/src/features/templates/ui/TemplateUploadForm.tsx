'use client';

import { useRef, useState } from 'react';
import { Button, Select, TextField } from '@bcgov/design-system-react-components';

import type { Dictionary } from '@/src/types/dictionary';
import type { FormVersionSummary } from '@/src/types/forms';
import type { TemplateResponse, TemplateType } from '@/src/types/templates';
import {
  TEMPLATE_NAME_MAX_LENGTH,
  templateExtensionsText,
  templateFileAccept,
} from '@/src/types/templates';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { lookupTruncatedNote, withSelectedOption } from '@/src/shared/list/lookupOptions';
import { templateOn, uploadErrorText, versionOptions } from '../templateUpload';
import styles from './TemplateUploadForm.module.css';

const ACCEPTED_TYPES_ID = 'template-accepted-types';

type TemplateUploadFormProps = Readonly<{
  dict: Dictionary;
  /** Never empty. */
  types: TemplateType[];
  templates: TemplateResponse[];
  currentVersion: FormVersionSummary | null;
  versions: FormVersionSummary[];
  versionsTruncated: boolean;
  versionsLimit?: number;
  upload: (
    token: string,
    formVersionId: string,
    type: TemplateType,
    name: string,
    file: File,
  ) => Promise<unknown>;
  replace: (token: string, templateId: string, file: File) => Promise<unknown>;
}>;

/** Type, version, file and name, then Upload; Replace where the version has the type already. */
export function TemplateUploadForm({
  dict,
  types,
  templates,
  currentVersion,
  versions,
  versionsTruncated,
  versionsLimit,
  upload,
  replace,
}: TemplateUploadFormProps) {
  const text = dict.form.templates;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedType, setPickedType] = useState<TemplateType | null>(null);
  const [picked, setPicked] = useState<{
    whenCurrent: string | null;
    version: FormVersionSummary;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);

  // A type that stops being available gives way to the first one that is.
  const type = pickedType && types.includes(pickedType) ? pickedType : types[0];
  // A version picked before a new version was created gives way to the new current version.
  const currentVersionId = currentVersion?.id ?? null;
  const pickedVersion = picked?.whenCurrent === currentVersionId ? picked.version : null;
  const formVersionId = pickedVersion?.id ?? currentVersionId;
  const versionChoices = withSelectedOption(
    currentVersion ? [currentVersion, ...versions] : versions,
    pickedVersion,
  );
  const versionItems = versionOptions(currentVersion, versionChoices);
  const typeItems = types.map((code) => ({ id: code, label: text.types[code] }));
  const existing = templateOn(templates, formVersionId, type);

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pickType = (code: TemplateType) => {
    setPickedType(code);
    // The accepted file types follow the template type.
    clearFile();
  };

  const submit = async () => {
    if (!token || !file || !formVersionId || uploading) return;
    setUploading(true);
    try {
      if (existing) {
        await replace(token, existing.id, file);
        addNotification({ text: text.replaceSuccess, type: 'success' });
      } else {
        await upload(token, formVersionId, type, name.trim(), file);
        addNotification({ text: text.uploadSuccess, type: 'success' });
      }
      clearFile();
      setName('');
    } catch (e: unknown) {
      addNotification({
        text: uploadErrorText(
          e,
          {
            failed: text.uploadError,
            typeTaken: text.uploadTypeTaken,
            replaceConflict: text.replaceConflict,
            tooLarge: text.uploadTooLarge,
            wrongType: text.uploadWrongType,
            scanFailed: text.uploadScanFailed,
            sessionExpired: dict.general.sessionExpired,
            forbidden: dict.general.noAccess,
          },
          !!existing,
        ),
        type: 'error',
        consoleError: e,
      });
    } finally {
      setUploading(false);
    }
  };

  const buttonLabel = existing ? text.replace : text.upload;
  const busyLabel = existing ? text.replacing : text.uploading;

  return (
    <>
      <div className={styles.fields}>
        {/* A className on a design system field replaces its own, so wrappers size them. */}
        <div className={styles.field}>
          <Select
            label={text.typeLabel}
            data-testid="template-type-select"
            items={typeItems}
            selectedKey={type}
            isDisabled={uploading}
            onSelectionChange={(key) => pickType(key as TemplateType)}
          />
        </div>
        <div className={styles.field}>
          <Select
            label={text.versionLabel}
            data-testid="template-version-select"
            items={versionItems}
            selectedKey={formVersionId}
            isDisabled={uploading || versionItems.length === 0}
            description={lookupTruncatedNote(dict.general.lookupTruncated, {
              truncated: versionsTruncated,
              limit: versionsLimit,
            })}
            onSelectionChange={(key) => {
              const version = versionChoices.find((v) => v.id === key);
              if (version) setPicked({ whenCurrent: currentVersionId, version });
            }}
          />
        </div>
        <div className={`d-flex flex-column ${styles.wideField}`}>
          <label className="form-label mb-1" htmlFor="template-file-input">
            {text.fileLabel}
          </label>
          <input
            id="template-file-input"
            ref={fileInputRef}
            type="file"
            className="form-control"
            accept={templateFileAccept(type)}
            aria-describedby={ACCEPTED_TYPES_ID}
            data-testid="template-file-input"
            disabled={uploading || !formVersionId}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <div className={`d-flex flex-column ${styles.wideField}`}>
          <TextField
            label={text.nameLabel}
            data-testid="template-name-field"
            value={existing ? existing.name : name}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            description={existing ? text.replaceNameDescription : text.nameDescription}
            isDisabled={uploading || !formVersionId || !!existing}
            onChange={setName}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <Button
          data-testid="template-upload-button"
          isDisabled={uploading || !file || !formVersionId}
          onPress={submit}
        >
          {uploading ? busyLabel : buttonLabel}
        </Button>
        <span
          id={ACCEPTED_TYPES_ID}
          className="text-muted small"
          data-testid="template-accepted-types"
        >
          {text.acceptedTypes.replace('{types}', templateExtensionsText(type))}
        </span>
      </div>
    </>
  );
}
