// Squiggle generation time on a simulated mid-range phone: Chrome's CPU throttling on dev/stage.html,
// timing the builders only (no rendering), each cold (fresh page, first run) then warm, plus readCurve
// on a live-size dot list (renderSquiggle's default 1500 px canvas) and the whole flow with the ribbon shared.
// Needs the dev server (npx vite --port 5180).
//   node scripts/perf-squiggle.cjs [ids] [--rate 6] [--scale large] [--profile] [--port 5180]
const { chromium } = require('playwright-core');
const { exe } = require('./shot.cjs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = k => { const i = args.indexOf('--' + k); if (i >= 0) args.splice(i, 1); return i >= 0; };
const rate = +opt('rate', 6), scale = opt('scale', 'large'), port = opt('port', '5180'), profile = flag('profile');
const ids = (args[0] || '0,1004,3784,102').split(',').map(Number);
const BUDGET = 15000;
const JOBS = ['mosaic', 'ribbon', 'frame', 'floating', 'backdrop', 'flow'];

// runs in the page: one job, twice (cold then warm); builder time only, readCurve apart
async function job([id, name, scale]) {
  const [{ readCurve }, { buildMosaic }, { buildRelief }, { buildRibbon }] = await Promise.all(
    ['curve', 'mosaic', 'display', 'ribbon'].map(m => import(`/src/squiggle/${m}.ts`)));
  const fx = await sq.fixture(id), meta = { id: fx.id, hash: fx.hash };
  // a live render: Dot objects on the default 1500×1000 canvas
  const k = 1500 / fx.width, live = { ...fx, width: 1500, height: fx.height * k, dots: fx.dots.map(([x, y, d, fill, stroke], order) => ({ x: x * k, y: y * k, d: d * k, fill, stroke, order })) };
  const ok = m => m.checks.collisions === 0 && m.checks.floating === 0 && m.checks.rules.every(r => r.ok);
  const run = () => {
    let t = performance.now();
    const curve = readCurve(live), read = performance.now() - t, ms = {};
    t = performance.now();
    let m = null, pieces = 0, good = true;
    const one = (key, f) => { const t0 = performance.now(); m = f(); ms[key] = performance.now() - t0; pieces += m.pieces?.length ?? 0; if (m.checks) good = good && ok(m); };
    if (name === 'mosaic') one('build', () => buildMosaic(curve, scale, meta));
    else if (name === 'ribbon') one('build', () => buildRibbon(curve, scale));
    else if (name !== 'flow') one('build', () => buildRelief(curve, name, scale, meta));
    else {
      one('mosaic', () => buildMosaic(curve, scale, meta));
      for (const d of ['frame', 'floating', 'backdrop']) one(d, () => buildRelief(curve, d, scale, meta));
    }
    return { read, build: performance.now() - t, ms, pieces, ok: good, points: curve.points.length, dots: live.dots.length };
  };
  return [run(), run()];
}

// self and inclusive time per function from a CPU profile, top n by self time
function topFunctions(prof, n = 8) {
  const byId = new Map(prof.nodes.map(x => [x.id, x])), parent = new Map();
  for (const x of prof.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const fn = x => `${x.callFrame.functionName || '(anonymous)'} ${x.callFrame.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${x.callFrame.lineNumber + 1}`;
  const self = new Map(), incl = new Map();
  let total = 0;
  prof.samples.forEach((s, i) => {
    const dt = prof.timeDeltas[i + 1] ?? 0, x = byId.get(s), f = fn(x);
    if (/^\((idle|program)\)/.test(f)) return;
    total += dt; self.set(f, (self.get(f) ?? 0) + dt);
    const seen = new Set();
    for (let id = s; id !== undefined; id = parent.get(id)) { const g = fn(byId.get(id)); if (!seen.has(g)) { seen.add(g); incl.set(g, (incl.get(g) ?? 0) + dt); } }
  });
  const pct = v => (100 * v / total).toFixed(0).padStart(3) + '%';
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, v]) => `      self ${pct(v)}  incl ${pct(incl.get(f))}  ${f}`);
}

(async () => {
  const b = await chromium.launch({ executablePath: exe() });
  const ctx = await b.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' });
  const ms = x => String(Math.round(x)).padStart(7), s = x => (x / 1000).toFixed(2);
  console.log(`CPU throttling ${rate}×, scale ${scale}, builder time only (ms); cold = first run in a fresh page\n`);
  console.log('id     job           cold    warm  readCurve  pieces  checks');
  let worst = { t: 0 }, worstFlow = { t: 0 }, worstRead = { t: 0 };
  for (const id of ids) for (const name of JOBS) {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto(`http://localhost:${port}/dev/stage.html`);
    await p.waitForFunction(() => window.stageReady, null, { timeout: 60000 });
    // load modules and fixture unthrottled, so only the computation is timed
    await p.evaluate(async id => { await sq.fixture(id); for (const m of ['curve', 'mosaic', 'display', 'ribbon']) await import(`/src/squiggle/${m}.ts`); }, id);
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    const [cold, warm] = await p.evaluate(job, [id, name, scale]);
    const prof = profile ? (await cdp.send('Profiler.stop')).profile : null;
    const split = name === 'flow' ? '  (' + Object.entries(cold.ms).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') + ')' : '';
    console.log(`#${String(id).padEnd(5)} ${name.padEnd(9)} ${ms(cold.build)} ${ms(warm.build)} ${ms(cold.read).padStart(10)} ${String(cold.pieces).padStart(7)}  ${cold.ok ? 'ok' : 'FAIL'}${split}`);
    if (prof) console.log(topFunctions(prof).join('\n'));
    if (name === 'flow') { if (cold.build + cold.read > worstFlow.t) worstFlow = { t: cold.build + cold.read, id }; }
    else if (name !== 'ribbon' && cold.build > worst.t) worst = { t: cold.build, id, name };
    if (cold.read > worstRead.t) worstRead = { t: cold.read, id, dots: cold.dots, points: cold.points };
    await p.close();
  }
  const verdict = t => t < BUDGET / 2 ? `under 15 s with ${(BUDGET / t).toFixed(1)}× margin` : t < BUDGET ? `under 15 s but margin only ${(BUDGET / t).toFixed(1)}×` : 'OVER the 15 s budget';
  console.log(`\nworst builder (cold): ${worst.name} #${worst.id} ${s(worst.t)} s — ${verdict(worst.t)}`);
  console.log(`worst readCurve (live size, cold): #${worstRead.id} ${Math.round(worstRead.t)} ms for ${worstRead.dots} dots → ${worstRead.points} points`);
  console.log(`worst whole flow (readCurve + mosaic + frame + floating + backdrop, ribbon shared, cold): #${worstFlow.id} ${s(worstFlow.t)} s — ${verdict(worstFlow.t)}`);
  await b.close();
})();
