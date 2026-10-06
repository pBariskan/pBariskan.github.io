#!/usr/bin/env python3
"""Check the home page's first screen at real window sizes.

Rules:
- name + token counter always fit in the first screen, the number on one line, no sideways scroll;
- nothing is cut in half at the fold: every block is either fully above it or fully below it;
- no dead bands: the space above the name, below the counter and under the last block stays under 15%.
  The tags, intro line and marquee join the first screen when they fit whole, so tall windows aren't empty.

Serves a copy of the site with stubbed /stats and loads it in headless Chrome inside an iframe of each size
(headless windows have a minimum width; an iframe gives an exact viewport).

    python3 tests/fold_check.py
"""
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZES = [  # viewport (width, height, must_fit)
    (1672, 1003, True),  # the owner's browser window
    (1920, 960, True),
    (1512, 860, True),   # 14" MacBook Pro with browser toolbars
    (1440, 900, True),
    (1440, 760, True),
    (1280, 650, True),
    (1024, 700, True),
    (768, 900, True),
    (430, 740, True),    # iPhone Pro Max Safari with toolbars
    (390, 844, True),    # iPhone 14/15 with toolbars hidden
    (390, 664, True),    # iPhone 14/15 Safari with toolbars
    (375, 548, False),   # iPhone SE with toolbars: may overflow, but nothing may be cut at the fold
]
DEAD_BAND = 0.15
STATS = {
    "total": {"input": 1, "output": 82762954, "cache_read": 23670072231, "cache_write": 1, "all": 123456789012},
    "today": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "all": 1300000000},
    "sources": {"app": 16184735686, "cli": 2182091495, "web": 0, "codex": 5921893342},
    "since": "2026-04-13", "updatedAt": 1, "lastUsageAt": 1, "lastLocalAt": 1, "lastWebAt": None, "now": 2,
    "github": {"contributions": 3007, "updatedAt": 1},
}
MEASURE = """
<script>
setTimeout(function () {
  function box(el) { if (!el) return null; var r = el.getBoundingClientRect(); return r.height ? [r.top, r.bottom] : null; }
  var intro = document.querySelector('.intro');
  var visible = [].filter.call(intro.children, function (c) { return box(c); });
  // the intro section's own blocks count separately: tags, intro line and GitHub card may land on either side of the fold
  var blocks = [intro];
  [].forEach.call(document.querySelectorAll('main > *'), function (el) {
    if (el === intro) return;
    if (el.classList.contains('hero')) blocks = blocks.concat([].slice.call(el.children));
    else blocks.push(el);
  });
  var num = document.querySelector('.burn-number');
  var pre = document.createElement('pre');
  pre.id = 'fold';
  pre.textContent = JSON.stringify({
    vw: innerWidth,
    vh: innerHeight,
    headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom,
    contentTop: Math.min.apply(null, visible.map(function (c) { return box(c)[0]; })),
    name: box(document.querySelector('h1')),
    burn: box(document.querySelector('.burn')),
    heroContentTop: (box(document.querySelector('.hero-meta')) || [null])[0],
    blocks: blocks.map(function (el) { return { cls: el.className, box: box(el) }; }),
    numberLines: num.getBoundingClientRect().height / parseFloat(getComputedStyle(num).lineHeight),
    hOverflow: document.documentElement.scrollWidth > innerWidth
  });
  document.body.appendChild(pre);
}, 3000);
</script>
"""

FRAME = """<!doctype html><html><body style="margin:0">
<iframe id="f" src="/" width="{w}" height="{h}" style="border:0;display:block"></iframe>
<script>
setTimeout(function () {{
  var r = document.getElementById('f').contentDocument.getElementById('fold');
  var pre = document.createElement('pre');
  pre.id = 'fold';
  pre.textContent = r ? r.textContent : 'null';
  document.body.appendChild(pre);
}}, 4500);
</script></body></html>"""


def serve(root):
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=root, **k)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def measure(site, base, width, height):
    name = f"frame_{width}x{height}.html"
    with open(os.path.join(site, name), "w") as f:
        f.write(FRAME.format(w=width, h=height))
    out = subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=2200,1400",
         "--virtual-time-budget=8000", "--dump-dom", f"{base}/{name}"],
        capture_output=True, text=True, timeout=60).stdout
    m = re.search(r'<pre id="fold">(.*?)</pre>', out)
    return json.loads(m.group(1).replace("&quot;", '"')) if m else None


def problems_for(m, width, height, must_fit):
    if m is None:
        return ["no measurement"]
    if (m["vw"], m["vh"]) != (width, height):
        return [f"viewport was {m['vw']}x{m['vh']}"]
    vh, out = m["vh"], []
    if m["name"] is None or m["burn"] is None or m["name"][1] > m["burn"][0]:
        out.append("name is not above the counter")
    if m["numberLines"] > 1.2:
        out.append(f"number wraps onto {m['numberLines']:.1f} lines")
    if m["hOverflow"]:
        out.append("horizontal overflow")
    cut = [b["cls"] for b in m["blocks"] if b["box"] and b["box"][0] < vh - 1 and b["box"][1] > vh + 2]
    if cut:
        out.append(f"cut at the fold: {', '.join(cut)}")
    if must_fit:
        if m["burn"][1] + 8 > vh:
            out.append(f"counter cut: bottom {m['burn'][1] + 8:.0f}px > {vh}px")
        top_band = m["contentTop"] - m["headerBottom"]
        below = m["heroContentTop"] if m["heroContentTop"] is not None and m["heroContentTop"] < vh else vh
        counter_band = below - m["burn"][1]
        shown = [b["box"][1] for b in m["blocks"][1:] if b["box"] and b["box"][1] <= vh + 2]
        last_band = vh - max(shown) if shown else 0
        if shown and last_band < 0:
            out.append("last block runs past the fold")
        for label, band in (("above the name", top_band), ("below the counter", counter_band),
                            ("under the last block", last_band)):
            if band > DEAD_BAND * vh:
                out.append(f"{band:.0f}px empty {label} ({band / vh:.0%} of the window)")
    return out


def main(portfolio):
    tmp = tempfile.mkdtemp(prefix="fold-check-")
    try:
        site = os.path.join(tmp, "site")
        shutil.copytree(portfolio, site, ignore=shutil.ignore_patterns(".git", ".claude"))
        os.makedirs(os.path.join(site, "stub"))
        with open(os.path.join(site, "stub", "stats"), "w") as f:
            json.dump(STATS, f)
        server = serve(site)
        base = f"http://127.0.0.1:{server.server_port}"
        index = os.path.join(site, "index.html")
        html = open(index).read()
        html = re.sub(r'data-endpoint="[^"]*"', f'data-endpoint="{base}/stub"', html)
        open(index, "w").write(html.replace("</body>", MEASURE + "</body>"))

        failures = 0
        for width, height, must_fit in SIZES:
            # headless Chrome occasionally returns an empty DOM dump; one retry tells a flake from a failure
            m = measure(site, base, width, height) or measure(site, base, width, height)
            problems = problems_for(m, width, height, must_fit)
            failures += bool(problems)
            joined = [b["cls"].split()[0] for b in (m or {}).get("blocks", []) if b["box"] and b["box"][1] <= m["vh"] + 2]
            print(f"{'FAIL' if problems else 'ok  '} {width}x{height}  first screen: {' + '.join(joined) or '-'}  {'; '.join(problems)}")
        server.shutdown()
        server.server_close()
        return 1 if failures else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))
