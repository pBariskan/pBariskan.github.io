// Daily heatmap helpers in token-counter.js: intensity levels, the week grid, and the summary numbers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const counter = require('../token-counter.js');

test('levels split active days into quartiles, like GitHub; empty days are level 0', () => {
  const t = counter.heatThresholds([10, 20, 30, 40, 50, 60, 70, 80, 0, 0]);
  assert.equal(counter.heatLevel(0, t), 0);
  assert.equal(counter.heatLevel(10, t), 1);
  assert.equal(counter.heatLevel(30, t), 2);
  assert.equal(counter.heatLevel(50, t), 3);
  assert.equal(counter.heatLevel(80, t), 4);
  assert.equal(counter.heatLevel(5, counter.heatThresholds([])), 1, 'any activity shows even with no history');
});

test('the calendar runs in Sunday-first weeks from the first day of data to today', () => {
  // 2026-09-30 is a Wednesday, 2026-10-06 a Tuesday
  const cal = counter.calendar([['2026-09-30', 100], ['2026-10-02', 300], ['2026-10-06', 50]], '2026-10-06');
  assert.equal(cal.weeks.length, 2);
  assert.equal(cal.weeks[0][0].day, '2026-09-27', 'first column starts on the Sunday before the data');
  assert.equal(cal.weeks[0][3].n, 100);
  assert.equal(cal.weeks[0][4].n, 0, 'days without data are present with 0 tokens');
  assert.equal(cal.weeks[1][2].day, '2026-10-06');
  assert.equal(cal.weeks[1][3], null, 'days after today are left blank');
  assert.ok(cal.weeks[0][5].level > cal.weeks[0][3].level, 'the busier day is darker');
});

test('the calendar shows at most the last 53 weeks', () => {
  const cal = counter.calendar([['2024-01-03', 5], ['2026-10-06', 5]], '2026-10-06');
  assert.equal(cal.weeks.length, 53);
  assert.equal(cal.weeks[52][2].day, '2026-10-06');
});

test('month labels sit on the first week of each month, skipping one that would collide', () => {
  const cal = counter.calendar([['2026-04-13', 1]], '2026-06-10');
  assert.deepEqual(cal.months.map((m) => m.label), ['Apr', 'May', 'Jun']);
  assert.equal(cal.months[0].week, 0);
  assert.equal(cal.weeks[cal.months[1].week][0].day.slice(0, 7), '2026-05');
  const tight = counter.calendar([['2026-04-26', 1]], '2026-06-10');
  assert.deepEqual(tight.months.map((m) => m.label), ['May', 'Jun'], 'a lone April week has no room for its label');
});

test('summary: busiest day, active days, current streak and daily average', () => {
  const days = [['2026-10-01', 400], ['2026-10-02', 100], ['2026-10-04', 200], ['2026-10-05', 300]];
  assert.deepEqual(counter.dailySummary(days, '2026-10-05'), {
    busiest: ['2026-10-01', 400], activeDays: 4, totalDays: 5, streak: 2, average: 200,
  });
  assert.equal(counter.dailySummary(days, '2026-10-06').streak, 2, 'a quiet today does not break the streak yet');
  assert.equal(counter.dailySummary(days, '2026-10-07').streak, 0);
  assert.deepEqual(counter.dailySummary([], '2026-10-05'), { busiest: null, activeDays: 0, totalDays: 0, streak: 0, average: 0 });
});

test('days read as short dates', () => {
  assert.equal(counter.formatDay('2026-10-04'), 'Oct 4, 2026');
  assert.equal(counter.formatDay('2026-10-04', false), 'Oct 4');
});
