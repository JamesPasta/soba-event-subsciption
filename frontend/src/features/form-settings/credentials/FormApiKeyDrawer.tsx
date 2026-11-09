'use client';

import { Accordion } from '@bcgov/design-system-react-components';
import ApiKeysTab from '@/src/features/credentials/ui/ApiKeysTab';
import type { FormSettingsSectionProps } from '../types';

export default function FormApiKeyDrawer({ dict, drawerName, formId }: FormSettingsSectionProps) {
  return (
    <Accordion id={drawerName} data-testid={`accordion-${drawerName}`} label={dict.apiKeys.heading}>
      <div className="d-block w-100">
        <p>{dict.apiKeys.formScope}</p>
        <ApiKeysTab key={formId} dict={dict} owner={{ kind: 'form', id: formId }} />
      </div>
    </Accordion>
  );
}
