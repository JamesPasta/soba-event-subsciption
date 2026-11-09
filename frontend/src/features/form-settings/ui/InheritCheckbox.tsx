'use client';

import { Checkbox } from '@bcgov/design-system-react-components';
import styles from './InheritCheckbox.module.css';

/** Whether a form uses its workspace's values for a settings group. */
export default function InheritCheckbox({
  label,
  isSelected,
  onChange,
  isDisabled = false,
  testId,
}: Readonly<{
  label: string;
  isSelected: boolean;
  onChange: (inherit: boolean) => void;
  isDisabled?: boolean;
  testId: string;
}>) {
  // The design system replaces its own root class when given one, so the spacing sits on a wrapper.
  return (
    <div className={styles.inherit}>
      <Checkbox
        isSelected={isSelected}
        onChange={onChange}
        isDisabled={isDisabled}
        data-testid={testId}
      >
        {label}
      </Checkbox>
    </div>
  );
}
