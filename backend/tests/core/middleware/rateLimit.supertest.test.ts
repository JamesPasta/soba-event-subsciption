import express from 'express';
import request from 'supertest';
import { renderRateLimit } from '../../../src/core/middleware/rateLimit';

const app = express();
app.get('/', renderRateLimit, (_req, res) => {
  res.json({ ok: true });
});

describe('rate limits', () => {
  it('answers 429 with rate_limited once the window is spent', async () => {
    let res = await request(app).get('/');
    while (res.status === 200) res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'Too many requests, please try again later',
      code: 'rate_limited',
    });
  });
});
