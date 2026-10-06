// Structural checks across every page: one shared header/footer, and no broken local links.
// Run: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (page) => fs.readFileSync(path.join(ROOT, page), 'utf8');

// Every .html page in the site, found on disk so a new page can't skip these checks.
// Redirect stubs (meta refresh, no chrome of their own) are left out.
const PAGES = fs.readdirSync(ROOT, { recursive: true })
  .map((p) => p.split(path.sep).join('/'))
  .filter((p) => p.endsWith('.html') && !p.startsWith('.') && !p.startsWith('node_modules/'))
  .filter((p) => !/http-equiv="refresh"/.test(read(p)))
  .sort();

test('the page list covers the whole site', () => {
  assert.equal(PAGES.length, 12, PAGES.join(', '));
});

// Same markup once relative prefixes and the current-page marker are taken out.
function normalize(block, page) {
  const prefix = path.posix.relative(path.posix.dirname(page), '.') || '.';
  return block
    .split(`"${prefix}/`).join('"/')
    .replace(/="\.\.?"/g, '="/"')
    .replace(/\s+aria-current="page"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function block(html, tag, cls) {
  const m = html.match(new RegExp(`<${tag} class="${cls}"[\\s\\S]*?</${tag}>`));
  return m && m[0];
}

for (const [tag, cls] of [['header', 'site-header'], ['footer', 'site-footer']]) {
  test(`every page shares the same ${tag}`, () => {
    const reference = normalize(block(read('index.html'), tag, cls), 'index.html');
    for (const page of PAGES) {
      const found = block(read(page), tag, cls);
      assert.ok(found, `${page} has no .${cls}`);
      assert.equal(normalize(found, page), reference, `${page} ${tag} differs from index.html`);
    }
  });
}

test('header marks exactly one page as current, except on the home page', () => {
  for (const page of PAGES) {
    const header = block(read(page), 'header', 'site-header');
    const current = (header.match(/aria-current="page"/g) || []).length;
    assert.equal(current, page === 'index.html' ? 0 : 1, `${page} has ${current} current links`);
  }
});

test('every page loads the shared site script', () => {
  for (const page of PAGES) {
    const prefix = path.posix.relative(path.posix.dirname(page), '.') || '.';
    assert.match(read(page), new RegExp(`<script src="${prefix.replace(/\./g, '\\.')}/site\\.js" defer></script>`), page);
  }
});

test('local links and assets point at files that exist', () => {
  for (const page of PAGES) {
    const refs = [...read(page).matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|tel:|#|data:)/.test(ref)) continue;
      let target = path.join(ROOT, path.dirname(page), ref.split('#')[0]);
      if (ref.split('#')[0].endsWith('/') || fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      }
      assert.ok(fs.existsSync(target), `${page} → ${ref} is missing`);
    }
  }
});
