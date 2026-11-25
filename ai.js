// AI recommendations: the only code in the app that touches the network, and only when the user confirms.
// What it sends: the dashboard's aggregate numbers for the current view, never record rows. The payload is
// built by copying numbers, booleans and a fixed list of label fields (Channel, stage, status, reason, Plan),
// so no name, company, email or ID can reach Claude even if a calc later gains such a field.
// The API key lives in this closure only: never in storage, cookies or the URL, and gone when the tab closes.
// Classic script: defines window.mkAI. Depends on window.dash and window.mk.
window.mkAI = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-5-5';
  const API_VERSION = '2026-10-21';
  // Server-side refusal fallback (on by default for this model). Remove these two if a key's org can't use it.
  const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
  const USE_FALLBACKS = true;

  // Calcs that go to Claude: all aggregates, none holds record rows.
  const SECTIONS = [
    ['cac_summary', 'Window totals: demand gen cost, sales-side cost, full CAC, CAC ratio, ACV, wins'],
    ['funnel_total', 'Blended funnel: count, cost per stage and conversion to next stage'],
    ['channel_actuals', 'By Channel: stage counts, costs, cost-per at each stage, conversion rates'],
    ['mql_outcomes', 'Where non-SAL MQLs went, by status and reason'],
    ['churn_by_plan', 'Churn at 12 and 24 months by Plan (signup cohort window)'],
    ['churn_by_channel', 'Churn at 12 and 24 months by acquisition Channel'],
    ['bench_live', 'This window’s CAC ratio against the new-name CAC ratio benchmark ($10-25K ACV)'],
    ['data_health', 'Lead tagging conflicts across all dates'],
  ];
  // The only string fields that may be sent, and the only values each may hold. Labels come from the CSVs
  // (status and reason are typed in the CRM), so a value outside its list is sent as "Other": free text such
  // as an email or a company name in a reason can never reach Claude. Every other string is dropped.
  const CHANNELS = ['organic_search', 'paid_search', 'paid_social', 'event', 'referral', 'direct', 'partner', 'email', 'outbound', 'unknown_pre2023', 'Total'];
  const PLANS = ['Core', 'Growth', 'Enterprise'];
  const STATUSES = ['Disqualified', 'Unresponsive', 'Nurture', 'Working', 'Converted to opportunity', 'Duplicate'];
  const REASONS = ['Spam or test', 'Existing customer', 'Repeat submission', 'Student or researcher', 'Vendor pitch', 'Too small', 'Suspected competitor'];
  const ALLOWED = {
    channel: new Set(CHANNELS),
    key: new Set([...CHANNELS, ...PLANS]),
    dim: new Set(['channel', 'plan']),
    stage: new Set(['Lead', 'MQL', 'SAL', 'Opp', 'Won']),
    status: new Set(STATUSES),
    reason: new Set(REASONS),
    metric: new Set(['New-name CAC ratio (this dashboard, selected window)']),
    position: new Set(['Above P75', 'Between median and P75', 'Between P25 and median', 'Below P25']),
  };
  const LABEL_KEYS = new Set([...Object.keys(ALLOWED), 'outcome']);
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const label = (k, v) => (ALLOWED[k].has(v) ? v : 'Other');
  const month = (v) => (typeof v === 'string' && MONTH.test(v) ? v : null);

  let apiKey = null;

  const round = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : v === null || typeof v === 'boolean' ? v : null);
  function clean(row) {
    const out = {};
    for (const [k, v] of Object.entries(row || {})) {
      if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = round(v);
      else if (typeof v === 'string' && ALLOWED[k]) out[k] = label(k, v);
    }
    // outcome is "status" or "status: reason"; rebuild it from the checked parts, never pass it through.
    if (row && 'outcome' in row) out.outcome = out.reason && out.reason !== null ? `${out.status}: ${out.reason}` : out.status;
    return out;
  }

  // The exact data that goes to Claude, for the dashboard's current view.
  function buildPayload() {
    const M = window.mk, p = dash.params(), t = M.targets();
    const w = M.tab2Window(), c = M.churnWindow();
    const data = {};
    for (const [id] of SECTIONS) {
      const d = dash.data(id);
      if (d.status !== 'ok') continue;
      data[id] = (Array.isArray(d.data) ? d.data : [d.data]).map(clean);
    }
    const split = {};
    for (const ch of M.CHANNELS.slice(0, 8)) { const v = p['pay_' + ch]; split[ch] = v == null || v === '' ? null : round(+v); }
    split.other_not_demand_gen = round(M.payOtherPct(p));
    return {
      as_of: month(M.DEF.asOf),
      demand_gen_window: { start: month(w.start), end: month(w.end) },
      churn_cohort_signups: { start: month(c.start), end: month(c.end) },
      targets: clean({ acv: t.acv, cac_ratio: t.cac_ratio, dg_share_pct: t.dg_share, close_rate_pct: t.close_rate, sal_to_opp_pct: t.sal_opp,
        mql_to_sal_pct: t.mql_sal, lead_to_mql_pct: t.lead_mql, target_cost_per_lead: t.cpl, target_cost_per_mql: t.cpmql,
        target_cost_per_sal: t.cpsal, target_cost_per_opp: t.cpopp, target_cost_per_customer: t.cpwon }),
      marketing_payroll_split_pct: split,
      data,
    };
  }

  const SYSTEM = `You are a B2B SaaS go-to-market analyst advising Ledgerline's GTM operations lead on where to cut CAC.
You receive aggregate figures from Ledgerline's marketing performance dashboard as JSON. Base every statement on these figures only, and quote the numbers you rely on.

How the figures are defined:
- Stages: Lead (every lead), MQL (lead minus junk and disqualified-for-fit), SAL (Working or Converted with no disqualification reason), Opp (new-business opportunity linked from a lead), Won (that opp closed won). Counts use period basis: each lands in the month its own event happened, so a later stage is not always a subset of the earlier one in the same window.
- Demand gen cost per Channel = program spend + the Channel's share of marketing payroll + SDR cost split by MQL share (outbound: AE prospecting time). The same cost pool is divided by each stage's count to give cost per lead, MQL, SAL, Opp and customer (cpl, cpmql, cpsal, cpopp, cpwon). Full CAC adds sales-side cost. CAC ratio = full cost / new ARR won.
- Targets are worked back from ACV, target CAC ratio, demand gen share and the stage conversion targets.
- Thin data: treat a cost-per as unreliable when its stage count is under 10, cost per customer and ACV when wins are under 5, a conversion rate when its denominator is under 30, and a churn rate when fewer than 20 customers are measurable (elig12 / elig24). Name thin figures; don't base a recommendation on them alone.
- marketing_payroll_split_pct values of null mean the user has not set that Channel's share, so it gets its share of inbound leads applied to whatever payroll is not marked other_not_demand_gen. other_not_demand_gen is the percentage of marketing payroll spent on work that isn't demand gen (such as Customer Success); it is excluded from demand gen cost, every cost-per and Full CAC.

Write for a busy operator who will scan, not read: specific, plain language, short sentences, numbers over adjectives. Compare Channels with the blended (Total) figures and with targets. Don't invent data that is not in the JSON.

Format rules:
- Recommendations: concrete actions on a named Channel, stage or Plan, ranked by likely CAC impact. action is one imperative sentence of at most 15 words. evidence is 2 to 4 short bullets of at most 20 words each, each quoting the numbers behind it. impact is your estimate of the effect on CAC (high, medium or low); impact_detail says what it could change, in one sentence. confidence reflects how solid the evidence is (lower it for thin data).
- Findings: tag each with one category. headline is at most 10 words; detail is at most 2 short sentences.
- Caveats: only about how reliable these figures are (thin data, tagging problems, an unset payroll split, period basis). Do not list analyses, breakdowns or data the dashboard doesn't include, and don't comment on what the dashboard lacks anywhere in your answer.`;

  const CATEGORIES = ['Funnel conversion', 'Channel efficiency', 'CAC and benchmarks', 'Retention and churn', 'Data quality'];
  const LEVEL = { type: 'string', enum: ['high', 'medium', 'low'] };
  const SCHEMA = {
    type: 'object', additionalProperties: false, required: ['recommendations', 'findings', 'caveats'],
    properties: {
      recommendations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['action', 'area', 'impact', 'impact_detail', 'confidence', 'evidence'],
        properties: { action: { type: 'string' }, area: { type: 'string' }, impact: LEVEL, impact_detail: { type: 'string' }, confidence: LEVEL,
          evidence: { type: 'array', items: { type: 'string' } } } } },
      findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'headline', 'detail'],
        properties: { category: { type: 'string', enum: CATEGORIES }, headline: { type: 'string' }, detail: { type: 'string' } } } },
      caveats: { type: 'array', items: { type: 'string' } },
    },
  };

  const INSTRUCTION = 'Here are the dashboard figures for the current view. Give 3 to 6 ranked recommendations to lower CAC, then 4 to 8 findings across the categories, then any caveats about how reliable the figures are.';
  // Everything in the request besides the data, for the preview.
  const settingsOf = (body) => ({ model: body.model, max_tokens: body.max_tokens, effort: body.output_config.effort, answer_format: 'JSON with recommendations, findings by category, and caveats', refusal_fallback: body.fallbacks || 'off' });

  function buildRequest(payload) {
    const body = {
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: INSTRUCTION + '\n\n' + JSON.stringify(payload) }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    };
    if (USE_FALLBACKS) body.fallbacks = 'default';
    return body;
  }

  function headers(key) {
    const h = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' };
    if (USE_FALLBACKS) h['anthropic-beta'] = FALLBACK_BETA;
    return h;
  }

  class AIError extends Error {}
  async function send(body, { signal } = {}) {
    if (!apiKey) throw new AIError('Enter an API key first.');
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body), signal });
    } catch (e) {
      throw new AIError('Couldn’t reach Claude. Check your internet connection and try again. The dashboard still works offline.');
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON error body */ }
    if (!res.ok) {
      const msg = json && json.error && json.error.message ? ` (${json.error.message})` : '';
      if (res.status === 401 || res.status === 403) throw new AIError('The API key was rejected. Check it and enter it again.' + msg);
      if (res.status === 429) throw new AIError('Claude is rate limited for this key right now. Wait a minute and try again.' + msg);
      if (res.status === 400) throw new AIError('Claude rejected the request.' + msg);
      if (res.status >= 500) throw new AIError(`Claude’s service had an error (${res.status}). Try again shortly.` + msg);
      throw new AIError(`Unexpected response from Claude (${res.status}).` + msg);
    }
    if (json.stop_reason === 'refusal') throw new AIError('Claude declined to answer this request. Try again, or adjust the date window.');
    if (json.stop_reason === 'max_tokens') throw new AIError('Claude’s answer was cut off before it finished. Try again.');
    const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try { return { result: JSON.parse(text), model: json.model, usage: json.usage }; } catch (e) { throw new AIError('Claude’s answer couldn’t be read. Try again.'); }
  }

  return {
    MODEL, SECTIONS, LABEL_KEYS, ALLOWED, AIError, CATEGORIES, clean, SYSTEM, instruction: () => INSTRUCTION, settingsOf,
    setKey(k) { apiKey = k && k.trim() ? k.trim() : null; return !!apiKey; },
    hasKey: () => !!apiKey,
    clearKey() { apiKey = null; },
    buildPayload, buildRequest, send,
  };
})();
