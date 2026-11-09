import express from 'express';
import request from 'supertest';
import { checkedFileName, parseUpload } from '../../../src/core/middleware/parseUpload';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';

function uploadApp(): express.Express {
  const app = express();
  app.post('/upload', parseUpload(4), (req, res) => {
    const files = (req as express.Request & { files?: { originalname: string }[] }).files ?? [];
    res.json({ files: files.map((f) => f.originalname), submissionId: req.body?.submissionId });
  });
  app.use(coreErrorHandler);
  return app;
}

const MALFORMED = { error: 'Malformed multipart body', code: 'upload_invalid' };

describe('checkedFileName', () => {
  it('passes a name of up to 255 bytes', () => {
    const name = `${'\u00e9'.repeat(125)}.pdf`; // 250 + 4 bytes
    expect(checkedFileName(name)).toBe(name);
  });

  it('refuses a longer name with 400', () => {
    expect(() => checkedFileName(`${'a'.repeat(252)}.pdf`)).toThrow(
      expect.objectContaining({
        message: 'File name is longer than 255 bytes',
        code: 'upload_invalid',
      }),
    );
  });
});

describe('parseUpload', () => {
  const app = uploadApp();

  it('parses a file under any field name, with the form fields', async () => {
    const res = await request(app)
      .post('/upload')
      .field('submissionId', 'sub1')
      .attach('anyKey', Buffer.from('abc'), 'a.txt');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ files: ['a.txt'], submissionId: 'sub1' });
  });

  it('keeps a UTF-8 filename intact', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('ab'), 'r\u00e9sum\u00e9.txt');
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual(['r\u00e9sum\u00e9.txt']);
  });

  it('passes a request that is not multipart through unparsed', async () => {
    const res = await request(app).post('/upload').send({ submissionId: 'sub1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ files: [] });
  });

  it('returns 413 for a file over the size limit', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('too many bytes'), 'big.txt');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'File too large', code: 'file_too_large' });
  });

  it('returns 400 for any other multer limit, such as a second file', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('first', Buffer.from('a'), 'a.txt')
      .attach('second', Buffer.from('b'), 'b.txt');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Too many files', code: 'upload_invalid' });
  });

  it('returns 400 for more text fields than the parser allows', async () => {
    let req = request(app).post('/upload');
    for (let i = 0; i < 21; i++) req = req.field(`f${i}`, 'x');
    const res = await req.attach('file', Buffer.from('a'), 'a.txt');
    expect(res.status).toBe(400);
  });

  it('returns 400 for a text field over the size limit', async () => {
    const res = await request(app)
      .post('/upload')
      .field('submissionId', 'x'.repeat(64 * 1024 + 1))
      .attach('file', Buffer.from('a'), 'a.txt');
    expect(res.status).toBe(400);
  });

  it('returns 400 for a multipart body with no boundary', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Content-Type', 'multipart/form-data')
      .send('not multipart');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(MALFORMED);
  });

  it('returns 400 for a truncated multipart body', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=XYZ')
      .send('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nab');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(MALFORMED);
  });
});
