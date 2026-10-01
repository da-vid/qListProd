import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function build({ output = path.join(root, 'dist'), context = process.env.CONTEXT } = {}) {
  if (context === 'production') throw new Error('Production deployment is disabled for this preview-only baseline.');
  const manifest = JSON.parse(await readFile(path.join(root, 'vendor/manifest.json'), 'utf8'));
  for (const [file, hash] of Object.entries(manifest.files)) {
    const bytes = await readFile(path.join(root, 'vendor', file));
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Frozen vendor checksum changed: ${file}`);
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'js'), { recursive: true });
  // Deliberate allowlist: never publish docs, test data files, node_modules, or repository metadata.
  for (const name of ['css', 'fonts', 'icons', '_redirects', 'deleteAllModal.html', 'newListModal.html', 'shareModal.html', 'tosModal.html']) {
    await cp(path.join(root, name), path.join(output, name), { recursive: true });
  }
  await mkdir(path.join(output, 'vendor'));
  await cp(path.join(root, 'vendor/legacy.js'), path.join(output, 'vendor/legacy.js'));
  await cp(path.join(root, 'js/angular-linkify.min.js'), path.join(output, 'js/angular-linkify.min.js'));
  for (const name of ['app.js', 'list-routing.js', 'preview-data.js']) {
    const source = await readFile(path.join(root, 'src', name), 'utf8');
    if (/qwiklist\.firebaseio\.com|google-analytics\.com|UA-48582921-2/.test(source)) throw new Error(`Production service reference in preview source: ${name}`);
    await writeFile(path.join(output, 'js', name), source);
  }
  await cp(path.join(root, 'src/index.html'), path.join(output, 'index.html'));
  await writeFile(path.join(output, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
`);
  await writeFile(path.join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  return output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build();
  console.log('Built synthetic-data preview in dist/ (production disabled).');
}
