import { z } from 'zod';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import { OAuth2TokenProvider } from '../../core/auth/oauth2TokenProvider';
import { HttpClient, HttpClientError, resolveTimeoutMs } from '../../core/http/httpClient';
import { ServiceUnavailableError } from '../../core/errors';
import {
  CredentialRequestRejectedError,
  IssueCredentialRequestSchema,
  type IssueCredentialRequest,
  type IssuedApiKey,
  type CredentialIssuerAdapter,
  type CredentialIssuerReadinessResult,
} from '../../core/integrations/credential-issuer/CredentialIssuerAdapter';

const CredentialSchema = z.object({
  flow: z.enum(['kong-api-key-only', 'kong-api-key-acl']),
  clientId: z.string().min(1),
  apiKey: z.string().min(1),
});

/** APS-specific transport. Workspace ownership and issuance uniqueness belong to the consumer. */
export class ApsCredentialIssuerAdapter implements CredentialIssuerAdapter {
  readonly available = true;
  private readonly client: HttpClient;
  private readonly tokenProvider: OAuth2TokenProvider;
  private readonly consumersPath: string;
  private readonly environmentAppId: string;

  constructor(config: PluginConfigReader) {
    const baseUrl = config.getRequired('API_BASE_URL');
    const gatewayId = config.getRequired('GATEWAY_ID');
    this.environmentAppId = config.getRequired('ENVIRONMENT_APP_ID');
    const timeoutMs = resolveTimeoutMs(
      config.getOptionalNumber('TIMEOUT_MS'),
      'PLUGIN_APS_CREDENTIAL_ISSUER_V3_TIMEOUT_MS',
    );
    this.tokenProvider = new OAuth2TokenProvider({
      tokenUrl: config.getRequired('TOKEN_URL'),
      clientId: config.getRequired('CLIENT_ID'),
      clientSecret: config.getRequired('CLIENT_SECRET'),
      label: 'aps-credential-issuer-v3',
      timeoutMs,
    });
    this.client = new HttpClient({
      baseUrl,
      timeoutMs,
      getToken: (remaining) => this.tokenProvider.getToken(remaining),
    });
    this.consumersPath = `gateways/${encodeURIComponent(gatewayId)}/consumers`;
  }

  /** Token authentication only: does not prove gateway reachability or CredentialIssuer.Generate. */
  async readinessCheck(): Promise<CredentialIssuerReadinessResult> {
    try {
      await this.tokenProvider.getToken();
      return {
        ok: true,
        message: 'Issuer token acquired; gateway issuance permission not checked',
      };
    } catch {
      return { ok: false, message: 'APS issuer authentication failed' };
    }
  }

  async issue(request: IssueCredentialRequest): Promise<IssuedApiKey> {
    const parsed = IssueCredentialRequestSchema.safeParse(request);
    if (!parsed.success) throw new CredentialRequestRejectedError();
    const input = parsed.data;
    return this.send('issue', this.consumersPath, {
      environmentAppId: this.environmentAppId,
      application: { name: input.applicationName, description: input.applicationDescription },
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.aclGroups?.length ? { controls: { aclGroups: input.aclGroups } } : {}),
    });
  }

  async regenerate(clientId: string): Promise<IssuedApiKey> {
    if (!clientId.trim()) throw new CredentialRequestRejectedError();
    const credential = await this.send(
      'regenerate',
      `${this.consumersPath}/${encodeURIComponent(clientId)}?action=regenerate`,
    );
    if (credential.clientId !== clientId) {
      throw new ServiceUnavailableError(
        'APS returned a different consumer identity after regeneration; reconcile the consumer before retrying',
      );
    }
    return credential;
  }

  private async send(
    action: 'issue' | 'regenerate',
    path: string,
    body?: unknown,
  ): Promise<IssuedApiKey> {
    const deadline = this.client.deadline();
    await this.requireToken(deadline);
    try {
      return await this.request(action, path, body, deadline);
    } catch (err) {
      // Retry only a confirmed authentication rejection, never an ambiguous transport failure.
      if (err instanceof HttpClientError && err.status === 401) {
        this.tokenProvider.clearCache();
        await this.requireToken(deadline);
        try {
          return await this.request(action, path, body, deadline);
        } catch (retryError) {
          throw this.failure(retryError);
        }
      }
      throw this.failure(err);
    }
  }

  /** Nothing reaches the gateway without a token, so failing to get one is a refusal. */
  private async requireToken(deadline: number): Promise<void> {
    await this.tokenProvider.getToken(deadline - Date.now()).catch(() => {
      throw new CredentialRequestRejectedError();
    });
  }

  private async request(
    action: 'issue' | 'regenerate',
    path: string,
    body: unknown,
    deadline: number,
  ): Promise<IssuedApiKey> {
    const response =
      action === 'issue'
        ? await this.client.postJsonForBinary(path, body, deadline)
        : await this.client.putJsonForBinary(path, body, deadline);
    const parsed = CredentialSchema.safeParse(JSON.parse(response.data.toString('utf8')));
    if (!parsed.success)
      throw new ServiceUnavailableError(
        'APS returned an unexpected API-key response; reconcile the consumer before retrying',
      );
    return parsed.data;
  }

  /** Never expose upstream bodies or raw transport errors: either can contain secrets. */
  private failure(err: unknown): Error {
    if (err instanceof ServiceUnavailableError) return err;
    if (err instanceof HttpClientError) {
      // A 4xx is a refusal: the consumer was not created or rotated.
      if (err.status >= 400 && err.status < 500)
        return new CredentialRequestRejectedError(err.status);
      return Object.assign(
        new ServiceUnavailableError(`APS credential request failed (upstream HTTP ${err.status})`),
        { upstreamStatus: err.status },
      );
    }
    return new ServiceUnavailableError(
      'APS credential request did not complete successfully; its outcome may be unknown',
    );
  }
}
