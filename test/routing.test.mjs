import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/list-routing.js', import.meta.url), 'utf8');
function route(pathname, cookie = '') {
  const document = { cookie };
  const location = { pathname, href: '' };
  const context = vm.createContext({ window: { location }, document });
  vm.runInContext(source, context);
  return { context, location, document };
}
test('legacy six-character URLs keep their case and remember the current list', () => {
  const { context, document } = route('/AbC234');
  assert.equal(context.getListID(), 'AbC234');
  assert.match(document.cookie, /^lastList=AbC234;/);
});
test('home returns to the last-list cookie', () => {
  const { context, location } = route('/', 'other=x; lastList=AbC234');
  context.getListID();
  assert.equal(location.href, 'AbC234');
});
test('home without a cookie and /new choose a legacy-format identifier', () => {
  for (const path of ['/', '/new']) {
    const { context, location } = route(path, path === '/new' ? 'lastList=AbC234' : '');
    context.getListID();
    assert.match(location.href, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{6}$/);
    assert.notEqual(location.href, 'new');
  }
});
test('trailing slash retains the existing redirect destination', () => {
  const { context, location } = route('/AbC234/');
  context.getID();
  assert.equal(location.href, '../AbC234');
});
