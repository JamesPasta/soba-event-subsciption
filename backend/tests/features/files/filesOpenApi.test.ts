import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registerFilesOpenApi } from '../../../src/features/files/schema';

type Operations = Record<string, { deprecated?: boolean }>;

function filesPaths(): Record<string, Operations> {
  const registry = new OpenAPIRegistry();
  registerFilesOpenApi(registry);
  const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'test', version: '1' },
  });
  return doc.paths as Record<string, Operations>;
}

/** Each method documented under a path, paired with whether it is deprecated. */
const operations = (paths: Record<string, Operations>, path: string) =>
  Object.entries(paths[path] ?? {}).map(([method, op]) => [method, op.deprecated === true]);

describe('files OpenAPI', () => {
  const paths = filesPaths();

  it.each([
    ['/files', false],
    ['/submit/files', true],
  ])('%s documents upload, download and delete (deprecated: %s)', (base, deprecated) => {
    expect(operations(paths, base)).toEqual([['post', deprecated]]);
    expect(operations(paths, `${base}/{id}`)).toEqual([
      ['get', deprecated],
      ['delete', deprecated],
    ]);
  });
});
