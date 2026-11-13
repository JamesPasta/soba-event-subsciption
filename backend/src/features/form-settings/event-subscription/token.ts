import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableError } from '../../../core/errors';

const KEY_ENV = 'SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY';

const encryptionKey = (): Buffer => {
  const value = process.env[KEY_ENV];
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new ServiceUnavailableError('Endpoint token storage is not configured');
  }
  return Buffer.from(value, 'hex');
};

/** AES-GCM authenticates both the ciphertext and its format version. */
export const encryptSubscriptionToken = (token: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('event-subscription:v1'));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const decryptSubscriptionToken = (value: string): string => {
  const [version, encodedIv, encodedTag, encodedData, extra] = value.split(':');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedData || extra !== undefined) {
    throw new Error('Invalid event subscription token ciphertext');
  }
  const iv = Buffer.from(encodedIv, 'base64url');
  const tag = Buffer.from(encodedTag, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Invalid event subscription token ciphertext');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from('event-subscription:v1'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encodedData, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};
