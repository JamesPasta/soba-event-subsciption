import { Response } from 'express';
import { z } from 'zod';
import {
  CreateFormBodySchema,
  CreateFormVersionBodySchema,
  FormIdParamsSchema,
  FormVersionIdParamsSchema,
  NormalizeSchemaBodySchema,
  ListFormsQuerySchema,
  ListFormVersionsQuerySchema,
  FormVersionLookupQuerySchema,
  ProvisionSchemaBodySchema,
  SaveFormVersionBodySchema,
  SaveFormVersionParamsSchema,
  UpdateFormBodySchema,
} from './schema';
import { formsApiService } from './service';
import { asyncHandler } from '../shared/asyncHandler';
import { NotFoundError } from '../../errors';
import type { Request } from 'express';

type CreateFormBody = z.infer<typeof CreateFormBodySchema>;
type CreateFormVersionBody = z.infer<typeof CreateFormVersionBodySchema>;
type FormIdParams = z.infer<typeof FormIdParamsSchema>;
type FormVersionIdParams = z.infer<typeof FormVersionIdParamsSchema>;
type UpdateFormBody = z.infer<typeof UpdateFormBodySchema>;
type ProvisionSchemaBody = z.infer<typeof ProvisionSchemaBodySchema>;
type SaveFormVersionBody = z.infer<typeof SaveFormVersionBodySchema>;
type SaveFormVersionParams = z.infer<typeof SaveFormVersionParamsSchema>;
type ListFormsQuery = z.infer<typeof ListFormsQuerySchema>;
type ListFormVersionsQuery = z.infer<typeof ListFormVersionsQuerySchema>;
type FormVersionLookupQuery = z.infer<typeof FormVersionLookupQuerySchema>;
type NormalizeSchemaBody = z.infer<typeof NormalizeSchemaBodySchema>;

const FORM_NOT_FOUND = 'Form not found';
const FORM_VERSION_NOT_FOUND = 'Form version not found';

export const createForm = asyncHandler(
  async (req: Request<unknown, unknown, CreateFormBody>, res: Response) => {
    const ctx = req.coreContext!;
    // 201 when this call created the form, 200 when a retry returned the one it made.
    const { created, form } = await formsApiService.createForm(ctx, req.body);
    res.status(created ? 201 : 200).json(form);
  },
);

export const normalizeFormSchema = (
  req: Request<unknown, unknown, NormalizeSchemaBody>,
  res: Response,
): void => {
  const ctx = req.coreContext!;
  const schema = formsApiService.normalizeSchema(ctx, req.body.schema);
  res.json({ schema });
};

export const updateForm = asyncHandler(
  async (req: Request<FormIdParams, unknown, UpdateFormBody>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.updateForm(ctx, req.params.id, req.body);
    if (!result) {
      throw new NotFoundError(FORM_NOT_FOUND);
    }
    res.json(result);
  },
);

export const getForm = asyncHandler(async (req: Request<FormIdParams>, res: Response) => {
  const ctx = req.coreContext!;
  const result = await formsApiService.getForm(ctx, req.params.id);
  if (!result) {
    throw new NotFoundError(FORM_NOT_FOUND);
  }
  res.json(result);
});

export const listForms = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.listScope!;
  const result = await formsApiService.list(
    { workspaceIds: scope.workspaceIds, actorId: scope.actorId, formAccess: scope.formAccess },
    { ...(req.query as unknown as ListFormsQuery), locale: req.sortLocale! },
  );
  res.json(result);
});

export const getFormVersion = asyncHandler(
  async (req: Request<FormVersionIdParams>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.getFormVersion(ctx, req.params.id);
    if (!result) {
      throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    }
    res.json(result);
  },
);

export const listFormVersions = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.listScope!;
  const result = await formsApiService.listFormVersions(
    { workspaceIds: scope.workspaceIds, actorId: scope.actorId, formAccess: scope.formAccess },
    req.query as unknown as ListFormVersionsQuery,
  );
  res.json(result);
});

export const lookupFormVersions = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.listScope!;
  const result = await formsApiService.lookupFormVersions(
    { workspaceIds: scope.workspaceIds },
    req.query as unknown as FormVersionLookupQuery,
  );
  res.json(result);
});

export const createFormVersion = asyncHandler(
  async (req: Request<unknown, unknown, CreateFormVersionBody>, res: Response) => {
    const ctx = req.coreContext!;
    // 201 when this call created the draft, 200 when a retry returned the one it made.
    const { created, version } = await formsApiService.createDraft(ctx, req.body);
    res.status(created ? 201 : 200).json(version);
  },
);

export const publishFormVersion = asyncHandler(
  async (req: Request<FormVersionIdParams>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.publish(ctx, req.params.id);
    if (!result) {
      throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    }
    res.json(result);
  },
);

export const unpublishFormVersion = asyncHandler(
  async (req: Request<FormVersionIdParams>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.unpublish(ctx, req.params.id);
    if (!result) {
      throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    }
    res.json(result);
  },
);

export const provisionFormVersionSchema = asyncHandler(
  async (req: Request<FormVersionIdParams, unknown, ProvisionSchemaBody>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.provision(ctx, req.params.id, req.body.schema);
    if (!result) {
      throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    }
    res.json(result);
  },
);

export const getFormVersionSchema = asyncHandler(
  async (req: Request<FormVersionIdParams>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.getSchema(ctx, req.params.id);
    if (!result) {
      throw new NotFoundError('Form version schema not found');
    }
    result._id = req.params.id;
    res.json(result);
  },
);

export const saveFormVersion = asyncHandler(
  async (req: Request<SaveFormVersionParams, unknown, SaveFormVersionBody>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.save(ctx, req.params.id, req.body);
    res.json(result);
  },
);

export const deleteFormVersion = asyncHandler(
  async (req: Request<FormVersionIdParams>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await formsApiService.delete(ctx, req.params.id);
    if (!result) {
      throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    }
    res.status(204).send();
  },
);

export const deleteForm = asyncHandler(async (req: Request<FormIdParams>, res: Response) => {
  const ctx = req.coreContext!;
  const result = await formsApiService.deleteForm(ctx, req.params.id);
  if (!result) {
    throw new NotFoundError(FORM_NOT_FOUND);
  }
  res.status(204).send();
});
