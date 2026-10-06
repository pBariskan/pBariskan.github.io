/* Site-wide motion: header scroll progress, blocks lifting off the page as they scroll in, a marquee that
   reacts to scroll speed, the hero name drifting apart, image parallax and number count-ups.
   Blocks already on screen at load are left alone, and nothing moves under prefers-reduced-motion. */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.start();
})(function () {
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // 0 at the top of the page, 1 at the bottom.
  function progress(scrollY, docHeight, viewHeight) {
    var room = docHeight - viewHeight;
    return room > 0 ? clamp(scrollY / room, 0, 1) : 0;
  }

  // Scroll speed in px per frame → marquee playback rate: faster the harder you scroll, reversed when scrolling up.
  function marqueeRate(velocity) {
    if (!velocity) return 1;
    return (velocity < 0 ? -1 : 1) * (1 + clamp(Math.abs(velocity) / 6, 0, 5));
  }

  // Where an element's centre sits in the viewport: -1 at the top edge, 0 in the middle, 1 at the bottom edge.
  function viewOffset(top, height, viewHeight) {
    return clamp((top + height / 2 - viewHeight / 2) / (viewHeight / 2), -1.5, 1.5);
  }

  // Elements listed in reading order (top to bottom, then left to right), so a row lifts in left to right.
  function readingOrder(a, b) {
    return Math.abs(a.top - b.top) > 8 ? a.top - b.top : a.left - b.left;
  }

  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var begin = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - begin) / 1200);
      el.textContent = (target * (1 - Math.pow(1 - k, 3))).toFixed(decimals);
      if (k < 1) requestAnimationFrame(step);
    })(begin);
  }

  function lift(els) {
    els.map(function (el) { var r = el.getBoundingClientRect(); return { el: el, top: r.top, left: r.left }; })
      .sort(readingOrder)
      .forEach(function (item, i) {
        var el = item.el;
        el.style.setProperty('--pop-delay', i * 90 + 'ms');
        el.classList.remove('pop-wait');
        el.classList.add('pop-in');
        el.addEventListener('animationend', function done(e) {
          if (e.target !== el) return;
          el.classList.remove('pop-in');
          el.style.removeProperty('--pop-delay');
          el.removeEventListener('animationend', done);
        });
        [].forEach.call(el.querySelectorAll('[data-count]'), countUp);
      });
  }

  function start() {
    var doc = document.documentElement;
    var bar = document.querySelector('.site-header .scroll-progress');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var motion = !reduce && 'IntersectionObserver' in window;

    if (motion) {
      var below = [].filter.call(document.querySelectorAll('[data-pop]'), function (el) {
        return el.getBoundingClientRect().top > innerHeight * 0.92;
      });
      var io = new IntersectionObserver(function (entries) {
        var shown = entries.filter(function (e) { return e.isIntersecting; }).map(function (e) { return e.target; });
        shown.forEach(function (el) { io.unobserve(el); });
        if (shown.length) lift(shown);
      }, { rootMargin: '0px 0px -10% 0px' });
      below.forEach(function (el) { el.classList.add('pop-wait'); io.observe(el); });
    }

    var intro = document.querySelector('.intro');
    var drifters = [].slice.call(document.querySelectorAll('[data-drift]'));
    var parallax = [].slice.call(document.querySelectorAll('[data-parallax]'));
    var marquee = document.querySelector('.marquee');
    var track = marquee && marquee.querySelector('.marquee-track');
    var lastY = scrollY;
    var rate = 1;
    var queued = false;

    function frame() {
      queued = false;
      var y = scrollY;
      var vh = innerHeight;
      var velocity = y - lastY;
      lastY = y;
      if (bar) bar.style.transform = 'scaleX(' + progress(y, doc.scrollHeight, vh) + ')';
      if (!motion) return;

      if (intro && drifters.length) {
        var shift = clamp(y / intro.offsetHeight, 0, 1) * Math.min(innerWidth * 0.08, 110);
        drifters.forEach(function (el) { el.style.translate = (el.getAttribute('data-drift') * shift).toFixed(1) + 'px 0'; });
      }

      parallax.forEach(function (img) {
        var box = img.parentNode.getBoundingClientRect();
        if (box.bottom < -100 || box.top > vh + 100) return;
        var amount = parseFloat(img.getAttribute('data-parallax')) || 18;
        img.style.translate = '0 ' + (viewOffset(box.top, box.height, vh) * amount).toFixed(1) + 'px';
      });

      var anim = track && track.getAnimations && track.getAnimations()[0];
      if (anim) {
        rate += (marqueeRate(velocity) - rate) * 0.12;
        if (Math.abs(rate - 1) < 0.01) rate = 1;
        anim.playbackRate = rate;
        marquee.style.rotate = clamp((rate - 1) * 0.35, -1.6, 1.6).toFixed(2) + 'deg';
        if (rate !== 1) queue();
      }
    }

    function queue() {
      if (!queued) { queued = true; requestAnimationFrame(frame); }
    }

    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    frame();
  }

  return { clamp: clamp, progress: progress, marqueeRate: marqueeRate, viewOffset: viewOffset, readingOrder: readingOrder, start: start };
});
