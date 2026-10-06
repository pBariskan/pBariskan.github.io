/* Live token counter (Claude + Codex) — polls public totals from the counter Worker and animates the number.
   Also shows the GitHub contribution total the Worker relays, and a GitHub-style daily heatmap on demand. */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(document.querySelector('[data-token-counter]'));
})(function () {
  var LIVE_MS = 7 * 60 * 1000;
  var POLL_MS = 15000;
  var DAILY_MAX_AGE = 5 * 60 * 1000;
  var DAY_MS = 86400000;
  var MAX_WEEKS = 53;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var full = new Intl.NumberFormat('en-US');
  var compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  function formatFull(n) { return full.format(Math.round(n)); }
  function formatCompact(n) { return compact.format(n); }

  function ago(t, now) {
    if (!t) return '—';
    var min = Math.floor((now - t) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    var h = Math.floor(min / 60);
    if (h < 24) return h + ' h ago';
    return Math.floor(h / 24) + ' d ago';
  }

  function status(stats) {
    if (!stats.updatedAt) return { live: false, text: 'Waiting for data' };
    if (stats.now - stats.updatedAt <= LIVE_MS) return { live: true, text: 'Live' };
    return { live: false, text: 'Updated ' + ago(stats.updatedAt, stats.now) };
  }

  var SOURCE_LABELS = [['app', 'App'], ['cli', 'CLI'], ['web', 'Web'], ['codex', 'Codex']];

  function sourceParts(sources) {
    return SOURCE_LABELS
      .filter(function (s) { return sources[s[0]] > 0; })
      .map(function (s) { return s[1] + ' ' + formatCompact(sources[s[0]]); });
  }

  function sinceText(day) {
    if (!day) return '';
    var p = day.split('-');
    return MONTHS[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0];
  }

  // ── Daily heatmap helpers. Days are 'YYYY-MM-DD' strings (Istanbul dates from the Worker), handled as UTC.
  function dayMs(day) { var p = day.split('-'); return Date.UTC(+p[0], p[1] - 1, +p[2]); }
  function msDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

  function formatDay(day, withYear) {
    var p = day.split('-');
    return MONTHS[p[1] - 1] + ' ' + Number(p[2]) + (withYear === false ? '' : ', ' + p[0]);
  }

  // Quartiles of the active days, as GitHub does: the busiest quarter of days gets the darkest square.
  function heatThresholds(values) {
    var v = values.filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; });
    if (!v.length) return [];
    return [0.25, 0.5, 0.75].map(function (q) { return v[Math.floor(q * (v.length - 1))]; });
  }

  function heatLevel(n, thresholds) {
    if (!(n > 0)) return 0;
    return 1 + thresholds.filter(function (t) { return n > t; }).length;
  }

  // Sunday-first weeks from the first day with data (at most the last 53 weeks) through today.
  function calendar(days, today) {
    var byDay = {};
    days.forEach(function (d) { byDay[d[0]] = d[1]; });
    var end = dayMs(today);
    var thisWeek = end - new Date(end).getUTCDay() * DAY_MS;
    var first = days.length ? dayMs(days[0][0]) : end;
    var start = Math.max(first - new Date(first).getUTCDay() * DAY_MS, thisWeek - (MAX_WEEKS - 1) * 7 * DAY_MS);
    var shown = [];
    for (var t = start; t <= end; t += DAY_MS) shown.push(byDay[msDay(t)] || 0);
    var thresholds = heatThresholds(shown);

    var weeks = [];
    var months = [];
    for (var w = start, i = 0; w <= thisWeek; w += 7 * DAY_MS, i++) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        var ms = w + d * DAY_MS;
        if (ms > end) { week.push(null); continue; }
        var day = msDay(ms);
        var n = byDay[day] || 0;
        week.push({ day: day, n: n, level: heatLevel(n, thresholds) });
      }
      var month = new Date(w).getUTCMonth();
      if (!months.length || months[months.length - 1].month !== month) months.push({ week: i, month: month, label: MONTHS[month] });
      weeks.push(week);
    }
    // a label needs two columns of room before the next one
    months = months.filter(function (m, k) { return !months[k + 1] || months[k + 1].week - m.week >= 2; });
    return { weeks: weeks, months: months.map(function (m) { return { week: m.week, label: m.label }; }) };
  }

  function dailySummary(days, today) {
    if (!days.length) return { busiest: null, activeDays: 0, totalDays: 0, streak: 0, average: 0 };
    var byDay = {};
    var busiest = days[0];
    var total = 0;
    var active = 0;
    days.forEach(function (d) {
      byDay[d[0]] = d[1];
      total += d[1];
      if (d[1] > 0) active++;
      if (d[1] > busiest[1]) busiest = d;
    });
    var end = dayMs(today);
    var totalDays = Math.round((end - dayMs(days[0][0])) / DAY_MS) + 1;
    // a quiet today doesn't break the streak until the day is over
    var t = byDay[today] > 0 ? end : end - DAY_MS;
    var streak = 0;
    while (byDay[msDay(t)] > 0) { streak++; t -= DAY_MS; }
    return { busiest: busiest, activeDays: active, totalDays: totalDays, streak: streak, average: Math.round(total / totalDays) };
  }

  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function renderDaily(panel, data) {
    var cal = calendar(data.days, data.today);
    var sum = dailySummary(data.days, data.today);
    panel.textContent = '';

    var heat = make('div', 'heat');
    var scroll = make('div', 'heat-scroll');
    scroll.style.setProperty('--weeks', cal.weeks.length);
    var months = make('div', 'heat-months');
    months.setAttribute('aria-hidden', 'true');
    cal.months.forEach(function (m) {
      var label = make('span', '', m.label);
      label.style.gridColumn = (m.week + 2) + ' / span 3';
      months.appendChild(label);
    });
    var grid = make('div', 'heat-grid');
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', 'Tokens per day over the last ' + cal.weeks.length + ' weeks' +
      (sum.busiest ? '; busiest day ' + formatDay(sum.busiest[0]) + ' with ' + formatCompact(sum.busiest[1]) + ' tokens' : ''));
    ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach(function (l) { grid.appendChild(make('span', 'heat-day', l)); });
    var todayN = 0;
    cal.weeks.forEach(function (week) {
      week.forEach(function (cell) {
        var square = make('i', 'heat-cell ' + (cell ? 'l' + cell.level : 'is-blank'));
        if (cell) {
          square.setAttribute('data-day', cell.day);
          square.setAttribute('data-n', cell.n);
          if (cell.day === data.today) { square.className += ' is-today'; todayN = cell.n; }
        }
        grid.appendChild(square);
      });
    });
    scroll.appendChild(months);
    scroll.appendChild(grid);

    var foot = make('div', 'heat-foot');
    var readout = make('p', 'heat-readout');
    function read(day, n) {
      readout.textContent = formatDay(day) + ' — ' + (n > 0 ? formatCompact(n) + ' tokens' : 'no tokens');
    }
    read(data.today, todayN);
    function onCell(e) {
      var day = e.target.getAttribute && e.target.getAttribute('data-day');
      if (day) read(day, +e.target.getAttribute('data-n'));
    }
    grid.addEventListener('mouseover', onCell);
    grid.addEventListener('click', onCell);
    var legend = make('p', 'heat-legend');
    legend.setAttribute('aria-hidden', 'true');
    legend.appendChild(make('span', '', 'Less'));
    for (var l = 0; l < 5; l++) legend.appendChild(make('i', 'heat-cell l' + l));
    legend.appendChild(make('span', '', 'More'));
    foot.appendChild(readout);
    foot.appendChild(legend);
    heat.appendChild(scroll);
    heat.appendChild(foot);

    var stats = make('dl', 'heat-stats');
    [
      ['Busiest day', sum.busiest ? formatDay(sum.busiest[0], false) + ' · ' + formatCompact(sum.busiest[1]) : '—'],
      ['Active days', sum.activeDays + ' of ' + sum.totalDays],
      ['Current streak', sum.streak + (sum.streak === 1 ? ' day' : ' days')],
      ['Daily average', formatCompact(sum.average)],
    ].forEach(function (pair) {
      var row = make('div');
      row.appendChild(make('dt', '', pair[0]));
      row.appendChild(make('dd', '', pair[1]));
      stats.appendChild(row);
    });

    panel.appendChild(heat);
    panel.appendChild(stats);
    scroll.scrollLeft = scroll.scrollWidth;
  }

  function counterTween(node, reduce) {
    var shown = null;
    var frame = 0;
    return function (target) {
      if (shown === null || reduce) {
        shown = target;
        node.textContent = formatFull(target);
        return;
      }
      var from = shown;
      var start = performance.now();
      cancelAnimationFrame(frame);
      (function step(t) {
        var k = Math.min(1, (t - start) / 1400);
        shown = from + (target - from) * (1 - Math.pow(1 - k, 3));
        node.textContent = formatFull(shown);
        if (k < 1) frame = requestAnimationFrame(step);
      })(start);
    };
  }

  function mount(el) {
    if (!el || !window.fetch) return;
    var base = el.getAttribute('data-endpoint').replace(/\/$/, '');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function q(name) { return el.querySelector('[data-' + name + ']'); }
    var tween = counterTween(q('total'), reduce);
    var gh = document.querySelector('[data-github]');
    var ghTween = gh && counterTween(gh.querySelector('[data-github-total]'), reduce);

    function renderGithub(github) {
      if (!gh) return;
      var ok = github && typeof github.contributions === 'number';
      gh.hidden = !ok;
      if (!ok) return;
      gh.classList.remove('is-loading');
      ghTween(github.contributions);
    }

    function render(s) {
      tween(s.total.all);
      q('today').textContent = formatCompact(s.today.all);
      q('last-burn').textContent = ago(s.lastUsageAt, s.now);
      q('cache-read').textContent = formatCompact(s.total.cache_read);
      q('output').textContent = formatCompact(s.total.output);
      var sources = q('sources');
      sources.textContent = '';
      sourceParts(s.sources).forEach(function (part, i) {
        if (i) sources.appendChild(document.createTextNode(' · '));
        var span = document.createElement('span');
        span.textContent = part;
        sources.appendChild(span);
      });
      q('since').textContent = sinceText(s.since);
      var st = status(s);
      el.classList.toggle('is-live', st.live);
      el.classList.remove('is-loading');
      q('status').textContent = st.text;
      renderGithub(s.github);
    }

    function poll() {
      if (document.hidden) return;
      fetch(base + '/stats', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(render)
        .catch(function () {
          el.classList.remove('is-live');
          q('status').textContent = 'Offline';
        });
    }

    var toggle = q('daily-toggle');
    var panel = q('daily');
    var daily = null;
    var dailyAt = 0;
    var loading = false;

    function loadDaily() {
      loading = true;
      if (!daily) panel.textContent = 'Loading daily usage…';
      fetch(base + '/daily', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { daily = d; dailyAt = Date.now(); renderDaily(panel, d); })
        .catch(function () { if (!daily) panel.textContent = 'Daily usage is unavailable right now. Close and open to try again.'; })
        .then(function () { loading = false; });
    }

    if (toggle && panel) {
      toggle.addEventListener('click', function () {
        var open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide daily' : 'Show daily';
        panel.hidden = !open;
        if (open && !loading && (!daily || Date.now() - dailyAt > DAILY_MAX_AGE)) loadDaily();
      });
    }

    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
  }

  return {
    formatFull: formatFull, formatCompact: formatCompact, ago: ago, status: status,
    sourceParts: sourceParts, sinceText: sinceText, formatDay: formatDay,
    heatThresholds: heatThresholds, heatLevel: heatLevel, calendar: calendar, dailySummary: dailySummary,
    mount: mount,
  };
});
