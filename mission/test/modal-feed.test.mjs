// Everything Modal is sending (Gavin, 28 Oct: "rather than 'dave' use 'modal' in their company green. we want to show every value
// coming from the modal thing"): the server's fetch of Modal's two public answers (lib/modal-feed.mjs: ETag, 15 s, short timeout,
// last good copy), the page's listing of every field (public/modal-feed.js), the fixtures' copies, the name "Modal" and its green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModalFeed, MODAL_FEED_PATHS, MODAL_FEED_EVERY_MS } from '../lib/modal-feed.mjs';
import { Mission } from '../lib/mission.mjs';
import { FixtureMission, fixtureModalFeed } from '../lib/fixtures.mjs';
import { modalFeedView, SCENE_FIELDS, FRAMES_FIELDS, NOT_USED } from '../public/modal-feed.js';
import { modalInputView, FROM_WORDS, FRAME_FIELD_INFO, PARAM_INFO, DRIVES_WORDS, sourceIntro } from '../public/modal-input.js';
import { MODAL_SOURCE_WORDS, modalStaleWords, derive } from '../public/model.js';
import { describeTool } from '../lib/steps.mjs';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
const fx = (name) => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
const NOW = 1792749540000;

/** A fake fetch: answers from a script of { status, body, etag } (or an Error to throw) per path, and records each request. */
function fakeFetch(script) {
  const calls = [];
  const f = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, inm: init.headers?.['if-none-match'] ?? null });
    const next = script[path].length > 1 ? script[path].shift() : script[path][0];
    if (next instanceof Error) throw next;
    return { status: next.status, ok: next.status >= 200 && next.status < 300, headers: { get: (h) => (h === 'etag' ? next.etag ?? null : null) },
             text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)) };
  };
  f.calls = calls;
  return f;
}
const FEED = fixtureModalFeed();

test('the server asks both public endpoints every 15 s, then only If-None-Match: a 304 keeps the copy and says when it checked', async () => {
  assert.equal(MODAL_FEED_EVERY_MS, 15_000);
  assert.deepEqual(MODAL_FEED_PATHS, { scene: '/public/scene.json', frames: '/frames/latest.json' });
  let t = NOW;
  const fetch = fakeFetch({ '/public/scene.json': [{ status: 200, body: FEED.scene.json, etag: '"06b7ea"' }, { status: 304 }],
                            '/frames/latest.json': [{ status: 200, body: FEED.frames.json, etag: 'W/"ed9b"' }, { status: 304 }] });
  const feed = new ModalFeed({ fetch, now: () => t });
  await feed.poll();
  assert.deepEqual(fetch.calls.map((c) => c.inm), [null, null], 'the first time, no ETag to send');
  let v = feed.value();
  assert.deepEqual(v.scene.json, FEED.scene.json);
  assert.equal(v.scene.ok, true);
  assert.equal(v.frames.fetched_at, new Date(NOW).toISOString());
  assert.equal(v.frames.changed_at, new Date(NOW).toISOString());
  t += 15_000;
  await feed.poll();
  assert.deepEqual(fetch.calls.slice(2).map((c) => c.inm).sort(), ['"06b7ea"', 'W/"ed9b"']);
  v = feed.value();
  assert.deepEqual(v.frames.json, FEED.frames.json, 'a 304 keeps what came before');
  assert.equal(v.frames.fetched_at, new Date(t).toISOString(), 'checked now');
  assert.equal(v.frames.changed_at, new Date(NOW).toISOString(), 'changed when it last changed');
  assert.equal(JSON.stringify(v).includes('06b7ea'), false, 'the ETag stays on the server');
});

test('a failure, a timeout, an odd answer: the last good copy stays, with ok false and the error beside it; poll never throws', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const fetch = fakeFetch({ '/public/scene.json': [{ status: 200, body: FEED.scene.json, etag: '"a"' }, timeout, { status: 503, body: 'no' }, { status: 200, body: 'not json' }, { status: 200, body: '[1,2]' }, { status: 200, body: 'x'.repeat(70_000) }],
                            '/frames/latest.json': [new Error('fetch failed')] });
  const feed = new ModalFeed({ fetch, now: () => NOW });
  await feed.poll();
  assert.equal(feed.value().frames.ok, false);
  assert.equal(feed.value().frames.json, null, 'never had one');
  assert.equal(feed.value().frames.error, 'fetch failed');
  for (const want of [/didn't answer in time/, /answered 503/, /isn't readable/, /isn't readable/, /too large/]) {
    await feed.poll();
    const s = feed.value().scene;
    assert.equal(s.ok, false);
    assert.match(s.error, want);
    assert.deepEqual(s.json, FEED.scene.json, 'the last good copy');
  }
});

