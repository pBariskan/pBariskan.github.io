// Pure helpers behind the scroll motion in site.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const site = require('../site.js');

test('scroll progress runs from 0 at the top to 1 at the bottom', () => {
  assert.equal(site.progress(0, 3000, 1000), 0);
  assert.equal(site.progress(1000, 3000, 1000), 0.5);
  assert.equal(site.progress(2000, 3000, 1000), 1);
  assert.equal(site.progress(2400, 3000, 1000), 1, 'overscroll is clamped');
  assert.equal(site.progress(-50, 3000, 1000), 0, 'rubber-band at the top is clamped');
  assert.equal(site.progress(0, 800, 1000), 0, 'a page shorter than the window has no progress');
});

test('marquee runs at normal speed when idle, faster when scrolling, reversed when scrolling up', () => {
  assert.equal(site.marqueeRate(0), 1);
  assert.equal(site.marqueeRate(12), 3);
  assert.equal(site.marqueeRate(-12), -3);
  assert.equal(site.marqueeRate(500), 6, 'speed-up is capped');
  assert.equal(site.marqueeRate(-500), -6);
});

test('view offset is 0 for a centred element and grows toward the edges', () => {
  assert.equal(site.viewOffset(400, 200, 1000), 0);
  assert.equal(site.viewOffset(900, 200, 1000), 1);
  assert.equal(site.viewOffset(-100, 200, 1000), -1);
  assert.equal(site.viewOffset(5000, 200, 1000), 1.5, 'far off-screen is clamped');
});

test('blocks lift in reading order: rows top to bottom, then left to right', () => {
  const items = [
    { name: 'b', top: 500, left: 400 }, { name: 'c', top: 900, left: 0 },
    { name: 'a', top: 503, left: 0 }, { name: 'd', top: 904, left: 400 },
  ];
  assert.deepEqual(items.sort(site.readingOrder).map((i) => i.name), ['a', 'b', 'c', 'd']);
});
