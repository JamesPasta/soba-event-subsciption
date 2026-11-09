import type { FormSettingsSection } from '../types';
import FormSettingsDrawer from './FormSettingsDrawer';

/** The form's own description, saved through the form update. */
export const formSection: FormSettingsSection = {
  id: 'form-settings',
  weight: 10,
  Drawer: FormSettingsDrawer,
};