test('one round at a time: a slow Modal never piles requests up', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  const fetch = async () => { n++; await gate; return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{}' }; };
  const feed = new ModalFeed({ fetch });
  const a = feed.poll(), b = feed.poll();
  assert.equal(a, b);
  release(); await a;
  assert.equal(n, 2, 'one request per endpoint');
});

test('the live snapshot always carries modal_feed, whatever show runs (it never waits on Modal)', () => {
  const m = new Mission({ probe: async () => ({}), feed: { value: () => FEED, poll: async () => {} } });
  m.data.probe = { at: Date.now(), value: { td: { ok: true, file: 'river-local-oct-22-seasons.toe' } } };
  assert.deepEqual(m.snapshot().modal_feed, FEED);
  const m2 = new Mission({ probe: async () => ({}) });
  assert.deepEqual(Object.keys(m2.snapshot().modal_feed), ['scene', 'frames'], 'before the first answer: both, empty');
  assert.equal(m2.snapshot().modal_feed.scene.json, null);
});

// ---- the page: every value listed ----------------------------------------------------------------------------------------------
/** Every leaf of an answer, as dotted paths (what Modal sent, independently of the page's walk). */
function leaves(o, prefix = '') {
  return Object.entries(o).flatMap(([k, v]) => { const p = prefix ? `${prefix}.${k}` : k; return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? leaves(v, p) : [p]; });
}
const rowsOf = (part) => part.groups.flatMap((g) => g.rows);

test('every field of both answers is listed, with what it is and whether bitcube uses it; nothing is left out', () => {
  const v = modalFeedView(FEED, NOW);
  const scene = rowsOf(v.scene).map((r) => r.path);
  assert.deepEqual(scene, leaves(FEED.scene.json), 'scene.json: every field, in its order');
  for (const p of ['updated_at', 'scene.animation', 'scene.colors', 'scene.palette_name', 'scene.speed', 'scene.density', 'scene.brightness', 'scene.turbulence',
                   'scene.transition_seconds', 'scene.placeholder', 'scene.set_at', 'scene.tick', 'reflex.live', 'reflex.offsets.speed', 'reflex.offsets.density',
                   'reflex.offsets.brightness', 'reflex.offsets.turbulence', 'reflex.updated_at', 'effective.speed', 'effective.density', 'effective.brightness',
                   'effective.turbulence', 'journal.tick', 'journal.timestamp', 'journal.mood_word', 'journal.summary']) assert.ok(SCENE_FIELDS[p], `scene.json ${p} has its words`);
  for (const p of ['schema', 'layout_version', 'frame_id', 'issued_at', 'ttl_s', 'transition.duration_ms', 'transition.easing', 'transition.space', 'transition.via', 'note',
                   'elements.*.image', 'elements.*.sha256', 'elements.*.river.amount', 'elements.*.river.contrast', 'elements.*.river.speed']) assert.ok(FRAMES_FIELDS[p], `frames ${p} has its words`);
  for (const r of [...rowsOf(v.scene), ...rowsOf(v.frames)]) {
    assert.ok(r.label && r.info && r.used?.words, r.path);
    assert.ok(r.used.by == null || ['scene', 'frames', 'canvas'].includes(r.used.by), r.path);
  }
  // frames: the screens read the same (but their pictures and fingerprints), so they are one group with all four pictures
  const groups = v.frames.groups.map((g) => g.title);
  assert.deepEqual(groups, ['This set', 'The journey to the new pictures', 'Screens 1–4 (the same settings)', 'Ropes']);
  const pics = v.frames.groups[2].rows[0];
  assert.equal(pics.kind, 'images');
  assert.deepEqual(pics.items.map((x) => x.sha), ['07897f6601ee', '4a4690c58720', '644ba5afacf9', 'a70125529805'], 'each picture with its short fingerprint');
  assert.ok(pics.items.every((x) => x.url === `https://to-be-a-river--river.modal.run/frames/${FEED.frames.json.frame_id}/${x.element}.png`));
  const shown = new Set(rowsOf(v.frames).map((r) => r.path.replace('screen-1..4', 'screen-1')));
  for (const p of leaves(FEED.frames.json).filter((p) => !/^elements\.screen-[2-4]\./.test(p) && !/^elements\.screen-1\.(image|sha256)$/.test(p))) assert.ok(shown.has(p), `frames ${p} listed`);
  assert.equal(v.frames.count, leaves(FEED.frames.json).length);
});

