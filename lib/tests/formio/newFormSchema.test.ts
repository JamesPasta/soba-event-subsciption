import { newFormSchema } from '../../src/formio/newFormSchema';

describe('newFormSchema', () => {
  it('holds a Submit button and nothing else', () => {
    expect(newFormSchema()).toEqual({
      components: [expect.objectContaining({ type: 'button', key: 'submit', action: 'submit' })],
    });
  });

  it('returns a new object each call', () => {
    const first = newFormSchema();
    first.components.push({ type: 'textfield', key: 'name' });
    first.components[0].label = 'Send';

    expect(newFormSchema().components).toHaveLength(1);
    expect(newFormSchema().components[0].label).toBe('Submit');
  });
});
