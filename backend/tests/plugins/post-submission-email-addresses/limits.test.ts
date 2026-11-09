import { createEnvReader } from '../../../src/core/config/env';
import { createPluginConfigReaderFrom } from '../../../src/core/config/pluginConfig';
import {
  exceededLimit,
  readHourlyLimits,
} from '../../../src/plugins/post-submission-email-addresses/limits';

const configFrom = (vars: Record<string, string>) =>
  createPluginConfigReaderFrom(createEnvReader(vars), 'post-submission-email-addresses');

describe('readHourlyLimits', () => {
  it('defaults to 500 per form, 2000 per workspace and 5000 for the environment', () => {
    expect(readHourlyLimits(configFrom({}))).toEqual({
      form: 500,
      workspace: 2000,
      environment: 5000,
    });
  });

  it('reads PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_*', () => {
    expect(
      readHourlyLimits(
        configFrom({
          PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_FORM_HOURLY_LIMIT: '100',
          PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_WORKSPACE_HOURLY_LIMIT: '300',
          PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_ENVIRONMENT_HOURLY_LIMIT: '900',
        }),
      ),
    ).toEqual({ form: 100, workspace: 300, environment: 900 });
  });

  it.each(['99', '1.5', '1000001'])('refuses a limit of %s', (value) => {
    expect(() =>
      readHourlyLimits(
        configFrom({ PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_FORM_HOURLY_LIMIT: value }),
      ),
    ).toThrow(
      'PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_FORM_HOURLY_LIMIT must be a whole number from 100 to 1000000',
    );
  });

  it('refuses a value that is not a number, naming the variable', () => {
    expect(() =>
      readHourlyLimits(
        configFrom({ PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_WORKSPACE_HOURLY_LIMIT: 'lots' }),
      ),
    ).toThrow(
      'PLUGIN_POST_SUBMISSION_EMAIL_ADDRESSES_WORKSPACE_HOURLY_LIMIT must be a whole number from 100 to 1000000',
    );
  });
});

describe('exceededLimit', () => {
  const limits = { form: 500, workspace: 2000, environment: 5000 };

  it('lets a list through up to each limit', () => {
    expect(
      exceededLimit({ form: 400, workspace: 1900, environment: 4900 }, 100, limits),
    ).toBeNull();
  });

  it('names the first limit the list would pass, with what was already sent', () => {
    expect(exceededLimit({ form: 401, workspace: 0, environment: 0 }, 100, limits)).toEqual({
      scope: 'form',
      sent: 401,
      limit: 500,
    });
    expect(exceededLimit({ form: 0, workspace: 1950, environment: 0 }, 100, limits)).toEqual({
      scope: 'workspace',
      sent: 1950,
      limit: 2000,
    });
    expect(exceededLimit({ form: 0, workspace: 0, environment: 4999 }, 2, limits)).toEqual({
      scope: 'environment',
      sent: 4999,
      limit: 5000,
    });
  });
});
