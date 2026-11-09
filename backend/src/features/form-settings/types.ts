import type { Router } from 'express';
import type { CreateFormSettings } from '@soba/lib';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { FeatureCode } from '../../core/db/codes';
import type { DbOrTx } from '../../core/db/client';
import type { RegisterOpenApiPaths } from '../../core/api/shared/openapi';

/** A table a settings group owns. Every one records the workspace its form belongs to. */
export type WorkspaceScopedTable = PgTable & { workspaceId: AnyPgColumn };

/** What a group needs to create its row for a new form or workspace. */
export interface SettingsRowInput {
  workspaceId: string;
  actorDisplayLabel: string | null;
}

/** A new form's row: a group whose key is in `settings` starts with those values. */
export interface FormSettingsRowInput extends SettingsRowInput {
  formId: string;
  /** Who creates the form, for a group that audits the values it starts with. */
  actorId: string;
  settings?: CreateFormSettings;
}

/**
 * A group's workspace level, served at /workspaces/:id/settings/<key>, for a group whose values are
 * shared by the workspace's forms. Each form inherits them or overrides them with its own.
 */
export interface WorkspaceSettingsScope {
  /** Built when the workspace settings router mounts. */
  router: () => Router;
  /** Creates the workspace's row, in the transaction that creates the workspace. */
  createForWorkspace: (input: SettingsRowInput, executor: DbOrTx) => Promise<void>;
}

/**
 * A self-contained group of form settings, served at /design/forms/:id/settings/<key>. The shared
 * settings router resolves the form and checks the group's feature before the group's routes run.
 * A group either creates the form's row with the form or reads a missing row as its default.
 */
export interface FormSettingsModule {
  /** URL segment of the group. */
  key: string;
  /** Mount order; lower first. Unrelated to the frontend section weight, which orders the tab. */
  weight: number;
  /** When set, the group's routes 404 unless the feature is available for the form. */
  featureCode?: FeatureCode;
  /** Built when the settings router mounts, so reading the registry costs nothing. */
  router: () => Router;
  registerOpenApi: RegisterOpenApiPaths;
  /** Cleared by dev-data purge before forms are deleted, in this order. */
  tables: WorkspaceScopedTable[];
  /** Creates the form's row, in the transaction that creates the form, for a group that keeps one. */
  createForForm: (input: FormSettingsRowInput, executor: DbOrTx) => Promise<void>;
  /** Set when the group's values are shared by the workspace's forms. */
  workspace?: WorkspaceSettingsScope;
}
