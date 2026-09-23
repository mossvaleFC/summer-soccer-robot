/* robot/run.js -- one cycle of the tool's automatic work, with no browser open.

   Opens the deployed page in a simulated browser (JSDOM -- the same thing the
   test suite runs the page in), as a committee member called "Robot", lets
   the page run ONE cycle of what every open browser already does on its own
   timers (the form pulls, the Dribl read, the Sheet both ways), waits for the
   page to say it has finished, prints a summary of counts, and exits.

   Nothing that is a button for a person happens here: the page decides what
   the cycle contains (see robotRun() in the page), and this file only opens
   it and reads the report. The page is fetched from its live address on
   every run, so deploying the site is the only way the robot's behaviour
   changes -- there is no second copy of the tool's logic in this repository.

   Configuration comes from the environment (GitHub secrets and variables):

     SS_SITE_URL        the tool's address (the Netlify site)
     SS_WORKER_URL      the sync worker's address (…workers.dev)
     SS_SEASON_ID       the season id, as shown in the tool's Sync box
     SS_PASSWORD        the tool's shared password           (secret)
     JOTFORM_KEY        the Jotform API key                  (secret)
     JOTFORM_FORM_ID    the nominations form id
     ROBOT_HOURS        "6-23" -- Sydney hours it runs in (default 6-23)
     ROBOT_FORCE        "1" to run outside those hours
     ROBOT_TIMEOUT_MS   how long to wait for the page (default 420000)
     ROBOT_PAGE_FILE    a local copy of the page instead of SS_SITE_URL (tests)

   Exit code 0 on a good run, 1 on a failed one, 2 on a timeout, so a
   scheduled run that fails shows red on GitHub and e-mails whoever set the
   workflow up. The log carries counts only, never a name or an address:
   this repository is public and so are its logs.                        */
'use strict';
/* In the repository, jsdom is installed here. In the tool's folder on a
   committee laptop, where tests/robot.js runs this file, it is installed
   under tests/ instead. */
const { JSDOM } = (() => {
  try { return require('jsdom'); }
  catch(e){ return require(require('path').join(__dirname, '..', 'tests', 'node_modules', 'jsdom')); }
})();

function sydneyHour(now){
  const s = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).format(now || new Date());
  return parseInt(s, 10) % 24;
}
function inHours(spec, now){
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(spec || '6-23').trim());
  const from = m ? +m[1] : 6, to = m ? +m[2] : 23;
  const h = sydneyHour(now);
  return h >= from && h < to;
}

/* Only numbers and short error strings leave this process. The page's own
   report can carry a note like "3 new, 1 changed", which is fine, but an
   error from the worker or Jotform is cut short and never echoed whole. */
function publicSummary(rep){
  const out = { ok: !!rep.ok, ms: rep.ms || 0, steps: {}, errors: (rep.errors || []).map(e => String(e).slice(0, 160)) };
  if (rep.persistent && rep.persistent.length) out.persistent = rep.persistent.map(String);
  if (rep.failStreak) out.failStreak = rep.failStreak;
  if (rep.progress && rep.progress.step) out.stuckIn = String(rep.progress.step).slice(0, 40);
  if (rep.pending) out.pending = rep.pending.map(x => String(x).slice(0, 120)).slice(0, 8);
  if (rep.last) out.last = rep.last.map(x => String(x).slice(0, 120));
  if (rep.requests !== undefined) out.requests = rep.requests;
  Object.keys(rep.steps || {}).forEach(k => {
    const s = rep.steps[k] || {};
    const o = {};
    Object.keys(s).forEach(f => {
      const v = s[f];
      if (typeof v === 'number' || typeof v === 'boolean') o[f] = v;
      else if (f === 'skipped') o.skipped = String(v).slice(0, 80);
      else if (f === 'error') o.error = String(v).slice(0, 160);
      else if (f === 'warning') o.warning = String(v).slice(0, 160);
    });
    out.steps[k] = o;
  });
  return out;
}
/* Runs the page once. `fetchImpl` is what the page's fetch() becomes --
   Node's own fetch in production, a fake in the tests. Resolves with the
   page's report (or a timeout report); never throws for a page-side failure. */
