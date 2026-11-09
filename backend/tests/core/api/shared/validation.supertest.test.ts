import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateRequest } from '../../../../src/core/api/shared/validation';

function createValidationApp(schemas: {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
}) {
  const app = express();
  app.use(express.json());
  app.post('/echo', validateRequest(schemas), (req, res) => {
    res.status(200).json({ body: req.body, params: req.params, query: req.query });
  });
  return app;
}

describe('validateRequest supertest', () => {
  it('returns 400 and details when body fails schema', async () => {
    const app = createValidationApp({
      body: z.object({ name: z.string().min(1) }),
    });
    const res = await request(app).post('/echo').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid request body');
    expect(res.body).toHaveProperty('code', 'request_invalid');
    expect(res.body).toHaveProperty('details');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(res.body.details[0]).toHaveProperty('path');
    expect(res.body.details[0]).toHaveProperty('message');
  });

  it('returns 200 and parsed body when body passes schema', async () => {
    const app = createValidationApp({
      body: z.object({ name: z.string() }),
    });
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send({ name: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'Alice' });
  });

  it('returns 400 when body is missing required field', async () => {
    const app = createValidationApp({
      body: z.object({ required: z.string() }),
    });
    const res = await request(app).post('/echo').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request body');
  });

  it('returns 200 and parsed params when params schema passes', async () => {
    const app = express();
    app.use(express.json());
    app.get(
      '/item/:id',
      validateRequest({ params: z.object({ id: z.string().min(1) }) }),
      (req, res) => {
        res.status(200).json({ id: req.params.id });
      },
    );
    const res = await request(app).get('/item/abc-123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'abc-123' });
  });

  it('preserves cross-cutting query params not declared in the schema', async () => {
    const app = express();
    app.use(express.json());
    app.get(
      '/forms',
      validateRequest({ query: z.object({ limit: z.coerce.number().default(20) }) }),
      (req, res) => {
        res.status(200).json({ query: req.query });
      },
    );
    const res = await request(app).get('/forms?limit=100&workspaceId=ws-123');
    expect(res.status).toBe(200);
    // Schema-declared field is coerced; the cross-cutting workspaceId survives key-stripping.
    expect(res.body.query).toEqual({ limit: 100, workspaceId: 'ws-123' });
  });

  it('returns 400 when params fail schema', async () => {
    const app = express();
    app.use(express.json());
    app.get(
      '/item/:id',
      validateRequest({ params: z.object({ id: z.string().uuid() }) }),
      (req, res) => {
        res.status(200).json({ id: req.params.id });
      },
    );
    const res = await request(app).get('/item/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request params');
  });
});
