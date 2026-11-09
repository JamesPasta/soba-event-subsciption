import * as Minio from 'minio';
import { storagePluginDefinition } from '../../../src/plugins/storage-s3';
import type { PluginConfigReader } from '../../../src/core/config/pluginConfig';

jest.mock('minio', () => ({ Client: jest.fn() }));

function makeConfig(values: Record<string, string>): PluginConfigReader {
  return {
    getRequired: (k: string) => {
      if (values[k] === undefined) throw new Error(`missing ${k}`);
      return values[k];
    },
    getOptional: (k: string, d?: string) => values[k] ?? d,
    getBoolean: () => false,
    getNumber: () => 0,
    getOptionalNumber: () => undefined,
    getCsv: () => [],
  };
}

const base = {
  ENDPOINT: 'http://localhost:9000',
  ACCESS_KEY: 'access',
  SECRET_KEY: 'secret',
  BUCKET_NAME: 'bucket',
};

describe('storage-s3 adapter', () => {
  it.each(['soba/dev', 'dev'])('accepts the root prefix %s', (prefix) => {
    expect(() =>
      storagePluginDefinition.createAdapter(makeConfig({ ...base, PREFIX: prefix })),
    ).not.toThrow();
  });

  it.each(['Dev', 'dev/', '/dev', '../dev'])('refuses the root prefix %j', (prefix) => {
    expect(() =>
      storagePluginDefinition.createAdapter(makeConfig({ ...base, PREFIX: prefix })),
    ).toThrow(`Invalid storage profile PREFIX '${prefix}'`);
  });

  it.each([
    [{ ENDPOINT: 'https://s3.example.ca' }, 's3.example.ca', 443, true],
    [{ ENDPOINT: 'http://s3.example.ca' }, 's3.example.ca', 80, false],
    [{ ENDPOINT: 'https://s3.example.ca:8443' }, 's3.example.ca', 8443, true],
    [{ ENDPOINT: 'https://s3.example.ca', PORT: '9443' }, 's3.example.ca', 9443, true],
    [{ ENDPOINT: 'https://s3.example.ca:8443', PORT: '9443' }, 's3.example.ca', 8443, true],
    [{ ENDPOINT: 'http://s3.example.ca', USE_SSL: 'true' }, 's3.example.ca', 80, false],
    [{ ENDPOINT: 's3.example.ca' }, 's3.example.ca', 9000, false],
    [{ ENDPOINT: 's3.example.ca', PORT: '443', USE_SSL: 'true' }, 's3.example.ca', 443, true],
  ])('connects for %j to %s:%i with SSL %s', (endpoint, endPoint, port, useSSL) => {
    jest.mocked(Minio.Client).mockClear();
    storagePluginDefinition.createAdapter(makeConfig({ ...base, ...endpoint }));
    expect(Minio.Client).toHaveBeenCalledWith(expect.objectContaining({ endPoint, port, useSSL }));
  });

  it('uploads in 16 MiB parts, so a stream is never held whole in memory', () => {
    jest.mocked(Minio.Client).mockClear();
    storagePluginDefinition.createAdapter(makeConfig(base));
    expect(Minio.Client).toHaveBeenCalledWith(
      expect.objectContaining({ partSize: 16 * 1024 * 1024 }),
    );
  });
});