async function runRobot(opts){
  const { html, siteUrl, workerUrl, seasonId, password, jotformKey, jotformFormId } = opts;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 420000;
  const name = opts.name || 'Robot';
  const trace = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: siteUrl,
    beforeParse(w){
      w.__ROBOT__ = { at: Date.now(), stepMs: opts.stepMs || undefined };
      /* Every request the page makes, by host and path only (no query
         string -- the Jotform key rides in one), with when it started and
         whether it came back. When the page never finishes, the requests
         still outstanding are the answer to "stuck where?", whatever the
         page itself managed to report (23 Sep 2026). */
      w.fetch = (url, init) => {
        const u = String(url);
        let path; try { const p = new URL(u); path = p.host + p.pathname; } catch(e){ path = u.slice(0, 80); }
        const rec = { path, at: Date.now(), done: 0, status: 0 };
        trace.push(rec);
        return fetchImpl(u, init).then(r => { rec.done = Date.now(); rec.status = r.status; return r; },
                                       e => { rec.done = Date.now(); rec.status = -1; throw e; });
      };
      /* What a committee member's browser would hold after they had set the
         tool up once: the sync box, the session's password, the Jotform key.
         A fresh profile every run, so nothing accumulates. */
      w.localStorage.setItem('ss-cloud-cfg', JSON.stringify({ url: workerUrl, seasonId, name }));
      w.sessionStorage.setItem('ss-cloud-pass', password || '');
      w.localStorage.setItem('jotform-config-v1', JSON.stringify({
        apiKey: jotformKey || '', formId: jotformFormId || '', auto: true, intervalMin: 5, v: 3 }));
      /* The page's own console is noise here (render timings, warnings from
         CSS jsdom cannot parse). Errors still surface through the report. */
      w.console.log = () => {}; w.console.warn = () => {}; w.console.info = () => {};
    }
  });
  const w = dom.window;
  const started = Date.now();
  let rep;
  try {
    rep = await new Promise(resolve => {
      const tick = () => {
        if (w.__ROBOT_DONE__) return resolve(w.__ROBOT_DONE__);
        if (Date.now() - started > timeoutMs){
          /* Which step the page was in when the clock ran out, and for how
             long: the difference between "the robot is slow" and "one call
             never comes back" (23 Sep 2026). */
          const p = w.__ROBOT_PROGRESS__ || null;
          const where = p ? ' during ' + p.step + ' (' + Math.round((Date.now() - p.at) / 1000) + ' s in)' : ' (the page did not say which step)';
          const now = Date.now();
          const pending = trace.filter(r => !r.done).map(r => r.path + ' ' + Math.round((now - r.at) / 1000) + 's');
          const last = trace.slice(-6).map(r => r.path + ' ' + (r.done ? r.status + ' ' + (r.done - r.at) + 'ms' : 'pending'));
          return resolve({ ok: false, timeout: true, ms: now - started, steps: {}, progress: p, pending, last, requests: trace.length,
                           errors: ['timed out after ' + Math.round(timeoutMs / 1000) + ' s' + where] });
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  } finally {
    try { w.close(); } catch(e){}
  }
  return rep;
}
async function main(){
  const env = process.env;
  const now = new Date();
  if (!env.ROBOT_FORCE && !inHours(env.ROBOT_HOURS, now)){
    console.log(JSON.stringify({ skipped: 'outside hours', sydneyHour: sydneyHour(now) }));
    return 0;
  }
  const missing = ['SS_WORKER_URL', 'SS_SEASON_ID', 'SS_PASSWORD'].filter(k => !env[k]);
  if (missing.length){ console.log(JSON.stringify({ ok: false, errors: ['missing: ' + missing.join(', ')] })); return 1; }
  const siteUrl = env.SS_SITE_URL || 'https://mvfc-summer-soccer-tool.netlify.app/';
  let html, page = { source: env.ROBOT_PAGE_FILE ? 'file' : 'site' };
  if (env.ROBOT_PAGE_FILE) html = require('fs').readFileSync(env.ROBOT_PAGE_FILE, 'utf8');
  else {
    /* Fetched the way a browser would ask for it. What comes back is checked
       before it is run: a page that is not the tool (a host's challenge or
       error page answered with 200, an empty deploy) used to be loaded
       anyway and waited on for the full clock, with nothing to say why
       (23 Sep 2026: seventy runs of "0 requests"). */
    const res = await fetch(siteUrl, { headers: { 'Cache-Control': 'no-cache', 'Accept': 'text/html,*/*',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) SummerSoccerRobot/1.0 (+https://github.com/mossvaleFC/summer-soccer-robot)' } });
    page.status = res.status; page.type = String(res.headers.get('content-type') || '').slice(0, 60);
    /* The response headers that say who answered and how (a CDN's request
       id, an encoding, a cache verdict): the site is public, so these are
       not secrets, and they are what tells a wrong answer from a wrong
       reading of the right one. */
    page.headers = {};
    ['content-encoding', 'content-length', 'server', 'x-nf-request-id', 'cache-status', 'age', 'via', 'x-powered-by', 'location'].forEach(h => {
      const v = res.headers.get(h); if (v) page.headers[h] = String(v).slice(0, 80);
    });
    page.finalUrl = String(res.url || '').slice(0, 120);
    if (!res.ok){ console.log(JSON.stringify({ ok: false, page, errors: ['page fetch: HTTP ' + res.status] })); return 1; }
    html = await res.text();
  }
  page.chars = html.length;
  page.title = String((/<title>([^<]{0,80})/i.exec(html) || [])[1] || '').trim();
  page.isTool = html.indexOf('window.CLOUD') >= 0 && html.indexOf('robotRun') >= 0;
  if (!page.isTool){
    /* The first line of whatever came back, so the log says what it was
       (an error page, a challenge, a file that is not HTML) -- the public
       page, never anything the robot was given. */
    page.head = html.slice(0, 200).replace(/\s+/g, ' ');
    page.bytes = Buffer.byteLength(html, 'utf8');
    console.log(JSON.stringify({ ok: false, page, errors: ['the page fetched is not the tool (no CLOUD/robotRun in it)'] }));
    return 1;
  }
  const rep = await runRobot({
    html, siteUrl, workerUrl: env.SS_WORKER_URL, seasonId: env.SS_SEASON_ID, password: env.SS_PASSWORD,
    jotformKey: env.JOTFORM_KEY, jotformFormId: env.JOTFORM_FORM_ID,
    timeoutMs: Number(env.ROBOT_TIMEOUT_MS) || undefined
  });
  const summary = publicSummary(rep);
  summary.sydneyHour = sydneyHour(now);
  summary.page = page;
  console.log(JSON.stringify(summary));
  return rep.timeout ? 2 : rep.ok ? 0 : 1;
}

module.exports = { runRobot, publicSummary, inHours, sydneyHour };
if (require.main === module){
  main().then(code => process.exit(code), e => { console.log(JSON.stringify({ ok: false, errors: [String(e && e.message || e).slice(0, 160)] })); process.exit(1); });
}
