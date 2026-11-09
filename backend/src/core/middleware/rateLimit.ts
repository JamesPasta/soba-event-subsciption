import rateLimit, { type Options } from 'express-rate-limit';
import { ApiErrorCodes } from '@soba/lib';
import { env } from '../config/env';

const defaults: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later', code: ApiErrorCodes.rate_limited },
};

/**
 * Global rate limiter applied to every request.
 * Env: RATE_LIMIT_WINDOW_MS (default 60 000), RATE_LIMIT_MAX (default 100).
 */
export const globalRateLimit = rateLimit({
  ...defaults,
  windowMs: env.getRateLimitWindowMs() ?? 60_000,
  max: env.getRateLimitMax() ?? 100,
});

/**
 * Stricter limiter for authenticated / mutating API routes.
 * Env: RATE_LIMIT_API_WINDOW_MS (default 60 000), RATE_LIMIT_API_MAX (default 60).
 */
export const apiRateLimit = rateLimit({
  ...defaults,
  windowMs: env.getRateLimitApiWindowMs() ?? 60_000,
  max: env.getRateLimitApiMax() ?? 60,
});

/**
 * Limiter for document rendering (print).
 * Env: RATE_LIMIT_RENDER_WINDOW_MS (default 60 000), RATE_LIMIT_RENDER_MAX (default 30).
 */
export const renderRateLimit = rateLimit({
  ...defaults,
  windowMs: env.getRateLimitRenderWindowMs() ?? 60_000,
  max: env.getRateLimitRenderMax() ?? 30,
});

/**
 * Lenient limiter for public endpoints (health, meta, docs).
 * Env: RATE_LIMIT_PUBLIC_WINDOW_MS (default 60 000), RATE_LIMIT_PUBLIC_MAX (default 200).
 */
export const publicRateLimit = rateLimit({
  ...defaults,
  windowMs: env.getRateLimitPublicWindowMs() ?? 60_000,
  max: env.getRateLimitPublicMax() ?? 200,
});
