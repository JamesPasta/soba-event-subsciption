import { env } from '../../config/env';
import { getPostSubmissionActionPluginDefinitions } from '../plugins/PluginRegistry';
import type { PostSubmissionActionPluginDefinition } from './PostSubmissionActionPluginDefinition';

/** POST_SUBMISSION_ACTION_PLUGINS: the action codes this environment runs, in order. */
export const getEnabledPostSubmissionActionCodes = (): string[] => [
  ...new Set(env.getPostSubmissionActionPlugins()),
];

/** The installed action plugins this environment enables, in POST_SUBMISSION_ACTION_PLUGINS order. */
export const getPostSubmissionActions = (): PostSubmissionActionPluginDefinition[] => {
  const enabled = getEnabledPostSubmissionActionCodes();
  if (enabled.length === 0) return [];
  const installed = new Map(
    getPostSubmissionActionPluginDefinitions().map((definition) => [definition.code, definition]),
  );
  return enabled.flatMap((code) => {
    const definition = installed.get(code);
    return definition ? [definition] : [];
  });
};

/** An enabled, installed action plugin by code. */
export const findPostSubmissionAction = (
  code: string,
): PostSubmissionActionPluginDefinition | undefined =>
  getPostSubmissionActions().find((definition) => definition.code === code);

/** An installed action plugin by code, enabled here or not. A pod older than the plugin has none. */
export const findInstalledPostSubmissionAction = (
  code: string,
): PostSubmissionActionPluginDefinition | undefined =>
  getPostSubmissionActionPluginDefinitions().find((definition) => definition.code === code);
