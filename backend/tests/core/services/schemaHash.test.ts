import { canonicalJson, schemaHashOf } from '../../../src/core/services/schemaHash';

describe('canonicalJson', () => {
  it.each([
    [
      'sorts keys at every depth',
      { b: 1, a: { d: [{ f: 1, e: 2 }], c: null } },
      '{"a":{"c":null,"d":[{"e":2,"f":1}]},"b":1}',
    ],
    ['keeps array order', [3, 1, 2], '[3,1,2]'],
    ['drops undefined members, as JSON.stringify does', { a: undefined, b: 1 }, '{"b":1}'],
    ['writes undefined array items as null, as JSON.stringify does', [undefined, 1], '[null,1]'],
    [
      'sorts keys by code unit, not locale',
      { b: 1, B: 2, '\u00e9': 3 },
      '{"B":2,"b":1,"\u00e9":3}',
    ],
    ['escapes keys and strings', { 'a"b': 'c\nd' }, '{"a\\"b":"c\\nd"}'],
  ])('%s', (_label, value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
    // Equal to JSON.stringify apart from key order.
    expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });
});

describe('schemaHashOf', () => {
  const name = { key: 'name', type: 'textfield' };
  const email = { key: 'email', type: 'email' };
  const schema = { display: 'form', components: [name, email] };
  // An engine that does not say what it renders.
  const whole = {};
  // An engine that renders the display and components only.
  const engine = {
    renderedSchema: (doc: Record<string, unknown>) => ({
      display: doc.display,
      components: doc.components,
    }),
  };

  it('is a SHA-256 hex digest', () => {
    expect(schemaHashOf(schema, whole)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is equal for equal schemas whatever their key order', () => {
    const reordered = {
      components: [
        { type: 'textfield', key: 'name' },
        { type: 'email', key: 'email' },
      ],
      display: 'form',
    };
    expect(schemaHashOf(reordered, whole)).toBe(schemaHashOf(schema, whole));
  });

  it.each([
    ['a changed value', { display: 'wizard', components: schema.components }],
    ['reordered components', { ...schema, components: [email, name] }],
    ['an added key', { ...schema, title: 'Permit' }],
  ])('differs for %s', (_label, changed) => {
    expect(schemaHashOf(changed, whole)).not.toBe(schemaHashOf(schema, whole));
  });

  it('covers only what the engine renders', () => {
    const titled = { ...schema, title: 'Permit' };
    expect(schemaHashOf(titled, engine)).toBe(schemaHashOf(schema, engine));
    expect(schemaHashOf({ ...titled, display: 'wizard' }, engine)).not.toBe(
      schemaHashOf(schema, engine),
    );
  });
});
