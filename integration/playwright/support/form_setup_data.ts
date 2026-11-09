import path from 'node:path';

export const formSetupFile = path.resolve(__dirname, 'form-setup.json');

export type FormSetupData = {
  title: string;
  workspaceName: string;
  formUrl: string;
  submissionUrl?: string;
};
