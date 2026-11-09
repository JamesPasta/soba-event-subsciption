import express from 'express';
import request from 'supertest';
import { sendAttachment } from '../../../../src/core/api/shared/contentDisposition';

const app = express();
app.get('/download', (_req, res) => {
  sendAttachment(res, 'application/pdf', 'R\u00e9sum\u00e9 "1".pdf', Buffer.from('%PDF'));
});

describe('sendAttachment', () => {
  it('sends the body as a named download that is never sniffed', async () => {
    const res = await request(app).get('/download').responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="R_sum_ _1_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%221%22.pdf`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toEqual(Buffer.from('%PDF'));
  });
});
