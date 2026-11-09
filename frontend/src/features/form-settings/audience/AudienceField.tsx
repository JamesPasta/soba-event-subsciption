'use client';

import { RadioGroup, Radio, CheckboxGroup, Checkbox } from '@bcgov/design-system-react-components';
import type { Dictionary } from '@/src/types/dictionary';
import type { Audience, AudienceMode, LoginProviderMeta } from '@/src/types/formSettings';
import styles from './AudienceField.module.css';

/** An audience being edited: protected may have no provider until one is picked. */
export interface AudienceValue {
  mode: AudienceMode;
  idps: string[];
}

/**
 * The value's providers that are still offered. A saved provider that is no longer offered has no
 * checkbox to untick, and the server would refuse it, so it is left out.
 */
export const offeredIdps = (value: AudienceValue, providers: LoginProviderMeta[]): string[] =>
  value.idps.filter((code) => providers.some((provider) => provider.code === code));

/** Protected needs a provider; every other choice stands on its own. */
export const isValidAudience = (value: AudienceValue, providers: LoginProviderMeta[]): boolean =>
  value.mode !== 'protected' || offeredIdps(value, providers).length > 0;

/** The audience to save. Only protected keeps providers. */
export const toAudience = (value: AudienceValue, providers: LoginProviderMeta[]): Audience => {
  if (value.mode === 'protected') return { mode: 'protected', idps: offeredIdps(value, providers) };
  return value.mode === 'public' ? { mode: 'public', idps: [] } : { mode: 'members', idps: [] };
};

/** Who can submit, edited in place. The surrounding drawer or form loads and saves the value. */
export default function AudienceField({
  dict,
  value,
  onChange,
  providers,
  isDisabled = false,
}: Readonly<{
  dict: Dictionary;
  value: AudienceValue;
  onChange: (value: AudienceValue) => void;
  providers: LoginProviderMeta[];
  isDisabled?: boolean;
}>) {
  const t = dict.form.settings;
  const selected = offeredIdps(value, providers);

  return (
    <div className={styles.field}>
      <RadioGroup
        label={t.audienceLabel}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode: mode as AudienceMode })}
        isDisabled={isDisabled}
      >
        <Radio value="public" data-testid="audience-mode-public">
          {t.audiencePublic}
        </Radio>
        <Radio value="protected" data-testid="audience-mode-protected">
          {t.audienceProtected}
        </Radio>
        <Radio value="members" data-testid="audience-mode-members">
          {t.audienceMembers}
        </Radio>
      </RadioGroup>
      {value.mode === 'protected' && (
        <CheckboxGroup
          label={t.audienceProviders}
          value={selected}
          onChange={(idps) => onChange({ ...value, idps })}
          isDisabled={isDisabled}
          isInvalid={!isDisabled && selected.length === 0}
          errorMessage={t.audienceProvidersRequired}
        >
          {providers.map((provider) => (
            <Checkbox
              key={provider.code}
              value={provider.code}
              data-testid={`audience-idp-${provider.code}`}
            >
              {provider.name}
            </Checkbox>
          ))}
        </CheckboxGroup>
      )}
    </div>
  );
}
