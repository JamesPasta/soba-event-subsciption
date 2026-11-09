import { SaveFormVersionBodySchema } from '../../../../src/core/api/forms/schema';

describe('SaveFormVersionBodySchema', () => {
  it('keeps only the note', () => {
    const result = SaveFormVersionBodySchema.safeParse({
      eventType: 'publish',
      note: 'Reworded the intro',
      engine_schema_ref: 'another-form',
      formioFormDefinition: { components: [] },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ note: 'Reworded the intro' });
  });
});
