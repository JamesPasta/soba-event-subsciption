import { eq, inArray, sql } from 'drizzle-orm';
import { quietDb } from '../client';
import { files, jobs } from '../schema';
import type { FileRecord } from './fileRepo';

/**
 * What a job has produced so far, joined to its result file (`leftJoin(files, onResultFile)`). The
 * result's expiry and whether this run stored it are judged by the database clock.
 */
export const jobOutputColumns = {
  jobId: jobs.id,
  status: jobs.status,
  progressDone: jobs.progressDone,
  progressTotal: jobs.progressTotal,
  resultExpiresAt: jobs.resultExpiresAt,
  resultExpired: sql<boolean>`coalesce(${jobs.resultExpiresAt} <= now(), false)`,
  resultFileId: files.id,
  resultFilename: files.filename,
  resultSize: files.size,
  resultContentType: files.contentType,
  // A file from an earlier attempt is not this run's result.
  resultStoredThisRun: sql<boolean>`coalesce(${files.createdAt} >= ${jobs.startedAt}, false)`,
};

export const onResultFile = eq(files.id, jobs.resultFileId);

export interface JobOutputRow {
  jobId: string;
  status: string;
  progressDone: number | null;
  progressTotal: number | null;
  resultExpiresAt: Date | null;
  resultExpired: boolean;
  resultFileId: string | null;
  resultFilename: string | null;
  resultSize: number | null;
  resultContentType: string | null;
  resultStoredThisRun: boolean;
}

export const readJobOutputs = (jobIds: string[]): Promise<JobOutputRow[]> => {
  if (jobIds.length === 0) return Promise.resolve([]);
  return quietDb
    .select(jobOutputColumns)
    .from(jobs)
    .leftJoin(files, onResultFile)
    .where(inArray(jobs.id, jobIds));
};

/** A job's output and its result file's row, when it has one. */
export const readJobResultFile = async (
  jobId: string,
): Promise<{ output: JobOutputRow; file: FileRecord | null } | null> => {
  const [row] = await quietDb
    .select({ output: jobOutputColumns, file: files })
    .from(jobs)
    .leftJoin(files, onResultFile)
    .where(eq(jobs.id, jobId));
  return row ?? null;
};
