import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

test('offline install caches every application asset and preserves other apps', async () => {
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const scope = 'https://example.com/talbot/';
  const handlers = {}, cached = new Map(), deleted = [];
  const cache = {
    async addAll(paths) {
      for (const path of paths) { await access(new URL('../' + path, import.meta.url)); cached.set(new URL(path, scope).href, { ok: true, path }); }
    },
    async match(request) { return cached.get(new URL(typeof request === 'string' ? request : request.url, scope).href); },
    async put() {},
  };
  vm.runInNewContext(source, {
    self: { registration: { scope }, addEventListener: (type, handler) => handlers[type] = handler, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['unrelated-app', `talbot-bridge:${scope}:v0`], delete: async key => deleted.push(key) },
    fetch: async () => { throw new Error('offline'); }, Response, URL,
  });
  let task;
  handlers.install({ waitUntil(p) { task = p; } }); await task;
  handlers.activate({ waitUntil(p) { task = p; } }); await task;
  assert.deepEqual(deleted, [`talbot-bridge:${scope}:v0`]);
  for (const path of ['index.html', 'src/ui/install.js', 'icons/icon-192.png', 'icons/icon-512.png', 'vendor/bridge-solver/bridge_solver_wasm_bg.wasm']) {
    handlers.fetch({ request: { method: 'GET', url: scope + path }, respondWith(p) { task = p; } });
    assert.ok((await task).ok, path);
  }
  let intercepted = false;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.com/other-app/' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});

test('home-screen manifest references valid icons and relative project scope', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.id, './');
  for (const icon of manifest.icons) await access(new URL('../' + icon.src, import.meta.url));
  assert.ok(manifest.icons.some(i => i.sizes === '192x192'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512'));
});
