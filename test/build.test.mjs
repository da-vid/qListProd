import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from '../scripts/build.mjs';
async function tree(dir, prefix = '') {
  const result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await tree(path.join(dir, entry.name), name + '/'));
    else result[name] = createHash('sha256').update(await readFile(path.join(dir, entry.name))).digest('hex');
  }
  return result;
}
test('build is deterministic and publishes only intended assets', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'qlist-build-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const output = path.join(temp, 'site');
  await build({ output, context: 'deploy-preview' });
  const first = await tree(output);
  await build({ output, context: 'branch-deploy' });
  assert.deepEqual(await tree(output), first);
  for (const name of Object.keys(first)) assert.doesNotMatch(name, /^(docs|test|src|node_modules|\.git)\/|package|manifest/);
  const index = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(index, /ng-csp/);
  assert.match(index, /Development preview/);
  assert.doesNotMatch(index, /<script>(?!\s*UserVoice)/);
  // Every executable script is local and the production database/analytics identifier is absent.
  for (const [, src] of index.matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(src.startsWith('/'));
    const script = await readFile(path.join(output, src), 'utf8');
    assert.doesNotMatch(script, /qwiklist\.firebaseio\.com|UA-48582921-2/);
  }
  const headers = await readFile(path.join(output, '_headers'), 'utf8');
  assert.match(headers, /connect-src 'self'/);
  assert.match(headers, /script-src 'self';/);
  assert.match(headers, /X-Robots-Tag: noindex, nofollow/);
  assert.equal(await readFile(path.join(output, '_redirects'), 'utf8'), '/* /index.html?i=:splat 200');
});
test('production context is rejected before creating output', async () => {
  await assert.rejects(build({ context: 'production' }), /Production deployment is disabled/);
});
