// Falling back to the GitHub snapshot when the counter Worker can't be reached
// (Spanish ISPs block Cloudflare IPs during LaLiga matches; the request then hangs instead of failing).
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../token-counter.js');

const WORKER = 'https://worker.test';
const SNAPSHOT = 'https://snapshot.test/data';
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

// routes: url → JSON body, or 'hang' for a connection that never answers; any other url fails at once.
function stubFetch(routes) {
  const calls = [];
  global.fetch = (url, opts = {}) => {
    calls.push({ url, cache: opts.cache });
    const body = routes[url];
    if (body === 'hang') {
      return new Promise((_, reject) => {
        if (opts.signal) opts.signal.addEventListener('abort', () => { calls.aborted = url; reject(new Error('aborted')); });
      });
    }
    if (body === undefined) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return calls;
}

test('a request that hangs is given up after the timeout and aborted', async () => {
  const calls = stubFetch({ [WORKER + '/stats']: 'hang' });
  const started = Date.now();
  await assert.rejects(counter.getJSON(WORKER + '/stats', 50));
  assert.ok(Date.now() - started < 1000, 'rejects soon after the timeout');
  assert.equal(calls.aborted, WORKER + '/stats', 'the hung connection is closed');
});

test('the Worker answer is used when it comes, without touching the snapshot', async () => {
  const calls = stubFetch({ [WORKER + '/stats']: { total: { all: 7 } } });
  const res = await counter.load(WORKER, SNAPSHOT, '/stats', 50);
  assert.deepEqual(res, { data: { total: { all: 7 } }, cached: false });
  assert.deepEqual(calls.map((c) => c.url), [WORKER + '/stats']);
  assert.equal(calls[0].cache, 'no-store', 'live numbers skip the HTTP cache');
});

test('when the Worker hangs, the snapshot is shown and marked as cached', async () => {
  const calls = stubFetch({ [WORKER + '/stats']: 'hang', [SNAPSHOT + '/stats.json']: { total: { all: 5 } } });
  const res = await counter.load(WORKER, SNAPSHOT, '/stats', 50);
  assert.deepEqual(res, { data: { total: { all: 5 } }, cached: true });
  assert.equal(calls[1].cache, 'default', 'the snapshot goes through the HTTP cache (raw.githubusercontent.com caches 5 min)');
});

test('the daily heatmap falls back the same way', async () => {
  stubFetch({ [SNAPSHOT + '/daily.json']: { today: '2026-10-10', days: [] } });
  const res = await counter.load(WORKER, SNAPSHOT, '/daily', 50);
  assert.equal(res.cached, true);
  assert.equal(res.data.today, '2026-10-10');
});

test('without a snapshot, or when it fails too, the load is rejected', async () => {
  stubFetch({});
  await assert.rejects(counter.load(WORKER, '', '/stats', 50));
  await assert.rejects(counter.load(WORKER, SNAPSHOT, '/stats', 50));
});

test('a copy reads Live while the Mac is reporting, like the Worker does', () => {
  const clock = Date.UTC(2026, 9, 11, 15, 53);
  // the screenshot that said "Cached · 1 min ago": the Mac reported a minute ago, the copy is a minute old
  assert.deepEqual(counter.status({ updatedAt: clock - 60e3, now: clock - 60e3 }, true, clock), { live: true, text: 'Live' });
  // idle Mac (5-min heartbeat) + a copy GitHub's CDN held for 5 min: still live
  assert.deepEqual(counter.status({ updatedAt: clock - 11 * 60e3, now: clock - 5 * 60e3 }, true, clock),
    { live: true, text: 'Live' });
});

test('once the Mac stops reporting, either source says when it last did', () => {
  const clock = Date.UTC(2026, 9, 11, 15, 53);
  assert.deepEqual(counter.status({ updatedAt: clock - 14 * 3600e3, now: clock - 3 * 60e3 }, true, clock),
    { live: false, text: 'Updated 14 h ago' });
  assert.deepEqual(counter.status({ updatedAt: clock - 2 * 3600e3, now: clock }), { live: false, text: 'Updated 2 h ago' });
  assert.deepEqual(counter.status({ updatedAt: clock - 8 * 60e3, now: clock }), { live: false, text: 'Updated 8 min ago' },
    'the Worker gets no extra slack');
});

test('a copy replaces the numbers on screen only if it is at least as new', () => {
  const shown = { updatedAt: 1000, now: 5000 };
  assert.equal(counter.fresher(null, shown), true);
  assert.equal(counter.fresher(shown, { updatedAt: 2000, now: 2000 }), true, 'newer data');
  assert.equal(counter.fresher(shown, { updatedAt: 1000, now: 6000 }), true, 'same data, seen later');
  assert.equal(counter.fresher(shown, { updatedAt: 1000, now: 4000 }), false, 'same data, seen earlier');
  assert.equal(counter.fresher(shown, { updatedAt: 500, now: 9000 }), false, 'older data');
});

// ── mount() against a minimal DOM: just what the counter touches.
function fakeDom() {
  const nodes = {};
  const node = (name) => nodes[name] || (nodes[name] = {
    textContent: '', hidden: false, attrs: {}, classes: new Set(),
    classList: {
      add(c) { node(name).classes.add(c); },
      remove(c) { node(name).classes.delete(c); },
      toggle(c, on) { if (on) node(name).classes.add(c); else node(name).classes.delete(c); },
    },
    getAttribute(a) { return a in this.attrs ? this.attrs[a] : null; },
    setAttribute(a, v) { this.attrs[a] = v; },
    appendChild(child) { this.textContent += child.textContent; },
    addEventListener() {},
    querySelector(sel) { return node(/^\[data-([\w-]+)\]$/.exec(sel)[1]); },
  });
  const root = node('root');
  root.attrs['data-endpoint'] = WORKER;
  root.attrs['data-snapshot'] = SNAPSHOT;
  const ticks = [];
  const saved = { document: global.document, window: global.window, setInterval: global.setInterval };
  global.document = {
    hidden: false, addEventListener() {}, querySelector: () => null,
    createElement: () => ({ textContent: '' }), createTextNode: (t) => ({ textContent: t }),
  };
  global.window = { fetch: () => {}, matchMedia: () => ({ matches: true }) }; // reduced motion: numbers set at once
  global.setInterval = (fn) => { ticks.push(fn); };
  afterEach(() => Object.assign(global, saved));
  return { root, node, tick: () => ticks.forEach((fn) => fn()) };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

function stats(all, at) {
  return { total: { all, cache_read: 0, output: 0 }, today: { all: 0 }, sources: {}, since: '2026-04-13',
    updatedAt: at, lastUsageAt: at, now: at };
}

test('when the Worker drops out after answering, a newer snapshot takes over', async () => {
  const T = Date.now() - 120000;
  stubFetch({ [WORKER + '/stats']: stats(10, T) });
  const dom = fakeDom();
  counter.mount(dom.root);
  await settle();
  assert.equal(dom.node('total').textContent, '10');
  assert.equal(dom.node('status').textContent, 'Live');

  // the block starts; the Mac keeps copying the Worker to the snapshot
  stubFetch({ [SNAPSHOT + '/stats.json']: stats(20, T + 60000) });
  dom.tick();
  await settle();
  assert.equal(dom.node('total').textContent, '20');
  assert.equal(dom.node('status').textContent, 'Live', 'the Mac is still reporting');
  assert.equal(dom.root.classes.has('is-live'), true);
});

test('a snapshot older than the numbers on screen does not take them back', async () => {
  const T = Date.now() - 60000;
  stubFetch({ [WORKER + '/stats']: stats(20, T) });
  const dom = fakeDom();
  counter.mount(dom.root);
  await settle();

  stubFetch({ [SNAPSHOT + '/stats.json']: stats(10, T - 60000) });
  dom.tick();
  await settle();
  assert.equal(dom.node('total').textContent, '20');
});
