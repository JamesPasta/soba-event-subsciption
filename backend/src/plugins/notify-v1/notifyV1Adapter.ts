import { z } from 'zod';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import {
  SendEmailSchema,
  withProviderDetail,
  type EmailReceipt,
  type NotificationAdapter,
  type NotificationReadinessResult,
  type SendEmail,
} from '../../core/integrations/notification/NotificationAdapter';
import { HttpClient, HttpClientError, HttpClientTimeoutError } from '../../core/http/httpClient';
import { ServiceUnavailableError, ValidationError } from '../../core/errors';
import { log } from '../../core/logging';

const EMAIL_PATH = 'notifysimple/email';
// Keyed and side-effect free: the readiness check exercises the URL and the API key.
const CHANNELS_PATH = 'code-tables/channels';

// Only Notify's channel list counts: a wrong base URL can reach the Notify web app, which answers 200.
const ChannelsSchema = z.array(z.object({ code: z.string().min(1) })).min(1);

// Notify adds statuses over time, so any status is accepted.
const NotifyAcceptanceSchema = z.object({
  notifyId: z.string().min(1),
  status: z.string().min(1),
});

// Notify's error body, e.g. a safelist refusal: { message, errors: [text naming the recipient] }.
const NotifyErrorSchema = z.object({
  message: z.string().optional(),
  errors: z.array(z.string()).optional(),
});

/** Notify's message and errors from an error body, or the body itself when it is not that shape. */
function notifyErrorText(body: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body.trim() || undefined;
  }
  const parsed = NotifyErrorSchema.safeParse(json);
  if (!parsed.success) return body.trim() || undefined;
  const parts = [parsed.data.message, ...(parsed.data.errors ?? [])].filter((part) => !!part);
  return parts.length > 0 ? parts.join(': ') : undefined;
}

// Only expose known transport codes; arbitrary error messages can include private data.
const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** `action` failed, with the cause reduced to a status, timeout or known network code. */
function failureMessage(action: string, err: unknown): string {
  if (err instanceof ServiceUnavailableError) return err.message;
  if (err instanceof HttpClientError) return `${action} failed (upstream HTTP ${err.status})`;
  if (err instanceof HttpClientTimeoutError)
    return `${action} failed (timeout; budget ${err.budgetMs}ms)`;
  if (err instanceof SyntaxError) return 'Notify returned an invalid JSON response';
  if (err instanceof Error) {
    const cause = err.cause;
    let code: unknown;
    if (typeof cause === 'object' && cause !== null && 'code' in cause) {
      code = cause.code;
    } else if ('code' in err) {
      code = err.code;
    }
    if (typeof code === 'string' && NETWORK_CODES.has(code))
      return `${action} failed (network ${code})`;
    if (err instanceof TypeError) return `${action} failed (network or request error)`;
  }
  return `${action} failed`;
}

/** Notify v1 email client using the configured API key. */
export class NotifyV1Adapter implements NotificationAdapter {
  private readonly http: HttpClient;
  private readonly debugResponses: boolean;

  constructor(config: PluginConfigReader) {
    this.http = new HttpClient({
      // ENDPOINT includes /api/v1.
      baseUrl: config.getRequired('ENDPOINT'),
      defaultHeaders: { 'X-API-KEY': config.getRequired('API_KEY') },
      timeoutMs: config.getOptionalNumber('TIMEOUT_MS'),
    });
    this.debugResponses = config.getOptional('DEBUG_RESPONSES') === 'true';
  }

  async readinessCheck(): Promise<NotificationReadinessResult> {
    try {
      const response = await this.http.getForBinary(CHANNELS_PATH);
      const body: unknown = JSON.parse(response.data.toString('utf8'));
      if (!ChannelsSchema.safeParse(body).success) {
        return { ok: false, message: 'Notify readiness check got an unexpected response' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: failureMessage('Notify readiness check', err) };
    }
  }

  async sendEmail(email: SendEmail): Promise<EmailReceipt> {
    const request = SendEmailSchema.safeParse(email);
    // The issues name the invalid addresses, so they stay out of the error.
    if (!request.success) throw new ValidationError('Notify email request is not valid');
    try {
      const response = await this.http.postJsonForBinary(EMAIL_PATH, request.data);
      return this.receipt(JSON.parse(response.data.toString('utf8')));
    } catch (err) {
      throw this.sendFailure(err);
    }
  }

  /**
   * The error for a failed send. The message never carries the upstream body; Notify's error text
   * goes to the audit as provider detail.
   */
  private sendFailure(err: unknown): ServiceUnavailableError {
    const error = new ServiceUnavailableError(failureMessage('Notify email send', err));
    if (!(err instanceof HttpClientError)) return error;
    if (this.debugResponses) {
      log.error(
        {
          upstreamStatus: err.status,
          upstreamStatusText: err.statusText,
          upstreamBody: err.body,
        },
        'Notify upstream error response (debug)',
      );
    }
    return withProviderDetail(
      Object.assign(error, { upstreamStatus: err.status }),
      notifyErrorText(err.body),
    );
  }

  private receipt(body: unknown): EmailReceipt {
    const parsed = NotifyAcceptanceSchema.safeParse(body);
    if (!parsed.success) {
      if (this.debugResponses) {
        log.error(
          { upstreamBody: body, validationIssues: parsed.error.issues },
          'Notify unexpected response (debug)',
        );
      }
      throw new ServiceUnavailableError('Notify returned an unexpected response');
    }
    return { id: parsed.data.notifyId, status: parsed.data.status };
  }
}
