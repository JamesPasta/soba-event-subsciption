import { PrintChoice, PrintUploadPermissions, type PrintChoiceCode } from './codes';
import { hasAllPermissions } from './formAccess';

/** What the print choice reads for one caller on one submission. */
export interface PrintFacts {
  /** A render backend serves the submission's form. False when the facts could not be read. */
  renderAvailable: boolean;
  /** The submission's form version has a stored template. */
  hasTemplate: boolean;
  /** The caller's permission codes on the form; none on the submit surface. */
  permissions: readonly string[];
}

/** Without a render backend only the browser prints. */
export const printChoiceOf = (facts: PrintFacts): PrintChoiceCode => {
  if (!facts.renderAvailable) return PrintChoice.browser;
  if (hasAllPermissions(facts.permissions, PrintUploadPermissions)) return PrintChoice.options;
  return facts.hasTemplate ? PrintChoice.template : PrintChoice.browser;
};
