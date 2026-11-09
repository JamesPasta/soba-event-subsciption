import type { Request, Response } from 'express';
import type { StartSubmissionExportBody, SubmissionExportFieldsBody } from '@soba/lib';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { sendStoredFile } from '../../core/api/shared/sendStoredFile';
import type { ListExportsQuery } from './schema';
import { submissionExportService, type ExportContext } from './service';

type ExportParams = { id: string; exportId?: string };

// The form comes from the path; who is asking and the form's workspace from the resolved context.
const contextOf = (req: Request<ExportParams>): ExportContext => ({
  actorId: req.coreContext!.actorId,
  workspaceId: req.coreContext!.workspaceId!,
  formId: req.params.id,
});

export const getExportFields = asyncHandler(
  async (req: Request<ExportParams, unknown, SubmissionExportFieldsBody>, res: Response) => {
    res.json(await submissionExportService.fields(contextOf(req), req.body));
  },
);

// validateRequest merges the raw query back in, so only the named fields are passed on.
export const listExports = asyncHandler(async (req: Request<ExportParams>, res: Response) => {
  const query = req.query as unknown as ListExportsQuery;
  res.json(
    await submissionExportService.list(contextOf(req), {
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
    }),
  );
});

export const getExport = asyncHandler(async (req: Request<ExportParams>, res: Response) => {
  res.json(await submissionExportService.get(contextOf(req), req.params.exportId!));
});

export const startExport = asyncHandler(
  async (req: Request<ExportParams, unknown, StartSubmissionExportBody>, res: Response) => {
    res.status(201).json(await submissionExportService.start(contextOf(req), req.body));
  },
);

export const cancelExport = asyncHandler(async (req: Request<ExportParams>, res: Response) => {
  const { stopped, export: item } = await submissionExportService.cancel(
    contextOf(req),
    req.params.exportId!,
  );
  res.status(stopped ? 200 : 202).json(item);
});

export const downloadExport = asyncHandler(async (req: Request<ExportParams>, res: Response) => {
  const opened = await submissionExportService.openDownload(contextOf(req), req.params.exportId!);
  await sendStoredFile(res, opened.file, opened.content, 'attachment');
});
