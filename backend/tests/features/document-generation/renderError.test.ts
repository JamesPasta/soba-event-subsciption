import {
  TEMPLATE_NOT_RENDERED,
  toRenderError,
} from '../../../src/features/document-generation/renderError';
import {
  ServiceUnavailableError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../../src/core/errors';
import { HttpClientError } from '../../../src/core/http/httpClient';
import { httpErrorToAppError } from '../../../src/core/http/httpErrorMapper';
import { log } from '../../../src/core/logging';

const context = { code: 'cdogs-v2', templateId: 'tpl-1' };

describe('toRenderError', () => {
  it.each([
    new ValidationError('CDOGS error 400: {"detail":"bad tag {d.secret}"}'),
    new UnsupportedMediaTypeError('CDOGS error 415: unsupported'),
    new UnprocessableEntityError('CDOGS error 422: cannot convert'),
  ])('returns a generic 422 for a backend refusal, without its detail (%s)', (err) => {
    const mapped = toRenderError(err, context);
    expect(mapped).toBeInstanceOf(UnprocessableEntityError);
    expect(mapped.message).toBe(TEMPLATE_NOT_RENDERED);
    expect(mapped.code).toBe('render_failed');
  });

  it.each([
    new ServiceUnavailableError('CDOGS error 500: at Carbone.render (/srv/app/lib/carbone.js:12)'),
    new Error('PLUGIN_CDOGS_V2_TOKEN_URL is required'),
  ])('returns a generic 503 for any other failure, without its detail (%s)', (err) => {
    const mapped = toRenderError(err, context);
    expect(mapped).toBeInstanceOf(ServiceUnavailableError);
    expect(mapped.message).toBe('Document generation is unavailable');
    expect(mapped.code).toBe('render_unavailable');
  });

  it('returns a generic 422 when the backend refuses the request as too large', () => {
    const tooLarge = new HttpClientError(413, 'Payload Too Large', 'too big', 'http://cdogs.test');
    const mapped = toRenderError(httpErrorToAppError(tooLarge, 'CDOGS'), context);
    expect(mapped).toBeInstanceOf(UnprocessableEntityError);
    expect(mapped.message).toBe(TEMPLATE_NOT_RENDERED);
    expect(mapped.code).toBe('render_failed');
  });

  it('logs the statuses and error class, never the backend body', () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const body = '{"detail":"cannot render","data":{"sin":"123 456 789"}}';
      const upstream = new HttpClientError(429, 'Too Many Requests', body, 'http://cdogs.test');
      toRenderError(httpErrorToAppError(upstream, 'CDOGS'), context);

      expect(warn).toHaveBeenCalledWith(
        { ...context, status: 503, upstreamStatus: 429, error: 'ServiceUnavailableError' },
        'document generation backend failed',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('123 456 789');
    } finally {
      warn.mockRestore();
    }
  });
});
