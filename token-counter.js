/* Live token counter (Claude + Codex) — polls public totals from the counter Worker and animates the number. */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(document.querySelector('[data-token-counter]'));
})(function () {
  var LIVE_MS = 7 * 60 * 1000;
  var POLL_MS = 15000;
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

  function mount(el) {
    if (!el || !window.fetch) return;
    var url = el.getAttribute('data-endpoint').replace(/\/$/, '') + '/stats';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var shown = null;
    var frame = 0;
    function q(name) { return el.querySelector('[data-' + name + ']'); }

    function tween(target) {
      var node = q('total');
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
    }

    function poll() {
      if (document.hidden) return;
      fetch(url, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(render)
        .catch(function () {
          el.classList.remove('is-live');
          q('status').textContent = 'Offline';
        });
    }

    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
  }

  return {
    formatFull: formatFull, formatCompact: formatCompact, ago: ago, status: status,
    sourceParts: sourceParts, sinceText: sinceText, mount: mount,
  };
});
