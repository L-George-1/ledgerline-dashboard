// Listeners only: tabs, drill-through clicks, controls. Writes here are limited to hidden, aria-*, class, value.
(() => {
  const M = window.mk;
  const TABS = ['summary', 'demand-gen', 'churn', 'benchmarks', 'explorer', 'hygiene'];
  function showTab(id) {
    if (!TABS.includes(id)) id = 'summary';
    document.querySelectorAll('.mk-panel[role=tabpanel]').forEach((p) => { p.hidden = p.id !== id; });
    document.querySelectorAll('.mk-tab[data-tab]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    dash.setLink(id);
  }
  window.mkShowTab = showTab;
  document.querySelectorAll('.mk-tab[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const h = (location.hash || '').replace('#', '');
  if (TABS.includes(h)) showTab(h);

  // Drill-through: any element with data-drill opens the explorer with that filter.
  function drill(spec) {
    window.mkPage = 0;
    const p = M.specToParams(spec);
    p.x_note = spec.note || '';
    dash.setParams(p);
    showTab('explorer');
    const top = document.querySelector('#explorer');
    if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' });
  }
  window.mkDrill = drill;
  const root = document.querySelector('.mk') || document;
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-drill]');
    if (!t) return;
    try { drill(JSON.parse(t.getAttribute('data-drill'))); } catch (e) { /* malformed spec: ignore */ }
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const t = ev.target.closest && ev.target.closest('[data-drill]');
    if (!t) return;
    ev.preventDefault();
    try { drill(JSON.parse(t.getAttribute('data-drill'))); } catch (e) { /* ignore */ }
  });

  // Demand gen controls
  document.querySelectorAll('#metric-select').forEach((s) => s.addEventListener('change', () => { window.mkMetric = s.value; dash.draw('chart'); }));
  document.querySelectorAll('#btn-ttm').forEach((b) => b.addEventListener('click', () => dash.setParams({ start: M.DEF.start, end: M.DEF.end })));
  document.querySelectorAll('#btn-all').forEach((b) => b.addEventListener('click', () => dash.setParams({ start: M.DEF.funnelStart, end: M.DEF.end })));
  document.querySelectorAll('[data-param]').forEach((inp) => inp.addEventListener('change', () => {
    const v = inp.value === '' ? null : Number(inp.value);
    dash.setParams({ [inp.dataset.param]: v != null && isFinite(v) && v > 0 ? v : null });
  }));
  document.querySelectorAll('#btn-reset-targets').forEach((b) => b.addEventListener('click', () => dash.setParams({ ...M.TARGET_DEFAULTS })));
  document.querySelectorAll('input[type=range][data-ch]').forEach((inp) => inp.addEventListener('change', () => dash.setParams({ ['pay_' + inp.dataset.ch]: Number(inp.value) })));
  document.querySelectorAll('#btn-reset-other').forEach((b) => b.addEventListener('click', () => dash.setParams({ pay_other: null })));
  document.querySelectorAll('#btn-reset-pay').forEach((b) => b.addEventListener('click', () => {
    const o = {}; M.CHANNELS.slice(0, 8).forEach((c) => { o['pay_' + c] = null; }); dash.setParams(o);
  }));
  // Churn controls
  document.querySelectorAll('#btn-c-2023').forEach((b) => b.addEventListener('click', () => dash.setParams({ c_start: M.DEF.c_start, c_end: M.DEF.end })));
  document.querySelectorAll('#btn-c-all').forEach((b) => b.addEventListener('click', () => dash.setParams({ c_start: M.DEF.first, c_end: M.DEF.end })));

  // Explorer controls (month selects are wired in their drawing)
  let qTimer = null;
  document.querySelectorAll('[data-x]').forEach((el) => {
    if (el.hasAttribute('data-draw')) return;
    const key = 'x_' + el.dataset.x;
    const apply = () => { window.mkPage = 0; dash.setParams({ [key]: el.value, x_note: '', x_ids: '' }); };
    if (el.tagName === 'INPUT') el.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(apply, 350); });
    else el.addEventListener('change', apply);
  });
  document.querySelectorAll('#btn-x-reset').forEach((b) => b.addEventListener('click', () => { window.mkPage = 0; const p = M.specToParams({}); p.x_note = ''; dash.setParams(p); }));
  const page = (d) => { window.mkPage = Math.max(0, window.mkPage + d); dash.draw('x-rows'); dash.draw('x-page'); };
  document.querySelectorAll('#btn-x-prev').forEach((b) => b.addEventListener('click', () => page(-1)));
  document.querySelectorAll('#btn-x-next').forEach((b) => b.addEventListener('click', () => page(1)));

  // Keep inputs in step with filters and data
  dash.onData(() => {
    const p = dash.params();
    document.querySelectorAll('[data-param]').forEach((inp) => {
      if (document.activeElement === inp) return;
      const v = p[inp.dataset.param]; inp.value = v ?? M.TARGET_DEFAULTS[inp.dataset.param];
    });
    const spec = M.paramsToSpec(p);
    document.querySelectorAll('[data-x]').forEach((el) => {
      if (el.hasAttribute('data-draw') || document.activeElement === el) return;
      el.value = spec[el.dataset.x] || (el.dataset.x === 'stage' ? 'all' : '');
    });
    if (dash.data('channel_actuals').status === 'ok') {
      const rows = dash.data('channel_actuals').data;
      document.querySelectorAll('input[type=range][data-ch]').forEach((inp) => {
        if (document.activeElement === inp) return;
        if (inp.dataset.ch === 'other') { const t = rows.find((x) => x.channel === 'Total'); if (t) inp.value = t.other_payroll_pct || 0; return; }
        const r = rows.find((x) => x.channel === inp.dataset.ch); if (r && r.payroll_pct != null) inp.value = r.payroll_pct;
      });
    }
  });
})();
