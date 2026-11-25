// Drawings: everything the data decides.
(() => {
  const M = window.mk;
  const D = (id) => dash.data(id);
  const ok = (id) => D(id).status === 'ok';
  const row0 = (id) => (ok(id) ? D(id).data[0] || {} : null);
  const dashOrFail = (el, id) => { el.textContent = D(id).status === 'error' ? 'Failed to load' : '—'; };
  const failRow = (tb, n, id) => { tb.replaceChildren(); if (D(id).status === 'error') { const td = tb.insertRow().insertCell(); td.colSpan = n; td.textContent = 'Failed to load.'; } };
  const chRow = (ch) => (ok('channel_actuals') ? D('channel_actuals').data.find((r) => r.channel === ch) : null);

  // ---------------- shared ----------------
  const monthsBetween = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; };
  const monthSelect = (name, key, from, to, def) => dash.draw(name, (sel) => {
    const ms = monthsBetween(from, to);
    sel.replaceChildren(...ms.map((m) => new Option(M.monthLabel(m), m)));
    sel.value = dash.params()[key] || def;
    sel.onchange = () => dash.setParams({ [key]: sel.value });
  });
  monthSelect('m-start', 'start', M.DEF.funnelStart, M.DEF.end, M.DEF.start);
  monthSelect('m-end', 'end', M.DEF.funnelStart, M.DEF.end, M.DEF.end);
  monthSelect('c-start', 'c_start', M.DEF.first, M.DEF.end, M.DEF.c_start);
  monthSelect('c-end', 'c_end', M.DEF.first, M.DEF.end, M.DEF.c_end);
  dash.draw('x-months', (sel) => {
    const key = 'x_' + sel.dataset.x;
    sel.replaceChildren(...monthsBetween(M.DEF.first, M.DEF.end).map((m) => new Option(M.monthLabel(m), m)));
    const spec = M.paramsToSpec(dash.params());
    sel.value = sel.dataset.x === 'start' ? spec.start : spec.end;
    sel.onchange = () => { window.mkPage = 0; dash.setParams({ [key]: sel.value, x_note: '', x_ids: '' }); };
  });

  const winText = (w) => `${M.monthLabel(w.start)} – ${M.monthLabel(w.end)}`;
  dash.draw('window-label', (el) => { el.textContent = winText(M.tab2Window()); });
  dash.draw('sum-window', (el) => { el.textContent = winText(M.tab2Window()); });
  dash.draw('sum-cwindow', (el) => { el.textContent = winText(M.churnWindow()); });
  dash.draw('c-window', (el) => { el.textContent = winText(M.churnWindow()); });

  // floating tooltip for thin-data flags
  dash.draw('thin-tip', {
    mount(el) {
      const root = el.closest('.mk') || document.body;
      const show = (t) => {
        el.textContent = t.dataset.thin; el.style.display = 'block';
        const rr = root.getBoundingClientRect(), tr = t.getBoundingClientRect();
        const w = el.offsetWidth;
        el.style.left = `${Math.max(0, Math.min(tr.left - rr.left, rr.width - w - 4))}px`;
        el.style.top = `${tr.bottom - rr.top + 6}px`;
      };
      const over = (ev) => { const t = ev.target.closest && ev.target.closest('[data-thin]'); if (t) show(t); };
      const out = (ev) => { const t = ev.target.closest && ev.target.closest('[data-thin]'); if (t) el.style.display = 'none'; };
      root.addEventListener('mouseover', over); root.addEventListener('mouseout', out);
      root.addEventListener('focusin', over); root.addEventListener('focusout', out);
      return { root, over, out };
    },
    update() {},
    unmount(el, m) { if (!m) return; m.root.removeEventListener('mouseover', m.over); m.root.removeEventListener('mouseout', m.out); m.root.removeEventListener('focusin', m.over); m.root.removeEventListener('focusout', m.out); },
  });

  // ---------------- DEMAND GEN ----------------
  const kpi = { 'k-dgcost': ['dg_cost', M.money, 'dg_cost'], 'k-won': ['won', M.num, 'won'], 'k-dgcac': ['dg_cac', M.money, 'cpwon'], 'k-dgcac2': ['dg_cac', M.money, 'cpwon'], 'k-fullcac': ['full_cac', M.money, 'won'], 'k-ratio': ['cac_ratio', (v) => M.dec(v), 'new_arr'], 'k-share': ['dg_share_pct', M.pct, 'dg_cost'], 'k-acv': ['acv', M.money, 'acv'] };
  for (const [name, [field, f, drillField]] of Object.entries(kpi)) {
    dash.draw(name, (el) => {
      const c = row0('cac_summary'); if (!c) return dashOrFail(el, 'cac_summary');
      el.removeAttribute('data-thin'); el.classList.remove('mk-thin');
      const tot = chRow('Total');
      M.fill(el, f(c[field]), { drill: M.cellSpec('tab2', drillField, tot || {}), thin: ['dg_cac', 'full_cac', 'acv'].includes(field) ? M.thin('cpwon', tot) : null });
    });
  }
  dash.draw('k-aerate', (el) => {
    if (!ok('cost_month')) return dashOrFail(el, 'cost_month');
    const r = D('cost_month').data.find((x) => x.month === M.DEF.end); el.textContent = r ? M.money2(r.ae_hourly_loaded) : 'n/a';
  });
  const gap = (el, a, t) => {
    if (a == null || !t) { el.textContent = '—'; el.className = ''; return; }
    const d = a / t - 1; el.textContent = `${d >= 0 ? '+' : ''}${d3.format('.0%')(d)} vs target`; el.className = d <= 0 ? 'mk-good' : 'mk-bad';
  };
  dash.draw('g-dgcac', (el) => { const c = row0('cac_summary'); gap(el, c && c.dg_cac, M.targets().dg); });
  dash.draw('g-fullcac', (el) => { const c = row0('cac_summary'); gap(el, c && c.full_cac, M.targets().cac); });
  dash.draw('lede-verdict', (el) => {
    const c = row0('cac_summary'); if (!c || c.dg_cac == null) { el.textContent = ''; return; }
    const x = c.dg_cac / M.targets().dg;
    el.textContent = x > 1 ? `That is ${d3.format('.1f')(x)}× the demand gen target.` : 'That is within the demand gen target.';
  });
  const tdraw = { 't-cac': (t) => M.money(t.cac), 't-dgcac': (t) => M.money(t.dg), 't-ratio': (t) => M.dec(t.cac_ratio), 't-share': (t) => M.pct(t.dg_share), 't-opps': (t) => M.dec(t.opps), 't-cpopp': (t) => M.money2(t.cpopp), 't-sals': (t) => M.dec(t.sals), 't-cpsal': (t) => M.money2(t.cpsal), 't-mqls': (t) => M.dec(t.mqls), 't-cpmql': (t) => M.money2(t.cpmql), 't-leads': (t) => M.dec(t.leads), 't-cpl': (t) => M.money2(t.cpl) };
  for (const [name, f] of Object.entries(tdraw)) dash.draw(name, (el) => { el.textContent = f(M.targets()); });

  dash.draw('funnel-rows', (tb) => {
    const d = D('funnel_total'); if (d.status !== 'ok') return failRow(tb, 6, 'funnel_total');
    const t = M.targets(); const tot = chRow('Total') || {};
    const tc = { Lead: ['cpl', 'lead_mql_pct'], MQL: ['cpmql', 'mql_sal_pct'], SAL: ['cpsal', 'sal_opp_pct'], Opp: ['cpopp', 'win_rate_pct'], Won: ['cpwon', null] };
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow(); tr.dataset.key = r.stage;
      const [ck, vk] = tc[r.stage];
      tr.insertCell().textContent = r.stage;
      M.fill(tr.insertCell(), M.num(r.count), { drill: M.cellSpec('stage', 'count', r) });
      M.fill(tr.insertCell(), M.money(r.cost_per), { cls: M.cls(r.cost_per, t[ck], true), drill: M.cellSpec('stage', 'cost_per', r), thin: M.thin(ck, tot) });
      M.fill(tr.insertCell(), M.money(t[ck]), { cls: 'mk-sub' });
      M.fill(tr.insertCell(), r.cvr_next_pct == null ? '' : M.pct(r.cvr_next_pct), r.cvr_next_pct == null ? {} : { cls: M.cls(r.cvr_next_pct, t[vk], false), drill: M.cellSpec('stage', 'cvr_next_pct', r), thin: M.thin(vk, tot) });
      M.fill(tr.insertCell(), vk ? M.pct(t[vk]) : '', { cls: 'mk-sub' });
    }
  });
  dash.draw('mql-outcome-rows', (tb) => {
    const d = D('mql_outcomes'); if (d.status !== 'ok') return failRow(tb, 3, 'mql_outcomes');
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow(); tr.dataset.key = r.outcome;
      tr.insertCell().textContent = r.outcome;
      M.fill(tr.insertCell(), M.num(r.count), { drill: M.cellSpec('mql_outcome', 'count', r) });
      tr.insertCell().textContent = M.pct(r.pct_of_mqls);
    }
  });

  const ORDER = ['organic_search', 'paid_search', 'paid_social', 'event', 'referral', 'direct', 'partner', 'email', 'outbound', 'Total'];
  const tableDraw = (name, cols) => dash.draw(name, (tb) => {
    const d = D('channel_actuals'); if (d.status !== 'ok') return failRow(tb, cols.length + 1, 'channel_actuals');
    const t = M.targets();
    tb.replaceChildren();
    for (const r of ORDER.map((k) => d.data.find((x) => x.channel === k)).filter(Boolean)) {
      const tr = tb.insertRow(); tr.dataset.key = r.channel; if (r.channel === 'Total') tr.className = 'mk-total';
      tr.insertCell().textContent = M.label(r.channel);
      for (const [f, fmt, lower] of cols) {
        M.fill(tr.insertCell(), fmt(r[f]), { cls: lower != null && t[f] != null ? M.cls(r[f], t[f], lower) : '', drill: M.cellSpec('tab2', f, r), thin: M.thin(f, r) });
      }
    }
  });
  tableDraw('cost-rows', [['program_spend', M.money], ['payroll_cost', M.money], ['sdr_cost', M.money], ['outbound_cost', M.money], ['dg_cost', M.money], ['cpl', M.money, true], ['cpmql', M.money, true], ['cpsal', M.money, true], ['cpopp', M.money, true], ['cpwon', M.money, true], ['acv', M.money]]);
  tableDraw('cvr-rows', [['leads', M.num], ['mqls', M.num], ['sals', M.num], ['opps', M.num], ['won', M.num], ['lead_mql_pct', M.pct, false], ['mql_sal_pct', M.pct, false], ['sal_opp_pct', M.pct, false], ['win_rate_pct', M.pct, false], ['new_arr', M.money]]);

  dash.draw('paypct', (el) => { const r = chRow(el.dataset.ch); if (!r) return dashOrFail(el, 'channel_actuals'); el.textContent = M.pct(r.payroll_pct); });
  dash.draw('paycost', (el) => { const r = chRow(el.dataset.ch); if (!r) return dashOrFail(el, 'channel_actuals'); M.fill(el, M.money(r.payroll_cost), { drill: M.cellSpec('tab2', 'payroll_cost', r) }); });
  dash.draw('payotherpct', (el) => { const r = chRow('Total'); if (!r) return dashOrFail(el, 'channel_actuals'); el.textContent = M.pct(r.other_payroll_pct); });
  dash.draw('payothercost', (el) => { const r = chRow('Total'); if (!r) return dashOrFail(el, 'channel_actuals'); el.textContent = M.money(r.other_payroll_cost); });
  // Allocated = channels + Other; the split is complete at 100%.
  dash.draw('paytotal', (el) => { const r = chRow('Total'); if (!r) return dashOrFail(el, 'channel_actuals'); const a = r.payroll_pct + (r.other_payroll_pct || 0); el.textContent = M.pct(a); el.className = Math.abs(a - 100) > 0.5 ? 'mk-bad' : ''; });
  dash.draw('pay-warn', (el) => {
    const r = chRow('Total'); if (!r) return dashOrFail(el, 'channel_actuals');
    const o = r.other_payroll_pct || 0, d = 100 - r.payroll_pct - o;
    const parts = `${d3.format('.1f')(r.payroll_pct)}% to demand gen channels${o ? `, ${d3.format('.1f')(o)}% to Other (left out of demand gen cost)` : ''}`;
    el.textContent = Math.abs(d) <= 0.5 ? `of marketing payroll: ${parts}.` : d > 0 ? `of marketing payroll (${parts}). ${d3.format('.1f')(d)}% is unallocated: it counts in the Total row's demand gen cost but in no channel.` : `of marketing payroll. Over by ${d3.format('.1f')(-d)}%: channels plus Other add up to more than 100%.`;
  });

  // horizontal bar chart with target line, thin flags and drill
  function barChart(el, rows, opts) {
    el.replaceChildren();
    const W = Math.max(el.clientWidth || 600, 260), rowH = 30, mt = 22, mb = 8;
    const svg = d3.select(el).append('svg').attr('width', W).attr('role', 'img').attr('aria-label', opts.aria);
    const probe = svg.append('g');
    const lw = d3.max(rows, (r) => { const tx = probe.append('text').text(r.label); const w = tx.node().getComputedTextLength(); tx.remove(); return w; }) || 90;
    probe.remove();
    const ml = lw + 14, mr = 96, H = mt + rows.length * rowH + mb; svg.attr('height', H);
    const max = Math.max(d3.max(rows, (r) => r.v) || 0, opts.target || 0) * 1.05 || 1;
    const x = d3.scaleLinear().domain([0, max]).range([ml, W - mr]);
    const g = svg.selectAll('g.row').data(rows).join('g').attr('class', 'row').attr('transform', (r, i) => `translate(0,${mt + i * rowH})`).style('cursor', 'pointer');
    g.append('text').attr('x', ml - 8).attr('y', rowH / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((r) => r.label);
    g.append('rect').attr('x', ml).attr('y', 5).attr('height', rowH - 10).attr('rx', 2).attr('width', (r) => (r.v == null ? 0 : Math.max(0, x(r.v) - ml)))
      .style('fill', (r) => (opts.target != null && r.v != null && r.v > opts.target ? 'var(--cds-chart-status-critical)' : dash.colors[0]))
      .style('opacity', (r) => (r.thin ? 0.45 : 1));
    g.append('text').attr('x', (r) => (r.v == null ? ml + 4 : x(r.v) + 6)).attr('y', rowH / 2).attr('dy', '0.35em').text((r) => (r.v == null ? 'n/a' : opts.fmt(r.v)) + (r.thin ? '  ! thin' : ''));
    if (opts.target != null) {
      svg.append('line').attr('x1', x(opts.target)).attr('x2', x(opts.target)).attr('y1', mt - 6).attr('y2', H - mb).style('stroke', 'var(--cds-chart-reference)').style('stroke-width', 1.5).style('stroke-dasharray', '4 3');
      svg.append('text').attr('x', x(opts.target)).attr('y', 12).attr('text-anchor', x(opts.target) > W - 140 ? 'end' : 'middle').text(`Target ${opts.fmt(opts.target)}`);
    }
    const tip = d3.select(el).append('div').attr('class', 'mk-tip').style('display', 'none');
    g.append('rect').attr('x', 0).attr('width', W).attr('height', rowH).style('fill', 'transparent')
      .attr('data-drill', (r) => M.drillAttr(r.drill))
      .on('mousemove', (ev, r) => {
        const [px, py] = d3.pointer(ev, el);
        tip.style('display', null).text(r.tip + (r.thin ? ' ' + r.thin : ''));
        const tw = tip.node().offsetWidth;
        tip.style('left', `${Math.min(px + 12, el.clientWidth - tw - 4)}px`).style('top', `${py + 12}px`);
      })
      .on('mouseleave', () => tip.style('display', 'none'));
  }
  dash.draw('chart', (el) => {
    const d = D('channel_actuals');
    if (d.status !== 'ok') { el.replaceChildren(); el.textContent = d.status === 'error' ? 'Failed to load.' : '—'; return; }
    const metric = window.mkMetric; const t = M.targets()[metric];
    const rows = d.data.filter((r) => r.channel !== 'Total').map((r) => ({ label: M.label(r.channel), v: r[metric], thin: M.thin(metric, r), drill: M.cellSpec('tab2', metric, r),
      tip: `${M.label(r.channel)}: ${M.money(r[metric])} · ${M.num(r.won)} won · demand gen ${M.money(r.dg_cost)}.` })).sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    const sel = document.querySelector('#metric-select');
    barChart(el, rows, { target: t, fmt: M.money, aria: `${sel && sel.selectedOptions[0] ? sel.selectedOptions[0].text : metric} by channel against target` });
  });

  // ---------------- CHURN ----------------
  const churnRow = (dim, key) => { const id = dim === 'plan' ? 'churn_by_plan' : 'churn_by_channel'; return ok(id) ? D(id).data.find((r) => r.key === key) : null; };
  dash.draw('ck', (el) => {
    const r = churnRow('plan', 'Total'); if (!r) return dashOrFail(el, 'churn_by_plan');
    el.removeAttribute('data-thin'); el.classList.remove('mk-thin');
    const f = el.dataset.f;
    M.fill(el, f === 'customers' ? M.num(r[f]) : M.pct(r[f]), { drill: M.cellSpec('churn', f, r), thin: M.thin(f, r) });
  });
  dash.draw('c-cust', (el) => { const r = churnRow('plan', 'Total'); if (!r) return dashOrFail(el, 'churn_by_plan'); M.fill(el, M.num(r.customers), { drill: M.cellSpec('churn', 'customers', r) }); });
  dash.draw('c-churn12', (el) => { const r = churnRow('plan', 'Total'); if (!r) return dashOrFail(el, 'churn_by_plan'); el.removeAttribute('data-thin'); el.classList.remove('mk-thin'); M.fill(el, M.pct(r.churn12_pct), { drill: M.cellSpec('churn', 'churn12_pct', r), thin: M.thin('churn12_pct', r) }); });
  dash.draw('churn-rows', (tb) => {
    const dim = tb.dataset.dim, id = dim === 'plan' ? 'churn_by_plan' : 'churn_by_channel';
    const d = D(id); if (d.status !== 'ok') return failRow(tb, 11, id);
    tb.replaceChildren();
    const cols = [['customers', M.num], ['churned', M.num], ['churned_pct', M.pct], ['elig12', M.num], ['churn12', M.num], ['churn12_pct', M.pct], ['elig24', M.num], ['churn24', M.num], ['churn24_pct', M.pct], ['arr_lost', M.money]];
    for (const r of d.data) {
      const tr = tb.insertRow(); tr.dataset.key = r.key; if (r.key === 'Total') tr.className = 'mk-total';
      tr.insertCell().textContent = dim === 'plan' ? r.key : M.label(r.key);
      for (const [f, fmt] of cols) M.fill(tr.insertCell(), fmt(r[f]), { drill: M.cellSpec('churn', f, r), thin: M.thin(f, r) });
    }
  });
  dash.draw('churn-chart', (el) => {
    const dim = el.dataset.dim, id = dim === 'plan' ? 'churn_by_plan' : 'churn_by_channel';
    const d = D(id); if (d.status !== 'ok') { el.replaceChildren(); el.textContent = d.status === 'error' ? 'Failed to load.' : '—'; return; }
    const tot = d.data.find((r) => r.key === 'Total');
    const rows = d.data.filter((r) => r.key !== 'Total').map((r) => ({ label: dim === 'plan' ? r.key : M.label(r.key), v: r.churn12_pct, thin: M.thin('churn12_pct', r), drill: M.cellSpec('churn', 'churn12_pct', r),
      tip: `${dim === 'plan' ? r.key : M.label(r.key)}: ${M.num(r.churn12)} of ${M.num(r.elig12)} measurable customers churned within 12 months.` })).sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    barChart(el, rows, { target: tot ? tot.churn12_pct : null, fmt: M.pct, aria: `12-month churn by ${dim === 'plan' ? 'plan' : 'source'}, against the cohort average` });
    const svgText = el.querySelectorAll('svg > text');
    const last = svgText[svgText.length - 1]; if (last && tot) last.textContent = `All ${M.pct(tot.churn12_pct)}`;
  });

  // ---------------- BENCHMARKS ----------------
  const fmtB = (v, u) => (v == null ? 'n/a' : u === '%' ? M.pct(v) : u === '$' ? '$' + M.dec(v) : u === 'x' ? M.dec(v) + 'x' : u === 'mo' ? M.dec(v, 1) : u === '$K' ? '$' + M.dec(v, 0) + 'K' : M.dec(v));
  dash.draw('bench-live-rows', (tb) => {
    const d = D('bench_live'); if (d.status !== 'ok') return failRow(tb, 6, 'bench_live');
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow(); tr.dataset.key = r.metric;
      tr.insertCell().textContent = r.metric;
      M.fill(tr.insertCell(), '$' + M.dec(r.value), { drill: M.cellSpec('tab2', 'new_arr', chRow('Total') || {}) });
      for (const f of ['p25', 'median', 'p75']) tr.insertCell().textContent = '$' + M.dec(r[f]);
      tr.insertCell().textContent = r.position || 'n/a';
    }
  });
  dash.draw('bench-rows', (tb) => {
    const d = D('benchmarks'); if (d.status !== 'ok') return failRow(tb, 10, 'benchmarks');
    const src = ok('bench_sources') ? D('bench_sources').data : [];
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow(); tr.dataset.key = r.metric;
      tr.insertCell().textContent = r.metric;
      const c = tr.insertCell(); c.textContent = r.cohort; c.className = 'mk-l mk-sub';
      for (const f of ['p25', 'median', 'p75', 'ledgerline']) tr.insertCell().textContent = fmtB(r[f], r.unit);
      const rc = tr.insertCell(); rc.style.minWidth = '140px';
      const lo = Math.min(r.p25, r.ledgerline) * 0.9, hi = Math.max(r.p75, r.ledgerline) * 1.1;
      const x = d3.scaleLinear().domain([lo, hi]).range([4, 136]);
      const svg = d3.select(rc).append('svg').attr('width', 140).attr('height', 18).attr('class', 'mk-range').attr('role', 'img').attr('aria-label', `${r.metric}: Ledgerline ${fmtB(r.ledgerline, r.unit)} against P25 ${fmtB(r.p25, r.unit)} to P75 ${fmtB(r.p75, r.unit)}`);
      svg.append('rect').attr('x', x(r.p25)).attr('y', 6).attr('width', Math.max(1, x(r.p75) - x(r.p25))).attr('height', 6).attr('rx', 3).style('fill', 'var(--cds-chart-muted)');
      svg.append('line').attr('x1', x(r.median)).attr('x2', x(r.median)).attr('y1', 3).attr('y2', 15).style('stroke', 'var(--cds-chart-reference)').style('stroke-width', 1.5);
      const good = r.lower_is_better == null ? null : r.lower_is_better ? r.ledgerline <= r.median : r.ledgerline >= r.median;
      svg.append('circle').attr('cx', x(r.ledgerline)).attr('cy', 9).attr('r', 4.5).style('fill', good == null ? dash.colors[0] : good ? 'var(--color-ok)' : 'var(--color-bad)');
      const rd = tr.insertCell(); rd.textContent = r.read; rd.className = 'mk-l'; rd.style.whiteSpace = 'normal'; rd.style.minWidth = '220px';
      const cf = tr.insertCell(); cf.textContent = r.confidence; cf.className = 'mk-l mk-sub';
      const sc = tr.insertCell(); sc.className = 'mk-l';
      const s = src.find((x) => x.source_key === r.source_key);
      if (s && /^https?:\/\//.test(s.url)) { const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = s.name.split(':')[0]; sc.append(a); } else sc.textContent = r.source_key;
    }
  });
  dash.draw('source-rows', (tb) => {
    const d = D('bench_sources'); if (d.status !== 'ok') return failRow(tb, 5, 'bench_sources');
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow(); tr.dataset.key = r.source_key;
      const n = tr.insertCell(); n.textContent = r.name; n.style.whiteSpace = 'normal';
      for (const f of ['period', 'type', 'used_for']) { const c = tr.insertCell(); c.textContent = r[f]; c.className = 'mk-l'; c.style.whiteSpace = 'normal'; }
      const lc = tr.insertCell(); lc.className = 'mk-l';
      if (/^https?:\/\//.test(r.url)) { const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); lc.append(a); } else lc.textContent = r.url;
    }
  });

  // ---------------- EXPLORER ----------------
  dash.draw('x-datebasis', (el) => { el.textContent = M.DATE_LABEL[M.paramsToSpec(dash.params()).stage]; });
  dash.draw('drill-note', (el) => { const n = dash.params().x_note; el.textContent = n || ''; el.style.display = n ? '' : 'none'; });
  dash.draw('xs', (el) => { const s = row0('explorer_summary'); if (!s) return dashOrFail(el, 'explorer_summary'); el.textContent = M.num(s[el.dataset.f]); });
  const PAGE = 50;
  const yn = (v) => (v === true || v === 'true' ? 'Yes' : v === false || v === 'false' ? 'No' : '');
  const XCOLS = ['row_id', 'record_type', 'lead_created', 'channel', 'source_form', 'lead_status', 'disqualified_reason', 'company', 'is_mql', 'is_sal', 'opportunity_id', 'opp_created', 'opp_stage', 'opp_close', 'opp_arr', 'customer_id', 'plan', 'signup_date', 'customer_status', 'churn_date', 'churned_12m'];
  const LEFT = new Set(['record_type', 'channel', 'source_form', 'lead_status', 'disqualified_reason', 'company', 'opportunity_id', 'opp_stage', 'customer_id', 'plan', 'customer_status']);
  dash.draw('x-rows', (tb) => {
    const d = D('explorer_rows'); if (d.status !== 'ok') return failRow(tb, XCOLS.length, 'explorer_rows');
    const pages = Math.max(1, Math.ceil(d.data.length / PAGE));
    if (window.mkPage >= pages) window.mkPage = pages - 1;
    const slice = d.data.slice(window.mkPage * PAGE, window.mkPage * PAGE + PAGE);
    tb.replaceChildren();
    if (!slice.length) { const td = tb.insertRow().insertCell(); td.colSpan = XCOLS.length; td.textContent = 'No records match these filters.'; td.className = 'mk-l'; return; }
    for (const r of slice) {
      const tr = tb.insertRow(); tr.dataset.key = r.row_id;
      for (const f of XCOLS) {
        const td = tr.insertCell(); const v = r[f];
        td.textContent = /^is_|churned_12m/.test(f) ? yn(v) : f === 'opp_arr' ? (v == null ? '' : M.money(v)) : f === 'channel' ? M.label(v) : f === 'record_type' ? (v === 'lead' ? 'Lead' : 'Customer, no lead') : v == null ? '' : String(v);
        if (LEFT.has(f)) td.className = 'mk-l';
      }
    }
  });
  dash.draw('x-page', (el) => {
    const d = D('explorer_rows'); if (d.status !== 'ok') { el.textContent = '—'; return; }
    const n = d.data.length, pages = Math.max(1, Math.ceil(n / PAGE)), p = Math.min(window.mkPage, pages - 1);
    el.textContent = n ? `Rows ${M.num(p * PAGE + 1)}–${M.num(Math.min(n, (p + 1) * PAGE))} of ${M.num(n)} · page ${p + 1} of ${pages}` : 'No rows';
  });
  dash.draw('check-summary', (el) => {
    const d = D('drill_check'); if (d.status !== 'ok') return dashOrFail(el, 'drill_check');
    const bad = d.data.filter((r) => !r.ok).length;
    el.textContent = bad === 0 ? `All ${d.data.length} clickable counts on the Demand gen and Churn tabs reconcile: the filter each click applies returns exactly the rows (and ARR) behind the number, for the current date windows.` : `${bad} of ${d.data.length} clickable counts do not reconcile with the rows their click returns.`;
    el.className = bad === 0 ? 'mk-good' : 'mk-bad';
  });
  dash.draw('check-fails', (ul) => {
    const d = D('drill_check'); ul.replaceChildren(); if (d.status !== 'ok') return;
    for (const r of d.data.filter((x) => !x.ok).slice(0, 20)) { const li = document.createElement('li'); li.textContent = `${r.metric}: metric ${r.expected}, rows ${r.got}`; ul.append(li); }
  });

  // ---------------- SUMMARY ----------------
  const li = (ul, parts) => { const el = document.createElement('li'); M.sentence(el, parts); ul.append(el); return el; };
  const where = (k) => `channel=${k}`;
  dash.draw('sum-findings', (ul) => {
    const need = ['cac_summary', 'funnel_total', 'channel_actuals', 'mql_outcomes', 'churn_by_channel', 'churn_by_plan', 'bench_live', 'data_health'];
    ul.replaceChildren();
    if (need.some((id) => !ok(id))) { const st = need.map((id) => D(id).status); const e = document.createElement('li'); e.textContent = st.includes('error') ? 'Some data failed to load.' : '—'; ul.append(e); return; }
    const t = M.targets(), c = D('cac_summary').data[0], tot = chRow('Total'), ca = D('channel_actuals').data;
    // CAC
    li(ul, [{ text: 'Demand gen & CAC: ', strong: true }, 'demand gen cost per new customer is ', { text: M.money(c.dg_cac), source: 'cac_summary', field: 'dg_cac', row: 0, drill: M.cellSpec('tab2', 'cpwon', tot), thin: M.thin('cpwon', tot) },
      ` against a ${M.money(t.dg)} target; full CAC is `, { text: M.money(c.full_cac), source: 'cac_summary', field: 'full_cac', row: 0, drill: M.cellSpec('tab2', 'won', tot) },
      ` against ${M.money(t.cac)}, a CAC ratio of `, { text: M.dec(c.cac_ratio), source: 'cac_summary', field: 'cac_ratio', row: 0, drill: M.cellSpec('tab2', 'new_arr', tot) }, ` vs ${M.dec(t.cac_ratio)}.`]);
    // funnel bottleneck
    const stages = [['Lead→MQL', 'lead_mql_pct'], ['MQL→SAL', 'mql_sal_pct'], ['SAL→Opp', 'sal_opp_pct'], ['Opp→Won', 'win_rate_pct']].map(([n, f]) => ({ n, f, a: tot[f], t: t[f], r: tot[f] / t[f] }));
    const worst = stages.slice().sort((a, b) => a.r - b.r)[0];
    const others = stages.filter((s) => s !== worst);
    li(ul, [{ text: 'Funnel: ', strong: true }, `${worst.n} is the weakest stage at `, { text: M.pct(worst.a), source: 'channel_actuals', field: worst.f, where: where('Total'), drill: M.cellSpec('tab2', worst.f, tot) }, ` against ${M.pct(worst.t)}. `,
      ...others.flatMap((s, i) => [`${s.n} `, { text: M.pct(s.a), source: 'channel_actuals', field: s.f, where: where('Total'), drill: M.cellSpec('tab2', s.f, tot) }, ` (target ${M.pct(s.t)})${i < others.length - 1 ? ', ' : '.'}`])]);
    // MQL outcomes
    const mo = D('mql_outcomes').data; const by = (st) => mo.filter((r) => r.status === st).reduce((a, r) => a + r.count, 0);
    const nurture = mo.find((r) => r.status === 'Nurture' && !r.reason), unresp = mo.find((r) => r.status === 'Unresponsive' && !r.reason);
    const topDq = mo.filter((r) => r.status === 'Disqualified').sort((a, b) => b.count - a.count)[0];
    li(ul, [{ text: 'Where MQLs go: ', strong: true }, 'of ', { text: M.num(tot.mqls), source: 'channel_actuals', field: 'mqls', where: where('Total'), drill: M.cellSpec('tab2', 'mqls', tot) }, ' MQLs, ',
      nurture ? { text: M.num(nurture.count), source: 'mql_outcomes', field: 'count', where: 'outcome=Nurture', drill: M.cellSpec('mql_outcome', 'count', nurture) } : '0', ' went to Nurture, ',
      unresp ? { text: M.num(unresp.count), source: 'mql_outcomes', field: 'count', where: 'outcome=Unresponsive', drill: M.cellSpec('mql_outcome', 'count', unresp) } : '0', ` were unresponsive and ${M.num(by('Disqualified'))} were disqualified`,
      topDq ? `, most often as "${topDq.reason || 'no reason given'}" (` : '.', topDq ? { text: M.num(topDq.count), source: 'mql_outcomes', field: 'count', where: `outcome=${topDq.outcome}`, drill: M.cellSpec('mql_outcome', 'count', topDq) } : null, topDq ? ').' : null]);
    // channels
    const solid = ca.filter((r) => r.channel !== 'Total' && (r.sals || 0) >= M.THIN.stageCount && r.cpsal != null).sort((a, b) => a.cpsal - b.cpsal);
    const thinCh = ca.filter((r) => r.channel !== 'Total' && (r.won || 0) < M.THIN.won).map((r) => M.label(r.channel));
    if (solid.length >= 2) {
      const lo = solid[0], hi = solid[solid.length - 1];
      li(ul, [{ text: 'Channels: ', strong: true }, `cost per SAL runs from `, { text: M.money(lo.cpsal), source: 'channel_actuals', field: 'cpsal', where: where(lo.channel), drill: M.cellSpec('tab2', 'cpsal', lo) }, ` (${M.label(lo.channel)}) to `,
        { text: M.money(hi.cpsal), source: 'channel_actuals', field: 'cpsal', where: where(hi.channel), drill: M.cellSpec('tab2', 'cpsal', hi) }, ` (${M.label(hi.channel)}), against a ${M.money(t.cpsal)} target.`,
        thinCh.length ? ` Under ${M.THIN.won} wins this window, so cost per customer is thin data: ${thinCh.join(', ')}.` : '']);
    }
    // churn
    const cp = D('churn_by_plan').data, cc = D('churn_by_channel').data, cw = M.churnWindow();
    const ct = cp.find((r) => r.key === 'Total');
    const plans = cp.filter((r) => r.key !== 'Total' && r.elig12 >= M.THIN.cohort).sort((a, b) => b.churn12_pct - a.churn12_pct);
    const parts = [{ text: 'Churn: ', strong: true }, `of customers signed ${winText(cw)}, `, { text: M.pct(ct.churn12_pct), source: 'churn_by_plan', field: 'churn12_pct', where: 'key=Total', drill: M.cellSpec('churn', 'churn12_pct', ct), thin: M.thin('churn12_pct', ct) }, ' churned within 12 months'];
    if (plans.length >= 2) parts.push('. By plan, ', ...plans.flatMap((r, i) => [`${r.key} `, { text: M.pct(r.churn12_pct), source: 'churn_by_plan', field: 'churn12_pct', where: `key=${r.key}`, drill: M.cellSpec('churn', 'churn12_pct', r) }, i < plans.length - 1 ? ', ' : '']));
    const srcSolid = cc.filter((r) => r.key !== 'Total' && r.key !== 'unknown_pre2023' && r.elig12 >= M.THIN.cohort);
    const srcThin = cc.filter((r) => r.key !== 'Total' && r.key !== 'unknown_pre2023' && r.elig12 < M.THIN.cohort).map((r) => M.label(r.key));
    if (srcSolid.length) parts.push('. Sources with enough customers to read: ', ...srcSolid.flatMap((r, i) => [`${M.label(r.key)} `, { text: M.pct(r.churn12_pct), source: 'churn_by_channel', field: 'churn12_pct', where: `key=${r.key}`, drill: M.cellSpec('churn', 'churn12_pct', r) }, i < srcSolid.length - 1 ? ', ' : '']));
    if (srcThin.length) parts.push(`. Too few to read yet: ${srcThin.join(', ')}`);
    parts.push('.');
    li(ul, parts);
    // benchmark
    const bl = D('bench_live').data[0];
    li(ul, [{ text: 'Benchmarks: ', strong: true }, 'this window’s CAC ratio of ', { text: '$' + M.dec(bl.value), source: 'bench_live', field: 'value', row: 0 }, ` sits ${(bl.position || 'n/a').replace(/^./, (ch) => ch.toLowerCase())} for new-name CAC at $10–25K ACV (median $${M.dec(bl.median)}, P75 $${M.dec(bl.p75)}). Retention is the strength: gross revenue retention is above P75 on the Benchmarks tab.`]);
    // data health
    const h = D('data_health').data[0];
    li(ul, [{ text: 'Data health: ', strong: true }, { text: M.num(h.working_with_reason), source: 'data_health', field: 'working_with_reason', row: 0, drill: { stage: 'lead', status: 'Working', reason: '__any__' } }, ' Working leads carry a disqualification reason and ',
      { text: M.num(h.disqualified_no_reason), source: 'data_health', field: 'disqualified_no_reason', row: 0, drill: { stage: 'lead', status: 'Disqualified', reason: '__none__' } }, ' disqualified leads have none, across all dates. Every underlined number opens its rows in the Data explorer.']);
  });

  dash.draw('sum-recs', (ol) => {
    const need = ['cac_summary', 'funnel_total', 'channel_actuals', 'mql_outcomes', 'churn_by_plan', 'data_health'];
    ol.replaceChildren();
    if (need.some((id) => !ok(id))) { const e = document.createElement('li'); e.textContent = need.some((id) => D(id).status === 'error') ? 'Some data failed to load.' : '—'; ol.append(e); return; }
    const t = M.targets(), tot = chRow('Total'), ca = D('channel_actuals').data.filter((r) => r.channel !== 'Total');
    const mo = D('mql_outcomes').data, nurture = mo.find((r) => r.status === 'Nurture' && !r.reason);
    let n = 0;
    if (tot.mql_sal_pct != null && tot.mql_sal_pct < 0.75 * t.mql_sal) {
      n++; li(ol, [{ text: 'Fix MQL→SAL before adding budget. ', strong: true }, 'Only ', { text: M.pct(tot.mql_sal_pct), source: 'channel_actuals', field: 'mql_sal_pct', where: where('Total'), drill: M.cellSpec('tab2', 'mql_sal_pct', tot) }, ` of MQLs become SALs against ${M.pct(t.mql_sal)}; every later stage is at or near target. `,
        nurture ? 'Nurture alone takes ' : '', nurture ? { text: M.pct(nurture.pct_of_mqls), source: 'mql_outcomes', field: 'pct_of_mqls', where: 'outcome=Nurture', drill: M.cellSpec('mql_outcome', 'count', nurture) } : null, nurture ? ' of MQLs. ' : '',
        'Review the ICP rules that route leads to Nurture and the follow-up on Unresponsive leads; a few points here lowers cost per SAL in every channel at once.']);
    }
    const solid = ca.filter((r) => (r.sals || 0) >= M.THIN.stageCount && r.cpsal != null);
    const hiSal = solid.filter((r) => r.cpsal >= 1.5 * tot.cpsal);
    const cut = hiSal.filter((r) => (r.won || 0) < M.THIN.won || (tot.cpwon && r.cpwon >= 1.25 * tot.cpwon)).sort((a, b) => b.cpsal - a.cpsal);
    const review = hiSal.filter((r) => !cut.includes(r));
    const chSpan = (r, f) => ({ text: M.money(r[f]), source: 'channel_actuals', field: f, where: where(r.channel), drill: M.cellSpec('tab2', f, r), thin: M.thin(f, r) });
    if (cut.length) {
      n++; li(ol, [{ text: 'Cut or restructure: expensive per SAL and not closing. ', strong: true }, ...cut.flatMap((r, i) => [`${M.label(r.channel)} costs `, chSpan(r, 'cpsal'), ` per SAL (${d3.format('.1f')(r.cpsal / tot.cpsal)}× the blended `, { text: M.money(tot.cpsal), source: 'channel_actuals', field: 'cpsal', where: where('Total') }, ') and won ', { text: M.num(r.won), source: 'channel_actuals', field: 'won', where: where(r.channel), drill: M.cellSpec('tab2', 'won', r) }, i < cut.length - 1 ? '; ' : '. ']),
        'This spend is the first place to look for budget, once the payroll split is agreed.']);
    }
    if (review.length) {
      n++; li(ol, [{ text: 'Review before cutting: expensive per SAL but closing. ', strong: true }, ...review.flatMap((r, i) => [`${M.label(r.channel)} costs `, chSpan(r, 'cpsal'), ' per SAL but ', chSpan(r, 'cpwon'), ' per customer', i < review.length - 1 ? '; ' : '. ']),
        'Tighten targeting to lift its MQL→SAL rate rather than cutting volume outright.']);
    }
    const scale = solid.filter((r) => (r.cpsal <= t.cpsal || r.cpsal <= 0.75 * tot.cpsal) && r.sal_opp_pct != null && r.sal_opp_pct >= 0.75 * t.sal_opp).sort((a, b) => a.cpsal - b.cpsal);
    if (scale.length) {
      n++; li(ol, [{ text: 'Test more volume where SALs come in cheapest. ', strong: true }, ...scale.flatMap((r, i) => [`${M.label(r.channel)} at `, { text: M.money(r.cpsal), source: 'channel_actuals', field: 'cpsal', where: where(r.channel), drill: M.cellSpec('tab2', 'cpsal', r) }, ' per SAL',
        (r.won || 0) < M.THIN.won ? ' (only ' : '', (r.won || 0) < M.THIN.won ? { text: M.num(r.won), source: 'channel_actuals', field: 'won', where: where(r.channel), drill: M.cellSpec('tab2', 'won', r), thin: M.thin('cpwon', r) } : null, (r.won || 0) < M.THIN.won ? ' won so far, so confirm it closes before scaling)' : '', i < scale.length - 1 ? '; ' : '. ']),
        'These costs depend on the payroll split; outbound carries only AE prospecting time.']);
    } else if (solid.length) {
      n++; li(ol, [{ text: 'No channel beats the cost-per-SAL target yet. ', strong: true }, 'Conversion, not channel mix, is the first lever.']);
    }
    const cp = D('churn_by_plan').data, ct = cp.find((r) => r.key === 'Total');
    const hiPlan = cp.filter((r) => r.key !== 'Total' && r.elig12 >= M.THIN.cohort && ct.churn12_pct > 0 && r.churn12_pct >= 1.5 * ct.churn12_pct);
    for (const r of hiPlan) {
      n++; li(ol, [{ text: `Look at first-year fit for ${r.key} deals. `, strong: true }, `${r.key} customers churn within 12 months at `, { text: M.pct(r.churn12_pct), source: 'churn_by_plan', field: 'churn12_pct', where: `key=${r.key}`, drill: M.cellSpec('churn', 'churn12_pct', r) }, ' against ', { text: M.pct(ct.churn12_pct), source: 'churn_by_plan', field: 'churn12_pct', where: 'key=Total', drill: M.cellSpec('churn', 'churn12_pct', ct) },
        ' overall. A cheap acquisition that churns at renewal is not cheap; weigh this before scaling channels whose wins skew to this plan.']);
    }
    const thinCh = ca.filter((r) => (r.won || 0) < M.THIN.won && !cut.includes(r));
    if (thinCh.length) {
      n++; li(ol, [{ text: 'Don’t reallocate on cost per customer for thin channels yet. ', strong: true }, ...thinCh.flatMap((r, i) => [`${M.label(r.channel)} (`, { text: M.num(r.won), source: 'channel_actuals', field: 'won', where: where(r.channel), drill: M.cellSpec('tab2', 'won', r) }, ' won)', i < thinCh.length - 1 ? ', ' : '. ']), 'Judge these on cost per SAL and SAL→Opp until more deals close, or widen the date window.']);
    }
    const p = dash.params(); const unset = M.CHANNELS.slice(0, 8).every((c) => p['pay_' + c] == null || p['pay_' + c] === '');
    if (unset) {
      n++; li(ol, [{ text: 'Agree the marketing payroll split. ', strong: true }, 'Marketing payroll (', { text: M.money(tot.payroll_cost), source: 'channel_actuals', field: 'payroll_cost', where: where('Total'), drill: M.cellSpec('tab2', 'payroll_cost', tot) }, ') is a large part of demand gen cost (', { text: M.money(tot.dg_cost), source: 'channel_actuals', field: 'dg_cost', where: where('Total'), drill: M.cellSpec('tab2', 'dg_cost', tot) }, ') and is spread by lead share for now, which flatters high-volume, low-spend channels like direct.']);
    }
    const h = D('data_health').data[0];
    if (h.working_with_reason > 0) {
      n++; li(ol, [{ text: 'Clean up lead status tagging. ', strong: true }, { text: M.num(h.working_with_reason), source: 'data_health', field: 'working_with_reason', row: 0, drill: { stage: 'lead', status: 'Working', reason: '__any__' } }, ' leads are marked Working with a disqualification reason. They are excluded from SALs here, but the CRM reports count them.']);
    }
    if (!n) { const e = document.createElement('li'); e.textContent = 'No recommendation clears the data thresholds for this window.'; ol.append(e); }
  });
})();
