// Boot: the upload screen reads the 8 CSVs, ingest builds the datasets, then the dashboard scripts load.
// Calcs, drawings and listeners (calcs.js, ui.js, tabs.js) load only after the month bounds are known,
// because they read them when they register. All of them are classic scripts, so this works from disk.
(() => {
  const $ = (s) => document.querySelector(s);
  const input = $('#mk-file'), status = $('#mk-status'), errs = $('#mk-errors'), expected = $('#mk-expected');
  const K = window.mkIngest.KINDS;

  // The rows are in the HTML (scripts/upload-table.js), so the list shows even without scripts. Only Status changes here.
  function showExpected(found = {}) {
    for (const tr of expected.querySelectorAll('tr[data-kind]')) {
      const st = tr.querySelector('.mk-state');
      const f = found[tr.dataset.kind];
      st.textContent = f ? `✓ loaded from ${f}` : 'not loaded yet';
      st.className = 'mk-state ' + (f ? 'mk-good' : 'mk-muted');
    }
  }
  const notice = document.getElementById('mk-noscript'); if (notice) notice.hidden = true;
  showExpected();

  const readText = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(r.error); r.readAsText(file); });
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src)); document.body.append(s); });

  input.addEventListener('change', async () => {
    errs.replaceChildren(); status.textContent = 'Reading files…';
    try {
      const files = await Promise.all([...input.files].map(async (f) => ({ name: f.name, text: await readText(f) })));
      status.textContent = 'Building the datasets…';
      await new Promise((r) => setTimeout(r, 0));
      const t0 = performance.now();
      const res = window.mkIngest.ingest(files);
      showExpected(res.files || {});
      if (res.errors.length) {
        status.textContent = 'These files can’t be loaded yet. Fix the problems below, then choose all 8 files again (a new selection replaces the previous one):';
        errs.replaceChildren(...res.errors.map((e) => { const li = document.createElement('li'); li.textContent = e; return li; }));
        input.value = '';
        return;
      }
      await boot(res);
      console.log(`ingest + first render ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      status.textContent = 'Something went wrong reading the files: ' + e.message;
      console.error(e);
    }
  });

  async function boot(res) {
    const M = window.mk;
    M.configure({ asOf: res.asOf, first: res.first });
    const D = M.DEF;
    const fmtLong = d3.utcFormat('%-d %b %Y');
    const [y, m, d] = res.asOfDate.split('-').map(Number);
    const fill = (sel, text) => document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
    fill('.mk-asof-long', fmtLong(new Date(Date.UTC(y, m - 1, d))));
    fill('.mk-asof-month', M.monthLabel(D.end));
    fill('.mk-funnel-start', M.monthLabel(D.funnelStart));
    fill('.mk-first-year', D.first.slice(0, 4));
    fill('.mk-asof-src', `the last full month that leads, marketing spend and payroll all cover; set by ${res.setBy}`);

    // Default params: the prototype's, with month bounds from the data.
    const defaults = Object.assign({ acv: 15000, cac_ratio: 1.6, dg_share: 60, close_rate: 25, sal_opp: 33, mql_sal: 40, lead_mql: 50,
      pay_organic_search: null, pay_paid_search: null, pay_paid_social: null, pay_event: null, pay_referral: null, pay_direct: null, pay_partner: null, pay_email: null,
      x_stage: 'all', x_channel: '', x_status: '', x_reason: '', x_plan: '', x_churn: '', x_q: '', x_ids: '', x_note: '' },
      { start: D.start, end: D.end, c_start: D.c_start, c_end: D.c_end, x_start: D.x_start, x_end: D.x_end });
    dash.load(Object.assign({}, window.MK_STATIC_DATASETS || {}, res.datasets), defaults);
    for (const s of ['calcs.js', 'ui.js', 'hygiene-ui.js', 'tabs.js', 'ai-ui.js']) await loadScript(s);
    $('#mk-upload').hidden = true;
    const root = $('#mk-root');
    root.hidden = false;
    dash.start(root);
    $('#btn-reload').addEventListener('click', () => { location.hash = ''; location.reload(); });
  }
})();
