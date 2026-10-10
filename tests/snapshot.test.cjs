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

test('cached numbers say so, with the age of the last update', () => {
  const now = Date.UTC(2026, 9, 10, 18, 0);
  const stats = { updatedAt: now - 2 * 3600 * 1000, now };
  assert.deepEqual(counter.status(stats, true), { live: false, text: 'Cached · 2 h ago' });
  assert.deepEqual(counter.status({ updatedAt: now - 60000, now }, true), { live: false, text: 'Cached · 1 min ago' },
    'a fresh snapshot is still not live');
  assert.deepEqual(counter.status(stats), { live: false, text: 'Updated 2 h ago' }, 'live data reads as before');
});