test('a field Modal adds later is still listed, by its name, "not used yet", and counted as new', () => {
  const v = modalFeedView(FEED, NOW);
  const extra = rowsOf(v.scene).filter((r) => r.extra);
  assert.deepEqual(extra.map((r) => [r.path, r.label, r.text, r.used.by, r.used.words]),
    [['weather.sky', 'Weather · sky', 'overcast', null, NOT_USED], ['weather.wind_kph', 'Weather · wind kph', '12', null, NOT_USED]]);
  assert.equal(v.scene.groups.at(-1).title, 'New from Modal: Weather');
  assert.equal(v.scene.extra, 2);
  const glow = rowsOf(v.frames).find((r) => r.path === 'elements.ropes.glow');
  assert.equal(glow.extra, true);
  assert.equal(glow.text, '0.3');
  // anything at all: nested, a list, a list of colours, an object in a list, null
  const odd = structuredClone(FEED);
  odd.frames.json.mood = { deep: { deeper: { deepest: { bottom: 1 } } } };
  odd.frames.json.tags = ['calm', 2, true];
  odd.frames.json.accent = ['#112233', '#445566'];
  odd.frames.json.pairs = [{ a: 1 }];
  odd.frames.json.gone = null;
  const r = Object.fromEntries(rowsOf(modalFeedView(odd, NOW).frames).map((x) => [x.path, x]));
  assert.equal(r['mood.deep.deeper.deepest.bottom'].text, '1', 'nested objects are walked');
  assert.equal(r.tags.text, 'calm, 2, true');
  assert.deepEqual(r.accent.colors, ['#112233', '#445566']);
  assert.equal(r.pairs.text, '[{"a":1}]');
  assert.equal(r.gone.text, 'none');
});

test('values are checked before they reach the page: colours, Modal-only pictures, fingerprints, times, long text', () => {
  const bad = structuredClone(FEED);
  bad.scene.json.scene.colors = ['#fff', 'red', '#12345g'];
  bad.scene.json.scene.palette_name = '<img src=x onerror=alert(1)>';
  bad.frames.json.elements.ropes.image = 'https://evil.example/ropes.png';
  bad.frames.json.elements['screen-1'].image = '/frames/../../etc/passwd';
  bad.frames.json.elements['screen-2'].sha256 = 'nope';
  bad.frames.json.note = 'x'.repeat(1000);
  const v = modalFeedView(bad, NOW), all = [...rowsOf(v.scene), ...rowsOf(v.frames)];
  const at = (p) => all.find((r) => r.path === p);
  assert.equal(at('scene.colors').kind, 'text', 'not every one a #rrggbb colour: no swatch');
  assert.equal(at('scene.palette_name').text, '<img src=x onerror=alert(1)>', 'kept as text (the page escapes it)');
  assert.equal(at('elements.ropes.image').kind, 'text');
  assert.match(at('elements.ropes.image').text, /^not a picture from Modal/);
  const pics = v.frames.groups.find((g) => g.element === 'screens').rows[0].items;
  assert.equal(pics[1].sha, 'not a fingerprint');
  assert.equal(pics[0].url, null);
  assert.match(pics[0].text, /^not a picture from Modal/);
  assert.ok(at('note').text.length <= 301);
  assert.ok(!JSON.stringify(v).includes('evil.example/ropes.png"') || at('elements.ropes.image').kind !== 'image');
  for (const r of all) if (r.url) assert.match(r.url, /^https:\/\/to-be-a-river--river\.modal\.run\/frames\/[A-Za-z0-9._-]+\/(screen-[1-4]|ropes)\.png$/);
  // the screens still read the same but for their pictures: one group, each picture checked on its own
  assert.ok(v.frames.groups.some((g) => g.title === 'Screens 1–4 (the same settings)'));
  const t = at('scene.set_at');
  assert.equal(t.kind, 'time');
  assert.equal(t.ms, Date.parse('2026-10-23T02:58:18-07:00'));
  assert.equal(at('transition.duration_ms').hint, '1 min');
  assert.equal(at('ttl_s').hint, '15 min');
});

