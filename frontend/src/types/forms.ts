import type {
  CreateFormBody,
  UpdateFormBody,
  FormListItem,
  FormResponse,
  FormVersionListItem,
  FormVersionResponse,
  FormWithPermissionsResponse,
  FormWithVersionResponse,
} from '@soba/lib';

export type {
  FormVersionLookupResponse,
  FormVersionSummary,
  FormWithPermissionsResponse,
  ListFormsResponse,
  ListFormVersionsResponse,
  ListMyFormsResponse,
  MyFormListItem,
  SubmitFillBundle,
  SubmitFormVersionSchemaResponse,
  SubmissionDataDocument,
  SubmitterForm,
} from '@soba/lib';

export type {
  CreateFormBody,
  UpdateFormBody,
  FormListItem,
  FormResponse,
  FormVersionListItem,
  FormVersionResponse,
  FormWithVersionResponse,
};

export type SobaFormType = Partial<CreateFormBody> & Partial<UpdateFormBody>;

/** A new form as the dialog fills it in; the API call adds the workspace and the form engine. */
export type CreateFormFields = Omit<CreateFormBody, 'workspaceId' | 'formEngineCode'>;

export type CreateSobaFormioFormResponse = FormWithVersionResponse;

export type SobaResponseFormType = FormResponse;

export type SobaFormDetail = FormWithPermissionsResponse;

export type SobaFormSummary = FormListItem;

export type SobaFormVersionType = FormVersionResponse;

export type SobaFormVersionListItem = FormVersionListItem;
