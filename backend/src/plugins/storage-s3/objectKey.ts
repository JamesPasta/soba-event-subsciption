import type { UploadFileInput } from '../../core/integrations/storage-engine/StorageEngineAdapter';
import { storedObjectName } from '../../core/integrations/storage-engine/storageKey';

/**
 * The object key: the profile's root (when set), the owning feature's prefix, the workspace, then
 * the stored object name.
 */
export function objectKey(
  root: string | undefined,
  input: Pick<UploadFileInput, 'prefix' | 'workspaceId'>,
): string {
  return [root, input.prefix, input.workspaceId, storedObjectName()].filter(Boolean).join('/');
}

/**
 * The key an `s3:<bucket>:<key>` ref points at, when it is in the profile's bucket and under its
 * root; null otherwise.
 */
export function ownedKey(ref: string, bucket: string, root: string | undefined): string | null {
  if (!ref.startsWith('s3:')) return null;
  const [, refBucket, ...rest] = ref.split(':');
  const key = rest.join(':');
  if (refBucket !== bucket || key === '') return null;
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  if (root && !key.startsWith(`${root}/`)) return null;
  return key;
}
