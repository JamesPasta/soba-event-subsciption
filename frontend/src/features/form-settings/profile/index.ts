import type { FormSettingsSection } from '../types';
import FormProfileDrawer from './FormProfileDrawer';

/** The form's ministry and use case, saved through the form update. */
export const profileSection: FormSettingsSection = {
  id: 'form-profile',
  weight: 20,
  Drawer: FormProfileDrawer,
};
