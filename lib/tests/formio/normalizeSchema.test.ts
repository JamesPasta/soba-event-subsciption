import { normalizeSchema } from '../../src/formio/normalizeSchema';

type Comp = Record<string, unknown>;

describe('normalizeSchema', () => {
  // CHEFS-1 simple* types map to their Form.io v5 equivalents; v5 types pass through.
  it.each([
    ['simplenumberadvanced', 'number'],
    ['simpleemail', 'email'],
    ['textfield', 'textfield'],
    ['simplephonenumber', 'phoneNumber'],
    ['simplephonenumberadvanced', 'phoneNumber'],
    ['phoneNumber', 'phoneNumber'],
  ])('maps component type %s to %s', (type, expected) => {
    const out = normalizeSchema({ components: [{ type, key: 'a' }] });
    expect((out.components as Comp[])[0].type).toBe(expected);
  });

  it('maps a simple* type without reaching into the fields after it', () => {
    const out = normalizeSchema({ components: [{ type: 'simpletextfield', key: 'advanced' }] });
    expect((out.components as Comp[])[0]).toMatchObject({ type: 'textfield', key: 'advanced' });
  });

  it('keeps only form-definition fields and drops engine/document metadata', () => {
    const out = normalizeSchema({
      title: 'My Form',
      name: 'soba-abc',
      path: 'soba-abc',
      tags: ['soba', 'ws'],
      access: [{ type: 'read_all', roles: ['x'] }],
      submissionAccess: [],
      properties: { soba_workspace_id: 'ws' },
      pdfComponents: [],
      _id: 'mongoid',
      machineName: 'm',
      components: [{ type: 'textfield', key: 'a' }],
    });
    expect(Object.keys(out).sort()).toEqual(['components', 'display', 'title', 'type']);
    expect(out.title).toBe('My Form');
    expect(out.type).toBe('form');
    expect(out.display).toBe('form');
  });

  it('drops a non-object widget and flattened widget.* keys, recursing into nested components', () => {
    const out = normalizeSchema({
      components: [
        { type: 'textfield', key: 'a', widget: '', 'widget.type': 'input' },
        { type: 'day', key: 'b', widget: null },
        {
          type: 'container',
          key: 'p',
          components: [{ type: 'textfield', key: 'n', widget: '' }],
        },
      ],
    });
    const comps = out.components as Comp[];
    expect('widget' in comps[0]).toBe(false);
    expect('widget.type' in comps[0]).toBe(false);
    expect('widget' in comps[1]).toBe(false);
    const nested = (comps[2].components as Comp[])[0];
    expect('widget' in nested).toBe(false);
  });

  it('keeps a valid object widget', () => {
    const out = normalizeSchema({
      components: [{ type: 'datetime', key: 'd', widget: { type: 'calendar' } }],
    });
    expect((out.components as Comp[])[0].widget).toEqual({ type: 'calendar' });
  });
});
