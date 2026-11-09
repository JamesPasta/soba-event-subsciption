/** A Form.io component definition. */
type FormioComponent = Record<string, unknown>;

/** A button that submits the form, as the Form.io builder defines its default one. */
export const submitButton = (): FormioComponent => ({
  type: 'button',
  label: 'Submit',
  key: 'submit',
  size: 'md',
  block: false,
  action: 'submit',
  disableOnInvalid: true,
  theme: 'primary',
  input: true,
  tableView: false,
});

/**
 * The schema a new or empty form version starts from: a Submit button and nothing else. A new object
 * each call, since the Form.io builder mutates the schema it is given.
 */
export const newFormSchema = (): { components: FormioComponent[] } => ({
  components: [submitButton()],
});
