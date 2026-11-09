import type { PostSubmissionActionUi } from '../types';
import { addressesOf, needsAddress, withAddresses } from './addresses';
import EmailAddressesEditor from './EmailAddressesEditor';
import EmailAddressesView from './EmailAddressesView';

/** Emails a notice to a list of addresses. */
export const emailAddressesAction: PostSubmissionActionUi = {
  label: (dict) => dict.postSubmission.email.label,
  description: (dict) => dict.postSubmission.email.description,
  Editor: EmailAddressesEditor,
  View: EmailAddressesView,
  problem: (values, dict) => (needsAddress(values) ? dict.postSubmission.email.required : null),
  saved: (values) => withAddresses(values, addressesOf(values)),
};
