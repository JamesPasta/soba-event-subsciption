'use client';

import { Button, Accordion, Form } from '@bcgov/design-system-react-components';

import type { Dictionary } from '@/src/types/dictionary';

interface FormSettingsDrawersProps {
  dict: Dictionary;
  children: React.ReactNode;
  id: string;
  label: string;
  onSave: () => void;
  onCancel: () => void;
  canSave?: boolean;
}

export default function FormSettingsDrawers({
  dict,
  children,
  id,
  label,
  onSave,
  onCancel,
  canSave = true,
}: Readonly<FormSettingsDrawersProps>) {
  return (
    <Accordion id={id} data-testid={`accordion-${id}`} label={label}>
      <div className="d-block w-100">
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {children}
          <div className="d-md-flex mt-2 justify-content-start gap-2 mt-3 w-100">
            <Button type="submit" data-testid={`form-settings-${id}-save`} isDisabled={!canSave}>
              {dict.form.save}
            </Button>
            <Button
              type="button"
              data-testid={`form-settings-${id}-cancel`}
              onClick={onCancel}
              variant="secondary"
            >
              {dict.general.cancel}
            </Button>
          </div>
        </Form>
      </div>
    </Accordion>
  );
}
