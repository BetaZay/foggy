import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAssets } from '../src/lib/assets.js';

test('development assets include Tailwind CSS in the document head', () => {
  const assets = loadAssets({
    isProduction: false,
    viteDevServer: '',
  }, process.cwd(), '192.168.0.50');

  assert.deepEqual(assets.styles, [
    'http://192.168.0.50:5173/src/frontend/app.css',
  ]);
  assert.ok(assets.scripts.includes(
    'http://192.168.0.50:5173/src/frontend/main.js',
  ));
});
