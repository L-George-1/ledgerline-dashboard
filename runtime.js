// The dashboard runtime: datasets, cached calcs, draws and params. Promoted from harness/fake_dash.js,
// which stood in for the artifact host. Datasets arrive in memory from ingest (no fetch, no eval), so the
// page works when opened from disk. A filter change clears cached calcs and redraws; datasets are never rebuilt.
(function () {
  const datasets = {};
  const calcs = {};
  const draws = {};
  const onDataFns = [];
  let params = {};
  let defaults = {};
  let memo = {};
  const mounted = new Map();
  window.__errors = [];
  function data(id) {
    if (datasets[id]) return { status: 'ok', data: datasets[id], columns: Object.keys(datasets[id][0] || {}) };
    const c = calcs[id];
    if (!c) return { status: 'missing', data: [] };
    if (!memo[id]) {
      const ins = c.inputs.map((i) => data(i));
      if (ins.some((x) => x.status !== 'ok')) return { status: 'loading', data: null };
      try { memo[id] = { status: 'ok', data: c.fn(...ins.map((x) => x.data)) }; } catch (e) { window.__errors.push(id + ': ' + e.message); console.error(id, e); memo[id] = { status: 'error', data: null, message: e.message }; }
    }
    return memo[id];
  }
  function runDraw(name) {
    const d = draws[name];
    document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => {
      if (el.closest('[hidden]')) return;
      try {
        if (typeof d === 'function') d(el);
        else {
          if (!mounted.has(el)) { el.replaceChildren(); mounted.set(el, d.mount ? d.mount(el) : undefined); }
          if (d.update) d.update(el, mounted.get(el));
        }
      } catch (e) { window.__errors.push(name + ': ' + e.stack); console.error(name, e); }
    });
  }
  let booted = false;
  function render() {
    if (!booted) return;
    memo = {};
    for (const f of onDataFns) { try { f(); } catch (e) { window.__errors.push('onData: ' + e.message); } }
    for (const n of Object.keys(draws)) runDraw(n);
  }
  window.dash = {
    data, params: () => Object.assign({}, params),
    setParams(o) { params = Object.assign({}, params, o); render(); },
    resetParams() { params = Object.assign({}, defaults); render(); },
    calc(id, def) { calcs[id] = def; },
    draw(name, fn) { if (fn === undefined) { runDraw(name); return; } draws[name] = fn; },
    onData(fn) { onDataFns.push(fn); },
    setLink(id) { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); },
    loader() {}, refresh() { render(); },
    colors: ['#304659', '#F54D46', '#7FA38C'],
    // Load datasets and default params. Call before the page scripts that register calcs and draws.
    load(ds, defs) { Object.assign(datasets, ds); defaults = Object.assign({}, defs); params = Object.assign({}, defs); },
    // Start drawing once calcs and draws are registered; redraw when a panel is shown or hidden.
    start(root) {
      booted = true;
      new MutationObserver(() => render()).observe(root, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
      render();
      window.__ready = true;
    },
  };
})();