test('screens 1–4 are one group while they read the same, one each once a value differs; their pictures always shown', () => {
  const diff = structuredClone(FEED);
  diff.frames.json.elements['screen-3'].river.amount = 0.9;
  const g = modalFeedView(diff, NOW).frames.groups.map((x) => x.title);
  assert.deepEqual(g, ['This set', 'The journey to the new pictures', 'Screen 1', 'Screen 2', 'Screen 3', 'Screen 4', 'Ropes']);
  const s3 = modalFeedView(diff, NOW).frames.groups[4].rows;
  assert.deepEqual(s3.map((r) => r.label), ['Picture', 'Fingerprint', 'Ripple', 'Ripple strength', 'River speed']);
  assert.equal(s3[0].kind, 'image');
});

test('what a used value drives: TouchDesigner\'s drives words when the show reports them; the page\'s own otherwise', () => {
  const f = fx('modal-input-scene'), d = derive({ ...f.status, now: f._scenario.now }, f._scenario.now);
  const mi = modalInputView(d.show.modal_input, 0, NOW);
  const v = modalFeedView(f.status.modal_feed, NOW, mi);
  const at = (p) => rowsOf(v.scene).find((r) => r.path === p);
  assert.deepEqual(at('scene.speed').used, { by: 'scene', words: mi.params.find((p) => p.name === 'speed').drives });
  assert.equal(at('scene.colors').used.words, DRIVES_WORDS.palette);
  assert.equal(at('effective.speed').used.by, null);
  assert.match(at('effective.speed').used.words, /bitcube adds the nudge itself/);
  assert.equal(at('scene.tick').used.words, NOT_USED);
  assert.equal(at('scene.speed').more, PARAM_INFO.speed, 'the ⓘ keeps the panel\'s own explanation');
  assert.equal(rowsOf(v.frames).find((r) => /river\.amount$/.test(r.path)).more, FRAME_FIELD_INFO.amount);
});

test('Modal answered with an error: the last good copy is listed, with the failure; nothing at all: null', () => {
  const v = modalFeedView(fixtureModalFeed({ sceneError: "Modal didn't answer in time" }), NOW);
  assert.equal(v.scene.ok, false);
  assert.equal(v.scene.error, "Modal didn't answer in time");
  assert.ok(v.scene.count > 20);
  assert.equal(v.scene.fetched_age_s, 8);
  assert.equal(modalFeedView(null), null);
  assert.deepEqual(modalFeedView({ scene: { json: null, ok: null } }, NOW).scene.groups, []);
});

test('fixtures: every Modal input scenario carries both answers (one field Modal doesn\'t send today in each); a world switched to the show gets them too', () => {
  for (const n of ['modal-input-scene', 'modal-input-frames', 'modal-input-canvas', 'modal-input-off', 'modal-input-frames-stale']) {
    const f = fx(n).status.modal_feed;
    assert.ok(f.scene.json.weather && f.frames.json.elements.ropes.glow != null, n);
    assert.equal(f.frames.json.frame_id, fx(n).status.probe.value.td.modal_input.sources.frames.frame_id, `${n}: the same frame as the show`);
  }
  const f = fx('all-good');
  assert.equal(f.status.modal_feed, undefined);
  const m = new FixtureMission({ dir: DIR, stateDir: mkdtempSync(join(tmpdir(), 'mf-')), now: () => f._scenario.now, applyS: 0 });
  assert.equal(m.snapshot('modal-input-frames').modal_feed.frames.json.schema, 'modal-frames/1');
  assert.equal(m.snapshot('all-good').modal_feed, undefined, 'another show: nothing added');
});

