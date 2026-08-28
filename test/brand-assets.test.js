import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('brand mark and favicon are flat, script-free SVG assets', async () => {
  const [mark, favicon] = await Promise.all([
    readFile('public/brand/foggy-mark.svg', 'utf8'),
    readFile('public/brand/favicon.svg', 'utf8'),
  ]);

  for (const asset of [mark, favicon]) {
    assert.match(asset, /viewBox="0 0 64 64"/);
    assert.match(asset, /#579b96/);
    assert.doesNotMatch(asset, /<script|<foreignObject|linearGradient|radialGradient/i);
  }
  assert.match(favicon, /#111817/);
});
