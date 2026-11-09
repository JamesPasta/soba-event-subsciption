import { ensureFreshToken } from '@/src/shared/auth/tokenRefresh';
import { SessionExpiredError } from '@/src/shared/api/sobaFetch';
import { getActiveSubmission } from '../activeSubmission';

/**
 * The bearer for a CHEFS upload, download or delete, on sobaFetch's rule: an affirmative no-session
 * sends no stale token, and without a verdict the instance's token goes out. A signed-in fill session
 * left with no token throws SessionExpiredError rather than send the file anonymously.
 */
export async function uploadToken(instanceToken: () => string | undefined): Promise<string> {
  const outcome = await ensureFreshToken();
  if (outcome.status === 'token') return outcome.token;
  const token = outcome.status === 'unavailable' ? (instanceToken() ?? '') : '';
  if (!token && getActiveSubmission()?.signedIn) throw new SessionExpiredError();
  return token;
}
