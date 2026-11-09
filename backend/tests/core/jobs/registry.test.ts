import { JobRegistry, type JobTypeDefinition } from '../../../src/core/jobs/registry';

const job = (type: string, pool: 'light' | 'heavy'): JobTypeDefinition => ({
  type,
  pool,
  run: () => Promise.resolve(),
});

describe('JobRegistry', () => {
  it('lists the types in each pool', () => {
    const registry = new JobRegistry()
      .register(job('email', 'light'))
      .register(job('export', 'heavy'))
      .register(job('fan-out', 'light'));
    expect(registry.typesIn('light')).toEqual(['email', 'fan-out']);
    expect(registry.typesIn('heavy')).toEqual(['export']);
  });

  it('refuses a type registered twice', () => {
    const registry = new JobRegistry().register(job('email', 'light'));
    expect(() => registry.register(job('email', 'heavy'))).toThrow(
      "Job type 'email' is already registered",
    );
  });

  it('throws when a required type is missing', () => {
    expect(() => new JobRegistry().require('email')).toThrow("Job type 'email' is not registered");
  });
});
