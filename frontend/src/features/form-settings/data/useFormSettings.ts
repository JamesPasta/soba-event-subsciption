import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { getFormSettings, setFormSettings } from './api';

/**
 * A settings group of a form, and a save that puts the saved settings in the cache. A save refused
 * because someone else saved first reads the group again before the error reaches the caller.
 */
export function useFormSettings<TSettings, TBody = TSettings>(key: string, formId: string) {
  const { data, error, mutate } = useAuthedSWR<TSettings>(
    ['form-settings', key, formId],
    (token) => getFormSettings<TSettings>(token, formId, key),
    sessionReadConfig,
  );

  const save = async (token: string, body: TBody): Promise<void> => {
    try {
      await mutate(setFormSettings<TBody, TSettings>(token, formId, key, body), {
        revalidate: false,
      });
    } catch (err) {
      if (isConflict(err)) await mutate();
      throw err;
    }
  };

  return { settings: data, error: error ? classifyDataError(error) : null, save };
}
