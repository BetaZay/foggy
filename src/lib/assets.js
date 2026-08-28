import fs from 'node:fs';
import path from 'node:path';

function browserHost(hostname) {
  const safe = /^[a-z0-9.:[\]-]+$/i.test(hostname || '') ? hostname : 'localhost';
  return safe.includes(':') && !safe.startsWith('[') ? `[${safe}]` : safe;
}

export function loadAssets({ isProduction, viteDevServer }, rootDirectory, hostname = 'localhost') {
  if (!isProduction) {
    const devServer = viteDevServer || `http://${browserHost(hostname)}:5173`;
    return {
      scripts: [`${devServer}/@vite/client`, `${devServer}/src/frontend/main.js`],
      styles: [`${devServer}/src/frontend/app.css`],
    };
  }

  const manifestPath = path.join(rootDirectory, 'public/assets/.vite/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Production assets are missing. Run npm run build first.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest['src/frontend/main.js'];
  if (!entry) throw new Error('Vite manifest does not contain the Foggy entrypoint');

  return {
    scripts: [`/assets/${entry.file}`],
    styles: (entry.css || []).map((file) => `/assets/${file}`),
  };
}
