import { test } from 'node:test';
import * as assert from 'node:assert';
import { build } from '../helper';

test('generic scraper endpoint - valid request', async (t) => {
  const app = await build(t);

  const res = await app.inject({
    method: 'POST',
    url: '/api/scrape/generic',
    payload: {
      url: 'https://example.com',
      selectors: {
        title: 'h1',
        paragraphs: '[array]p'
      }
    }
  });

  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.payload);
  
  assert.strictEqual(data.title, 'Example Domain');
  assert.ok(Array.isArray(data.paragraphs));
  assert.ok(data.paragraphs.length > 0);
  assert.ok(data.paragraphs[0].includes('This domain is for use in'));
});

test('generic scraper endpoint - missing params', async (t) => {
  const app = await build(t);

  const res = await app.inject({
    method: 'POST',
    url: '/api/scrape/generic',
    payload: {
      url: 'https://example.com'
    }
  });

  assert.strictEqual(res.statusCode, 400);
  const data = JSON.parse(res.payload);
  assert.ok(data.error);
});

