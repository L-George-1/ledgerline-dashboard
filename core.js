// Shared helpers: labels, formats, targets, thin-data rules, and the drill-through spec.
// The same spec functions build every clickable cell's filter and the data explorer's filter,
// so a clicked number and the explorer rows come from one definition.
window.mk = (() => {
  const CHANNELS = ['organic_search', 'paid_search', 'paid_social', 'event', 'referral', 'direct', 'partner', 'email', 'outbound'];
  const LABELS = { organic_search: 'Organic search', paid_search: 'Paid search', paid_social: 'Paid social', event: 'Event', referral: 'Referral', direct: 'Direct', partner: 'Partner', email: 'Email', outbound: 'Outbound', unknown_pre2023: 'Unknown (signed pre-2023)', Total: 'Total' };
  const STAGE_LABEL = { all: 'All records', lead: 'Leads', mql: 'MQLs', sal: 'SALs', opp: 'Opps', won: 'Closed won', customer: 'Customers' };
  const TARGET_DEFAULTS = { acv: 15000, cac_ratio: 1.6, dg_share: 60, close_rate: 25, sal_opp: 33, mql_sal: 40, lead_mql: 50 };
  // Month bounds come from the data: configure() sets them from the As-of month and the data's first month.
  // FUNNEL_START and COHORT_START are definitions (decision record section 4), not data bounds.
  const FUNNEL_START = '2023-01';
  const COHORT_START = '2023-01';
  const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const DEF = {};
  function configure({ asOf, first }) {
    const end = asOf, from = first && first < end ? first : end;
    const start = addMonths(end, -11);
    Object.assign(DEF, { asOf: end, first: from, funnelStart: FUNNEL_START < from ? from : FUNNEL_START,
      start: start < from ? from : start, end, c_start: COHORT_START < from ? from : COHORT_START, c_end: end, x_start: from, x_end: end });
    return DEF;
  }
  configure({ asOf: '2026-10', first: '2019-01' });
  // Thin-data thresholds: below these, a figure is shown with a warning, never hidden.
  const THIN = { stageCount: 10, won: 5, rateDenom: 30, cohort: 20 };

  const money = (v) => (v == null || !isFinite(v) ? 'n/a' : (v < 0 ? '-$' : '$') + d3.format(',.0f')(Math.abs(v)));
  const money2 = (v) => (v == null || !isFinite(v) ? 'n/a' : '$' + d3.format(',.2f')(v));
  const pct = (v) => (v == null || !isFinite(v) ? 'n/a' : d3.format('.1f')(v) + '%');
  const num = (v) => (v == null ? 'n/a' : d3.format(',')(v));
  const dec = (v, n = 2) => (v == null || !isFinite(v) ? 'n/a' : d3.format(`,.${n}f`)(v));
  const monthLabel = (m) => { if (!m) return ''; const [y, mo] = m.split('-').map(Number); return d3.utcFormat('%b %Y')(new Date(Date.UTC(y, mo - 1, 1))); };
  const label = (k) => LABELS[k] || k;

  function win(a, b, da, db) { let s = a || da, e = b || db; if (s > e) [s, e] = [e, s]; return { start: s, end: e }; }
  const tab2Window = () => { const p = dash.params(); return win(p.start, p.end, DEF.start, DEF.end); };
  const churnWindow = () => { const p = dash.params(); return win(p.c_start, p.c_end, DEF.c_start, DEF.c_end); };

  // Share of marketing payroll marked Other (not demand gen), from the pay_other param. 0 when unset.
  function payOtherPct(p) { const v = p.pay_other; return v != null && v !== '' && isFinite(+v) ? Math.min(100, Math.max(0, +v)) : 0; }

  function targets() {
    const p = Object.assign({}, TARGET_DEFAULTS); const q = dash.params();
    for (const k of Object.keys(TARGET_DEFAULTS)) if (q[k] != null && q[k] !== '' && isFinite(+q[k]) && +q[k] > 0) p[k] = +q[k];
    const cac = p.acv * p.cac_ratio, dg = (cac * p.dg_share) / 100;
    const opps = 1 / (p.close_rate / 100), sals = opps / (p.sal_opp / 100), mqls = sals / (p.mql_sal / 100), leads = mqls / (p.lead_mql / 100);
    return { ...p, cac, dg, opps, sals, mqls, leads, cpwon: dg, cpopp: dg / opps, cpsal: dg / sals, cpmql: dg / mqls, cpl: dg / leads,
      lead_mql_pct: p.lead_mql, mql_sal_pct: p.mql_sal, sal_opp_pct: p.sal_opp, win_rate_pct: p.close_rate };
  }
  const cls = (a, t, lowerBetter) => (a == null || t == null || !isFinite(a) ? '' : lowerBetter ? (a <= t ? 'mk-good' : 'mk-bad') : a >= t ? 'mk-good' : 'mk-bad');

  // ---------- drill-through spec ----------
  // spec: {stage, channel, start, end, status, reason, plan, churn, q, note}
  const DATE_FIELD = { all: null, lead: 'lead_created', mql: 'lead_created', sal: 'lead_created', opp: 'opp_created', won: 'opp_close', customer: 'signup_date' };
  const DATE_LABEL = { all: 'lead created date (signup date for customers with no lead)', lead: 'lead created date', mql: 'lead created date', sal: 'lead created date', opp: 'opp created date', won: 'close date', customer: 'customer signup date' };
  const yes = (v) => v === true || v === 'true';
  function stageOk(r, stage) {
    const lead = r.record_type === 'lead';
    switch (stage) {
      case 'lead': return lead;
      case 'mql': return lead && yes(r.is_mql);
      case 'sal': return lead && yes(r.is_sal);
      case 'opp': return lead && !!r.opportunity_id;
      case 'won': return lead && yes(r.opp_won);
      case 'customer': return !!r.customer_id;
      default: return true;
    }
  }
  function churnOk(r, c) {
    switch (c) {
      case 'active': return r.customer_status === 'active';
      case 'churned': return r.customer_status === 'churned';
      case 'elig12': return yes(r.eligible_12m);
      case 'churn12': return yes(r.eligible_12m) && yes(r.churned_12m);
      case 'elig24': return yes(r.eligible_24m);
      case 'churn24': return yes(r.eligible_24m) && yes(r.churned_24m);
      default: return true;
    }
  }
  let idCache = { key: null, set: null };
  const idSet = (str) => { if (idCache.key !== str) idCache = { key: str, set: new Set(String(str).split(',')) }; return idCache.set; };
  function match(r, s) {
    const stage = s.stage || 'all';
    if (!stageOk(r, stage)) return false;
    if (s.start || s.end) {
      const f = DATE_FIELD[stage];
      const v = f ? r[f] : r.lead_created || r.signup_date;
      if (!v) return false;
      const m = String(v).slice(0, 7);
      if (s.start && m < s.start) return false;
      if (s.end && m > s.end) return false;
    }
    if (s.channel && r.channel !== s.channel) return false;
    if (s.status && r.lead_status !== s.status) return false;
    if (s.reason) {
      if (s.reason === '__none__') { if (r.disqualified_reason) return false; }
      else if (s.reason === '__any__') { if (!r.disqualified_reason) return false; }
      else if (r.disqualified_reason !== s.reason) return false;
    }
    if (s.ids && !idSet(s.ids).has(r.row_id)) return false;
    if (s.plan && r.plan !== s.plan) return false;
    if (s.churn && !churnOk(r, s.churn)) return false;
    if (s.q) {
      const q = s.q.toLowerCase();
      const hay = [r.row_id, r.company, r.opportunity_id, r.customer_id].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  // ids: a comma-separated list of row_ids (set by Data hygiene drill-throughs); cleared when any other filter changes.
  const PKEYS = ['stage', 'channel', 'start', 'end', 'status', 'reason', 'plan', 'churn', 'q', 'ids'];
  function specToParams(s) {
    const o = {};
    for (const k of PKEYS) o['x_' + k] = s[k] || '';
    if (!o.x_stage) o.x_stage = 'all';
    if (!o.x_start) o.x_start = DEF.x_start;
    if (!o.x_end) o.x_end = DEF.x_end;
    return o;
  }
  function paramsToSpec(p) {
    const s = {};
    for (const k of PKEYS) { const v = p['x_' + k]; if (v != null && v !== '') s[k] = String(v); }
    if (!s.stage) s.stage = 'all';
    const w = win(s.start, s.end, DEF.x_start, DEF.x_end); s.start = w.start; s.end = w.end;
    return s;
  }
  // Which explorer rows sit under a metric cell. table: 'tab2' | 'churn' ; row: the calc row
  const FIELD_STAGE = { leads: 'lead', mqls: 'mql', sals: 'sal', opps: 'opp', won: 'won', cpl: 'lead', cpmql: 'mql', cpsal: 'sal', cpopp: 'opp', cpwon: 'won', new_arr: 'won', acv: 'won',
    lead_mql_pct: 'lead', mql_sal_pct: 'mql', sal_opp_pct: 'sal', win_rate_pct: 'opp', program_spend: 'lead', payroll_cost: 'lead', payroll_pct: 'lead', sdr_cost: 'lead', outbound_cost: 'lead', dg_cost: 'lead', sessions: 'lead' };
  const COST_NOTE = 'Costs are monthly totals, not row-level, so this shows the leads that cost is spread across.';
  const RATE_NOTE = (stage) => `This rate's denominator: the ${STAGE_LABEL[stage]} below. Periods are counted by the month each event happened, so the next stage is not always a subset of these rows.`;
  function cellSpec(table, field, row) {
    if (table === 'tab2') {
      const w = tab2Window();
      const stage = FIELD_STAGE[field] || 'lead';
      const s = { stage, start: w.start, end: w.end };
      if (row && row.channel && row.channel !== 'Total') s.channel = row.channel;
      if (/cost|spend|payroll|sessions/.test(field) && !/^cp/.test(field)) s.note = COST_NOTE;
      if (/_pct$/.test(field) && field !== 'payroll_pct') s.note = RATE_NOTE(stage);
      return s;
    }
    if (table === 'stage') { // funnel_total rows keyed by stage name
      const w = tab2Window(); return { stage: row.stage.toLowerCase(), start: w.start, end: w.end, note: field === 'cvr_next_pct' ? RATE_NOTE(row.stage.toLowerCase()) : undefined };
    }
    if (table === 'churn') {
      const w = churnWindow();
      const s = { stage: 'customer', start: w.start, end: w.end };
      if (row && row.key && row.key !== 'Total') { if (row.dim === 'plan') s.plan = row.key; else s.channel = row.key; }
      const C = { churned: 'churned', churned_pct: null, elig12: 'elig12', churn12: 'churn12', churn12_pct: 'elig12', elig24: 'elig24', churn24: 'churn24', churn24_pct: 'elig24', arr_lost: 'churned' };
      if (C[field]) s.churn = C[field];
      if (field === 'churn12_pct' || field === 'churn24_pct') s.note = 'This rate’s denominator: customers old enough to be measured. The Churned ≤ column shows which of them churned.';
      if (field === 'churned_pct') s.note = 'All customers in this cohort; the Customer status column shows which churned.';
      return s;
    }
    if (table === 'mql_outcome') {
      const w = tab2Window();
      return { stage: 'mql', start: w.start, end: w.end, status: row.status, reason: row.reason || '__none__' };
    }
    return {};
  }
  const drillAttr = (spec) => JSON.stringify(spec);

  // Thin-data note for a metric cell, or null.
  function thin(field, row) {
    if (!row) return null;
    const n = (x) => d3.format(',')(x || 0);
    const cnt = { cpl: ['leads', 'leads'], cpmql: ['mqls', 'MQLs'], cpsal: ['sals', 'SALs'], cpopp: ['opps', 'opps'] };
    if (cnt[field]) { const [k, w] = cnt[field]; if ((row[k] || 0) < THIN.stageCount) return `Thin data: only ${n(row[k])} ${w} in this window (under ${THIN.stageCount}). This cost-per can swing widely; don't decide on it alone.`; }
    if (field === 'cpwon' || field === 'acv') { if ((row.won || 0) < THIN.won) return `Thin data: only ${n(row.won)} customers won in this window (under ${THIN.won}). Don't make budget decisions on this figure alone.`; }
    const den = { lead_mql_pct: ['leads', 'leads'], mql_sal_pct: ['mqls', 'MQLs'], sal_opp_pct: ['sals', 'SALs'], win_rate_pct: ['opps', 'opps'] };
    if (den[field]) { const [k, w] = den[field]; if ((row[k] || 0) < THIN.rateDenom) return `Thin data: this rate is based on ${n(row[k])} ${w} (under ${THIN.rateDenom}). Treat it as directional only.`; }
    if (field === 'churn12_pct' || field === 'churn24_pct') { const k = field === 'churn12_pct' ? 'elig12' : 'elig24'; if ((row[k] || 0) < THIN.cohort) return `Thin data: only ${n(row[k])} customers are old enough to measure (under ${THIN.cohort}). Treat this churn rate as directional only.`; }
    if (field === 'churned_pct') { if ((row.customers || 0) < THIN.cohort) return `Thin data: only ${n(row.customers)} customers in this cohort (under ${THIN.cohort}).`; }
    return null;
  }
  // Fill a table cell or span with text, optional thin flag, optional drill spec.
  function fill(el, text, opts = {}) {
    el.textContent = text;
    if (opts.cls) el.classList.add(...opts.cls.split(' ').filter(Boolean));
    if (opts.thin) { el.dataset.thin = opts.thin; el.classList.add('mk-thin'); el.tabIndex = 0; }
    if (opts.drill) { el.dataset.drill = drillAttr(opts.drill); el.classList.add('mk-drill'); el.tabIndex = 0; el.setAttribute('role', 'link'); }
    return el;
  }
  // Build a sentence from parts: strings, or {text, source, field, where, row, drill, thin, strong}
  function sentence(el, parts) {
    el.replaceChildren();
    for (const p of parts) {
      if (p == null) continue;
      if (typeof p === 'string') { el.append(p); continue; }
      const s = document.createElement(p.strong ? 'b' : 'span');
      if (p.source) s.dataset.source = p.source;
      if (p.field) s.dataset.field = p.field;
      if (p.where) s.dataset.where = p.where;
      if (p.row != null) s.dataset.row = String(p.row);
      fill(s, p.text, { drill: p.drill, thin: p.thin });
      el.append(s);
    }
  }
  return { CHANNELS, LABELS, STAGE_LABEL, TARGET_DEFAULTS, DEF, configure, addMonths, payOtherPct, THIN, DATE_LABEL, COST_NOTE, money, money2, pct, num, dec, monthLabel, label, win, tab2Window, churnWindow,
    targets, cls, match, specToParams, paramsToSpec, cellSpec, drillAttr, thin, fill, sentence, yes };
})();
window.mkMetric = 'cpsal';
window.mkPage = 0;
