import { Request, Response } from 'express';
import type { CodesKeyedMetaResponse, RolesMetaResponse } from '@soba/lib';
import { metaApiService } from './service';
import { asyncHandler } from '../shared/asyncHandler';
import { codeService } from '../../services/codeService';
import { getFilesConfig } from '../../../features/files/config';
import { listLoginIdentityProviders } from '../../db/repos/identityProviderRepo';

export const getPluginsMeta = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await metaApiService.getPlugins());
});

export const getFeaturesMeta = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await metaApiService.getFeatures());
});

export const getFeatureAvailabilityMeta = asyncHandler(async (req: Request, res: Response) => {
  const { code, workspaceId, formId } = req.query as {
    code: string;
    workspaceId?: string;
    formId?: string;
  };
  res.json(await metaApiService.getFeatureAvailability({ code, workspaceId, formId }));
});

export const getFormEnginesMeta = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await metaApiService.getFormEngines());
});

export const getLoginProvidersMeta = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await listLoginIdentityProviders(req.sortLocale!) });
});

export const getBuildMeta = (_req: Request, res: Response) => {
  res.json(metaApiService.getBuild());
};

export const getFrontendConfigMeta = (_req: Request, res: Response) => {
  res.json(metaApiService.getFrontendConfig());
};

/** Files feature config (upload size limit + always-blocked extensions); gated by the files feature. */
export const getFilesConfigMeta = (_req: Request, res: Response) => {
  res.json(getFilesConfig());
};

export const getCodesMeta = asyncHandler(async (req: Request, res: Response) => {
  const onlyEnabledFeatures = req.query.only_enabled_features === 'true';
  const codeSetFilter = req.query.code_set as string | undefined;
  const sourceFilter = req.query.source as string | undefined;
  const isActiveFilter = req.query.is_active as string | undefined;

  const codeSets = await codeService.getRegisteredCodeSets({ onlyEnabledFeatures });
  let codeSetNames = [...new Set(codeSets.map((r) => r.codeSet))];
  if (codeSetFilter) {
    const wanted = new Set(
      codeSetFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    codeSetNames = codeSetNames.filter((name) => wanted.has(name));
  }
  if (sourceFilter) {
    codeSetNames = codeSetNames.filter((name) =>
      codeSets.some(
        (r) =>
          r.codeSet === name &&
          (sourceFilter === 'core' ? r.providerType === 'core' : r.featureCode === sourceFilter),
      ),
    );
  }

  const codesBySet = await Promise.all(
    codeSetNames.map((codeSet) =>
      codeService.getCodes(codeSet, { activeOnly: isActiveFilter === 'true', onlyEnabledFeatures }),
    ),
  );
  const result: CodesKeyedMetaResponse = {};
  for (const [index, codeSet] of codeSetNames.entries()) {
    const items = codesBySet[index];
    let list = items;
    if (isActiveFilter === 'false') list = items.filter((r) => !r.isActive);
    if (sourceFilter) list = list.filter((r) => r.source === sourceFilter);
    result[codeSet] = list.map((r) => ({
      code: r.code,
      display: r.display,
      sort_order: r.sortOrder,
      is_active: r.isActive,
      source: r.source,
    }));
  }
  res.json(result);
});

export const getRolesMeta = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as {
    code?: string;
    source?: string;
    status?: string;
    only_enabled_features?: 'true' | 'false';
  };
  const codeFilter = query.code
    ? query.code
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const result = await metaApiService.getRoles({
    code: codeFilter,
    source: query.source,
    status: query.status,
    onlyEnabledFeatures: query.only_enabled_features === 'true',
  });
  const body: RolesMetaResponse = {
    roles: result.roles.map((r) => ({
      roleCode: r.code,
      name: r.name,
      description: r.description,
      status: r.status,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
  res.json(body);
});
