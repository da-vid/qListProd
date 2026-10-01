import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('src/index.html', root), 'utf8');
const previewCSS = await readFile(new URL('css/preview.css', root), 'utf8');
const scripts = await Promise.all(['vendor/legacy.js', 'src/list-routing.js', 'src/preview-data.js', 'src/app.js', 'js/angular-linkify.min.js'].map(name => readFile(new URL(name, root), 'utf8')));
const templates = Object.fromEntries(await Promise.all(['shareModal.html', 'newListModal.html', 'deleteAllModal.html', 'tosModal.html'].map(async name => ['/' + name, await readFile(new URL(name, root), 'utf8')])));
async function app(t, { id = 'Demo23', stored } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html.replace('ng-app="quicklist"', ''), {
    url: 'https://preview.qlist.invalid/' + id,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const style = window.document.createElement('style');
  style.textContent = previewCSS;
  window.document.head.appendChild(style);
  if (stored) window.localStorage.setItem('qlist:synthetic:v1:' + id, stored);
  window.XMLHttpRequest = function () { throw new Error('Unexpected network request'); };
  window.WebSocket = function () { throw new Error('Unexpected WebSocket'); };
  for (const script of scripts) window.eval(script);
  // Vendor constructors must never be used by the extracted application.
  window.Firebase = function () { throw new Error('Production Firebase must not be instantiated'); };
  window.angular.module('quicklist').run(['$templateCache', function (cache) {
    Object.entries(templates).forEach(([name, value]) => cache.put(name, value));
  }]);
  const injector = window.angular.bootstrap(window.document.documentElement, ['quicklist']);
  const scope = window.angular.element(window.document.documentElement).scope();
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(scope.loaded, true, errors.join('\n'));
  assert.deepEqual(errors, []);
  return { window, scope, injector, errors, store: () => window.localStorage.getItem('qlist:synthetic:v1:' + id) };
}
function textItems(window) { return Array.from(window.document.querySelectorAll('.listItemNameContent'), el => el.textContent.trim()); }
function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, selector);
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function input(window, selector, value) {
  const element = window.document.querySelector(selector);
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
test('legacy UI loads synthetic items in priority order and renders checked state', async t => {
  const { window } = await app(t);
  assert.deepEqual(textItems(window), ['Apples', 'Bread', 'Milk']);
  assert.equal(window.document.querySelector('input[name="titleBox"]').value, 'Sample shopping list');
  assert.equal(window.document.querySelectorAll('.checkedItem').length, 1);
  assert.equal(window.getComputedStyle(window.document.querySelector('.spinner')).display, 'none');
  assert.equal(window.getComputedStyle(window.document.querySelector('.instructions')).display, 'none');
  assert.equal(window.getComputedStyle(window.document.querySelector('.deleteButton')).display, 'none');
});
test('title, add, check, delete and persistence operate only on synthetic data', async t => {
  const { window, store } = await app(t, { id: 'AbC234' });
  input(window, '[name="titleBox"]', 'Weekend errands');
  window.document.querySelector('[name="titleBox"]').dispatchEvent(new window.Event('blur'));
  input(window, '[name="addItemBox"]', 'Coffee');
  window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(textItems(window), ['Coffee']);
  click(window, '.chkbox');
  assert.equal(window.document.querySelectorAll('.checkedItem').length, 1);
  const saved = store();
  assert.equal(JSON.parse(saved).attrs.listName, 'Weekend errands');
  const reopened = await app(t, { id: 'AbC234', stored: saved });
  assert.deepEqual(textItems(reopened.window), ['Coffee']);
  assert.equal(reopened.window.document.querySelectorAll('.checkedItem').length, 1);
  click(window, '.deleteButton');
  assert.deepEqual(textItems(window), []);
  assert.deepEqual(JSON.parse(store()).items, {});
});
test('whitespace validation and delete-checked behavior remain intact', async t => {
  const { window, scope } = await app(t);
  input(window, '[name="addItemBox"]', '   ');
  window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(textItems(window).length, 3);
  scope.$apply(() => scope.deleteAllChecked());
  assert.deepEqual(textItems(window), ['Apples', 'Milk']);
});
test('legacy reorder adapter persists changed priorities', async t => {
  const { window, scope, store } = await app(t);
  const list = window.jQuery('.theList');
  const item = list.children().eq(2);
  const ui = { item };
  // Exercise the actual installed jQuery sortable callbacks; layout/drag is checked in the browser.
  list.sortable('option', 'start')({}, ui);
  item.sortable.dropindex = 0;
  item.sortable.isCanceled = () => false;
  list.sortable('option', 'stop')({}, ui);
  assert.deepEqual(textItems(window), ['Milk', 'Apples', 'Bread']);
  assert.equal(JSON.parse(store()).items['3']['.priority'], 0);
  assert.equal(scope.items['3'].ID, 3);
});
test('share and new-list dialogs retain the current URL and /new route', async t => {
  const { window } = await app(t);
  click(window, '.shareButton');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(window.document.querySelector('.pageURL a').getAttribute('href'), 'https://preview.qlist.invalid/Demo23');
  assert.ok(window.document.querySelector('[role="dialog"]'));
  click(window, '.close');
  click(window, '.newButton');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(window.document.querySelector('.btnNewList').getAttribute('href'), '../new');
});
test('adapter rejects production URLs and protects separate list storage', async t => {
  const { injector, window } = await app(t);
  const data = injector.get('qlistData');
  assert.throws(() => data.ref('https://qwiklist.firebaseio.com/lists/AbC234'), /Only a list-scoped/);
  assert.throws(() => data.ref('lists/__proto__'), /Only a list-scoped/);
  data.ref('lists/Other2/1').setWithPriority({ ID: 1, name: 'Other synthetic item', checked: false }, 1);
  assert.deepEqual(textItems(window), ['Apples', 'Bread', 'Milk']);
  assert.equal(window.localStorage.length, 1);
});
test('synthetic adapter refuses production hostnames', () => {
  const dom = new JSDOM('', { url: 'https://www.qlist.cc/AbC234', runScripts: 'outside-only' });
  try { assert.throws(() => dom.window.eval(scripts[2]), /must not run on a production hostname/); }
  finally { dom.window.close(); }
});
