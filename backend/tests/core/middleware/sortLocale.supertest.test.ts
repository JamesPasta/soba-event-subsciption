import express from 'express';
import request from 'supertest';
import { sortLocale } from '../../../src/core/middleware/sortLocale';

const app = express();
app.get('/list', sortLocale, (req, res) => {
  res.json({ locale: req.sortLocale });
});

describe('sortLocale', () => {
  it('sorts in en when neither header nor param is sent', async () => {
    const res = await request(app).get('/list').unset('Accept-Language');
    expect(res.body.locale).toBe('en');
  });

  it('reads the locale query param', async () => {
    const res = await request(app).get('/list?locale=fr');
    expect(res.body.locale).toBe('fr');
  });

  it('reads Accept-Language', async () => {
    const res = await request(app).get('/list').set('Accept-Language', 'fr-CA,fr;q=0.9');
    expect(res.body.locale).toBe('fr');
  });

  it('lets Accept-Language win over the param', async () => {
    const res = await request(app).get('/list?locale=fr').set('Accept-Language', 'en');
    expect(res.body.locale).toBe('en');
  });

  it('reads the param when Accept-Language is empty', async () => {
    const res = await request(app).get('/list?locale=fr').set('Accept-Language', ' ');
    expect(res.body.locale).toBe('fr');
  });

  it('falls back to en for an unsupported language', async () => {
    const res = await request(app).get('/list?locale=de');
    expect(res.body.locale).toBe('en');
  });

  it('varies the response on Accept-Language', async () => {
    const res = await request(app).get('/list');
    expect(res.headers.vary).toContain('Accept-Language');
  });
});