// ---- the name, and its green ----------------------------------------------------------------------------------------------------
test('the panel says Modal, never Dave: the choice, warnings, Latest, chips, intros, explanations, captions', () => {
  const words = [...Object.values(MODAL_SOURCE_WORDS).map((w) => w.line), ...Object.values(FROM_WORDS), ...Object.values(FRAME_FIELD_INFO), ...Object.values(PARAM_INFO),
    ...Object.values(DRIVES_WORDS), ...['frames', 'scene', 'canvas'].map((s) => sourceIntro(s, 20)), ...['frames', 'scene', 'canvas'].map((s) => modalStaleWords(s, { data_age_s: 1260 })),
    ...Object.values(SCENE_FIELDS).flat(2), ...Object.values(FRAMES_FIELDS).flat(2)];
  for (const w of words) assert.doesNotMatch(String(w), /Dave/, w);
  assert.equal(FROM_WORDS.modal, 'from Modal');
  const js = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8');
  const panel = js.slice(js.indexOf('function miChanged'), js.indexOf('function openShowList'));
  assert.ok(panel.length > 2000);
  assert.doesNotMatch(panel.replace(/^\s*(\/\/|\/\*\*|\*).*$/gm, ''), /Dave/, 'no "Dave" in the panel\'s copy');
  for (const s of ['What ${MODAL_CHIP} is sending', 'Latest from ${MODAL_CHIP}:', 'Everything ${MODAL_CHIP} is sending', "Modal's latest pictures", 'Every input from Modal']) assert.ok(panel.includes(s), s);
  assert.match(js, /const MODAL_CHIP = '<span class="modal-chip">Modal<\/span>'/);
  const feedJs = readFileSync(new URL('../public/modal-feed.js', import.meta.url), 'utf8');
  assert.doesNotMatch(feedJs.replace(/^\s*(\/\/|\/\*\*|\*).*$/gm, ''), /Dave/);
});

/** WCAG contrast of two #rrggbb colours. */
function contrast(a, b) {
  const L = (h) => { const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
test("Modal's green: tokens in both themes; the chip and green text pass AA (4.5:1) where they are used", () => {
  const css = readFileSync(new URL('../public/v2.css', import.meta.url), 'utf8');
  const tok = (block, name) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)?.[1];
  const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
  const darkMedia = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf(':root[data-theme="dark"]'));
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
  assert.equal(tok(light, 'modal-green'), '#7FEE64');
  assert.equal(tok(light, 'modal-green-deep'), '#09AF58');
  assert.equal(tok(light, 'modal-green-ink'), '#0B2A0F');
  assert.ok(contrast('#7FEE64', '#0B2A0F') >= 4.5, 'the chip: dark ink on bright green');
  assert.ok(contrast(tok(light, 'modal-green-text'), tok(light, 'panel-solid')) >= 4.5, 'light: green text');
  assert.ok(contrast('#09AF58', '#ffffff') < 4.5, '#09AF58 is never text on the light card');
  for (const d of [darkMedia, dark]) {
    assert.equal(tok(d, 'modal-green-text'), '#7FEE64');
    assert.ok(contrast(tok(d, 'modal-green-text'), tok(d, 'panel-solid')) >= 4.5, 'dark: #7FEE64 text on the dark card');
  }
  const sc = readFileSync(new URL('../public/status.css', import.meta.url), 'utf8');
  assert.match(sc, /\.modal-chip \{[^}]*color: var\(--modal-green-ink\); background: var\(--modal-green\)/);
  assert.match(sc, /\.mi-from\.modal \{ color: var\(--modal-green-ink\); background: var\(--modal-green\)/);
  assert.match(sc, /\.mf-toggle \{[^}]*min-height: 44px/);
});

test("the studio agent's step line for Modal's public answers says what the panel says", () => {
  assert.equal(describeTool({ name: 'WebFetch', input: { url: 'https://to-be-a-river--river.modal.run/frames/latest.json' } }).text, 'looked at what Modal is sending');
  assert.equal(describeTool({ name: 'WebFetch', input: { url: 'https://to-be-a-river--river.modal.run/public/scene.json' } }).text, 'looked at what Modal is sending');
  assert.equal(describeTool({ name: 'WebFetch', input: { url: 'https://to-be-a-river--river.modal.run/data/state.json' } }).text, "looked at what Dave's agent is doing");
});
