// Bundel fungsi jadi satu file (tanpa perlu npm install saat deploy di Netlify)
import { build } from 'esbuild';
await build({ entryPoints: ['src/api.mjs'], bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile: 'netlify/functions/api.mjs',
  banner: { js: "// Dibuat otomatis dari src/api.mjs. Jangan diedit langsung.\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none', minify: false, logLevel: 'warning', nodePaths: ['dev/node_modules'] });
console.log('ok');
