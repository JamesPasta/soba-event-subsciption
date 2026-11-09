import express from 'express';
import request from 'supertest';
import { coreErrorHandler, notFoundHandler } from '../../../src/core/middleware/errorHandler';
import { NotFoundError, ValidationError, ForbiddenError, AppError } from '../../../src/core/errors';

function createErrorApp(throwInRoute: () => void): express.Express {
  const app = express();
  app.get('/', (_req, _res, next) => {
    try {
      throwInRoute();
    } catch (e) {
      next(e);
    }
  });
  app.use(coreErrorHandler);
  return app;
}

describe('errorHandler supertest', () => {
  it('returns 404 and error body when route throws NotFoundError', async () => {
    const app = createErrorApp(() => {
      throw new NotFoundError('Resource missing');
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Resource missing' });
  });

  it('returns 400 and error body when route throws ValidationError', async () => {
    const app = createErrorApp(() => {
      throw new ValidationError('Invalid input');
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid input' });
  });

  it('returns 403 and error body when route throws ForbiddenError', async () => {
    const app = createErrorApp(() => {
      throw new ForbiddenError('Access denied');
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied' });
  });

  it('returns 500 and Internal server error when route throws generic Error', async () => {
    const app = createErrorApp(() => {
      throw new Error('Something broke');
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', code: 'internal_error' });
  });

  it('returns 500 and Internal server error when route throws non-Error', async () => {
    const app = createErrorApp(() => {
      throw 'string throw';
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', code: 'internal_error' });
  });

  it('returns custom statusCode when route throws AppError with custom code', async () => {
    const app = createErrorApp(() => {
      throw new AppError('Teapot', 418);
    });
    const res = await request(app).get('/');
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: 'Teapot' });
  });
});

// Mounted the way app.ts mounts a surface, with a catch-all at the prefix in place of the core mount.
function surfaceApp(): express.Express {
  const app = express();
  const surface = express.Router();
  surface.get('/known', (_req, res) => {
    res.json({ ok: true });
  });
  surface.get('/items/:id', (req, res) => {
    res.json({ id: req.params.id });
  });
  surface.use(notFoundHandler);
  surface.use(coreErrorHandler);

  app.use('/api/surface', express.json(), surface);
  app.use('/api', (_req, res) => {
    res.status(401).json({ error: 'reached the catch-all mount' });
  });
  app.use(notFoundHandler);
  app.use(coreErrorHandler);
  return app;
}

describe('surface endings', () => {
  const app = surfaceApp();

  it('answers an unmatched path inside the surface with a JSON 404, not the later mount', async () => {
    const res = await request(app).put('/api/surface/known');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 'route_not_found' });
  });

  it('answers a path outside every surface with a JSON 404', async () => {
    const res = await request(app).get('/elsewhere');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 'route_not_found' });
  });

  it('returns JSON for an error raised in the app-level chain before the surface router', async () => {
    const res = await request(app)
      .post('/api/surface/known')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String), code: 'request_invalid' });
  });

  it('returns 400 for a path param Express cannot decode', async () => {
    const res = await request(app).get('/api/surface/items/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Failed to decode param '%E0%A4%A'",
      code: 'request_invalid',
    });
  });
});
