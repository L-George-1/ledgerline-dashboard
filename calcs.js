dash.calc('channel_actuals', {
  title: 'Channel cost-per and conversion',
  description: 'Window totals by channel, counted from the joined records: leads, MQLs and SALs by lead month, opps by opp created month, wins by close month. Demand gen cost = program spend + allocated marketing payroll (minus the Other, non-demand-gen share) + SDR share (inbound) or AE prospecting time (outbound).',
  inputs: ['records', 'spend_month', 'cost_month'],
  fn: (records, spendMonth, costMonth) => {
    const p = dash.params();
    let s = p.start || mk.DEF.start, e = p.end || mk.DEF.end;
    if (s > e) [s, e] = [e, s];
    const inWin = (d) => !!d && d.slice(0, 7) >= s && d.slice(0, 7) <= e;
    const yes = (v) => v === true || v === 'true';
    const CH = ['organic_search', 'paid_search', 'paid_social', 'event', 'referral', 'direct', 'partner', 'email', 'outbound'];
    const INBOUND = CH.slice(0, 8);
    const z = () => ({ leads: 0, mqls: 0, sals: 0, opps: 0, won: 0, new_arr: 0, program_spend: 0, sessions: 0 });
    const g = Object.fromEntries(CH.map((c) => [c, z()]));
    for (const r of records) {
      if (r.record_type !== 'lead' || !g[r.channel]) continue;
      const a = g[r.channel];
      if (inWin(r.lead_created)) { a.leads++; if (yes(r.is_mql)) a.mqls++; if (yes(r.is_sal)) a.sals++; }
      if (r.opportunity_id && inWin(r.opp_created)) a.opps++;
      if (yes(r.opp_won) && inWin(r.opp_close)) { a.won++; a.new_arr += +r.opp_arr || 0; }
    }
    for (const r of spendMonth) if (r.month >= s && r.month <= e && g[r.channel]) { g[r.channel].program_spend += +r.program_spend || 0; g[r.channel].sessions += +r.sessions || 0; }
    const co = costMonth.filter((r) => r.month >= s && r.month <= e);
    const sum = (rows, f) => rows.reduce((t, r) => t + (+r[f] || 0), 0);
    const mktPay = sum(co, 'marketing_payroll'), sdr = sum(co, 'sdr_cost'), outb = sum(co, 'outbound_cost');
    const inLeads = INBOUND.reduce((t, c) => t + g[c].leads, 0), inMqls = INBOUND.reduce((t, c) => t + g[c].mqls, 0);
    const div = (a, b) => (b > 0 ? a / b : null);
    const r0 = (v) => (v == null ? null : Math.round(v));
    const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
    const build = (channel, a, payPct, payCost, sdrCost, outCost) => {
      const o = Object.assign({ channel }, a);
      o.payroll_pct = r1(payPct); o.payroll_cost = r0(payCost); o.sdr_cost = r0(sdrCost); o.outbound_cost = r0(outCost);
      const dg = o.program_spend + payCost + sdrCost + outCost;
      o.dg_cost = r0(dg);
      o.cpl = r0(div(dg, o.leads)); o.cpmql = r0(div(dg, o.mqls)); o.cpsal = r0(div(dg, o.sals)); o.cpopp = r0(div(dg, o.opps)); o.cpwon = r0(div(dg, o.won));
      o.acv = r0(div(o.new_arr, o.won));
      o.lead_mql_pct = r1(div(o.mqls * 100, o.leads)); o.mql_sal_pct = r1(div(o.sals * 100, o.mqls));
      o.sal_opp_pct = r1(div(o.opps * 100, o.sals)); o.win_rate_pct = r1(div(o.won * 100, o.opps));
      return o;
    };
    // "Other": the share of marketing payroll spent on work that isn't demand gen (e.g. Customer Success).
    // It is left out of demand gen cost, so out of every cost-per and Full CAC. Unset channels share the rest by lead share.
    const otherPct = mk.payOtherPct(p);
    const dgPay = mktPay * (1 - otherPct / 100);
    let pctSum = 0;
    const rows = INBOUND.map((c) => {
      const auto = inLeads > 0 ? (g[c].leads / inLeads) * (100 - otherPct) : 0;
      const set = p['pay_' + c];
      const pp = set != null && set !== '' && isFinite(+set) ? +set : auto;
      pctSum += pp;
      return build(c, g[c], pp, (pp / 100) * mktPay, inMqls > 0 ? (g[c].mqls / inMqls) * sdr : 0, 0);
    });
    rows.push(build('outbound', g.outbound, null, 0, 0, outb));
    const tot = z();
    for (const c of CH) for (const k of Object.keys(tot)) tot[k] += g[c][k];
    rows.push(Object.assign(build('Total', tot, pctSum, dgPay, sdr, outb), { other_payroll_pct: r1(otherPct), other_payroll_cost: r0(mktPay - dgPay), marketing_payroll: r0(mktPay) }));
    return rows;
  },
});

dash.calc('cac_summary', {
  title: 'CAC summary',
  description: 'Blended demand gen CAC, full CAC (demand gen + sales-side payroll), CAC ratio and demand gen share for the window.',
  inputs: ['channel_actuals', 'cost_month'],
  fn: (channelActuals, costMonth) => {
    const p = dash.params();
    let s = p.start || mk.DEF.start, e = p.end || mk.DEF.end;
    if (s > e) [s, e] = [e, s];
    const co = costMonth.filter((r) => r.month >= s && r.month <= e);
    const t = channelActuals.find((r) => r.channel === 'Total') || {};
    const salesSide = co.reduce((a, r) => a + (+r.sales_side_cost || 0), 0);
    const mktPay = co.reduce((a, r) => a + (+r.marketing_payroll || 0), 0);
    const dg = t.dg_cost || 0, full = dg + salesSide, won = t.won || 0, arr = t.new_arr || 0;
    return [{
      months: co.length, dg_cost: dg, sales_side_cost: Math.round(salesSide), full_cost: Math.round(full), marketing_payroll: mktPay,
      other_payroll_pct: t.other_payroll_pct ?? 0, other_payroll_cost: t.other_payroll_cost ?? 0, won, new_arr: arr,
      dg_cac: won > 0 ? Math.round(dg / won) : null, full_cac: won > 0 ? Math.round(full / won) : null, acv: won > 0 ? Math.round(arr / won) : null,
      cac_ratio: arr > 0 ? Math.round((full / arr) * 100) / 100 : null, dg_share_pct: full > 0 ? Math.round((dg / full) * 1000) / 10 : null,
    }];
  },
});

dash.calc('funnel_total', {
  title: 'Blended funnel',
  description: 'Total row of the channel table laid out by stage: count, demand gen cost per, and conversion to the next stage.',
  inputs: ['channel_actuals'],
  fn: (channelActuals) => {
    const t = channelActuals.find((r) => r.channel === 'Total');
    if (!t) return [];
    return [
      { stage: 'Lead', count: t.leads, cost_per: t.cpl, cvr_next_pct: t.lead_mql_pct },
      { stage: 'MQL', count: t.mqls, cost_per: t.cpmql, cvr_next_pct: t.mql_sal_pct },
      { stage: 'SAL', count: t.sals, cost_per: t.cpsal, cvr_next_pct: t.sal_opp_pct },
      { stage: 'Opp', count: t.opps, cost_per: t.cpopp, cvr_next_pct: t.win_rate_pct },
      { stage: 'Won', count: t.won, cost_per: t.cpwon, cvr_next_pct: null },
    ];
  },
});

dash.calc('mql_outcomes', {
  title: 'What happened to MQLs that were not accepted',
  description: 'MQLs created in the window that did not become SALs, grouped by lead status and disqualification reason.',
  inputs: ['records'],
  fn: (records) => {
    const p = dash.params();
    let s = p.start || mk.DEF.start, e = p.end || mk.DEF.end;
    if (s > e) [s, e] = [e, s];
    const yes = (v) => v === true || v === 'true';
    const g = new Map(); let mqls = 0;
    for (const r of records) {
      if (r.record_type !== 'lead' || !yes(r.is_mql) || !r.lead_created) continue;
      const m = r.lead_created.slice(0, 7); if (m < s || m > e) continue;
      mqls++;
      if (yes(r.is_sal)) continue;
      const key = r.lead_status + '|' + (r.disqualified_reason || '');
      g.set(key, (g.get(key) || 0) + 1);
    }
    const rows = [...g.entries()].map(([k, n]) => {
      const [status, reason] = k.split('|');
      return { outcome: reason ? `${status}: ${reason}` : status, status, reason: reason || null, count: n, pct_of_mqls: mqls ? Math.round((n / mqls) * 1000) / 10 : null };
    });
    rows.sort((a, b) => b.count - a.count);
    return rows;
  },
});

dash.calc('data_health', {
  title: 'Lead tagging checks',
  description: 'Counts of leads whose status and disqualification reason disagree, across all dates.',
  inputs: ['records'],
  fn: (records) => {
    let workingWithReason = 0, dqNoReason = 0, nurtureWithReason = 0;
    for (const r of records) {
      if (r.record_type !== 'lead') continue;
      if (r.lead_status === 'Working' && r.disqualified_reason) workingWithReason++;
      if (r.lead_status === 'Disqualified' && !r.disqualified_reason) dqNoReason++;
      if (r.lead_status === 'Nurture' && r.disqualified_reason) nurtureWithReason++;
    }
    return [{ working_with_reason: workingWithReason, disqualified_no_reason: dqNoReason, nurture_with_reason: nurtureWithReason }];
  },
});

function mkChurnRows(records, dim) {
  const p = dash.params();
  let s = p.c_start || mk.DEF.c_start, e = p.c_end || mk.DEF.c_end;
  if (s > e) [s, e] = [e, s];
  const yes = (v) => v === true || v === 'true';
  const z = () => ({ customers: 0, churned: 0, elig12: 0, churn12: 0, elig24: 0, churn24: 0, arr_lost: 0 });
  const g = new Map(); const tot = z();
  for (const r of records) {
    if (!r.customer_id || !r.signup_date) continue;
    const m = r.signup_date.slice(0, 7); if (m < s || m > e) continue;
    const key = dim === 'plan' ? r.plan : r.channel;
    if (!g.has(key)) g.set(key, z());
    for (const a of [g.get(key), tot]) {
      a.customers++;
      if (r.customer_status === 'churned') { a.churned++; a.arr_lost += +r.last_contract_arr || 0; }
      if (yes(r.eligible_12m)) { a.elig12++; if (yes(r.churned_12m)) a.churn12++; }
      if (yes(r.eligible_24m)) { a.elig24++; if (yes(r.churned_24m)) a.churn24++; }
    }
  }
  const pc = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const fin = (key, a) => Object.assign({ key, dim }, a, { churned_pct: pc(a.churned, a.customers), churn12_pct: pc(a.churn12, a.elig12), churn24_pct: pc(a.churn24, a.elig24) });
  const order = dim === 'plan' ? ['Core', 'Growth', 'Enterprise'] : ['organic_search', 'paid_search', 'paid_social', 'event', 'referral', 'direct', 'partner', 'email', 'outbound', 'unknown_pre2023'];
  const rows = order.filter((k) => g.has(k)).map((k) => fin(k, g.get(k)));
  rows.push(fin('Total', tot));
  return rows;
}
dash.calc('churn_by_channel', {
  title: 'Churn by acquisition source',
  description: 'Customers signed in the cohort window by acquisition channel: churned to date, and churn within 12 and 24 months of signup among customers old enough to measure.',
  inputs: ['records'],
  fn: (records) => mkChurnRows(records, 'channel'),
});
dash.calc('churn_by_plan', {
  title: 'Churn by plan',
  description: 'Customers signed in the cohort window by plan (package): churned to date, and churn within 12 and 24 months of signup among customers old enough to measure.',
  inputs: ['records'],
  fn: (records) => mkChurnRows(records, 'plan'),
});

dash.calc('bench_live', {
  title: 'Dashboard figures against benchmarks',
  description: 'This dashboard’s CAC ratio for the selected window set against the new-name CAC ratio benchmark for $10-25K ACV.',
  inputs: ['cac_summary', 'benchmarks'],
  fn: (cacSummary, benchmarks) => {
    const c = cacSummary[0] || {};
    const b = benchmarks.find((r) => r.metric === 'New-name CAC ratio') || {};
    const pos = (v) => (v == null ? null : v > b.p75 ? 'Above P75' : v > b.median ? 'Between median and P75' : v > b.p25 ? 'Between P25 and median' : 'Below P25');
    return [{ metric: 'New-name CAC ratio (this dashboard, selected window)', value: c.cac_ratio, p25: b.p25, median: b.median, p75: b.p75, position: pos(c.cac_ratio) }];
  },
});

dash.calc('explorer_rows', {
  title: 'Explorer: filtered records',
  description: 'The joined records that match the explorer filters (stage, channel, dates, status, reason, plan, churn, search).',
  inputs: ['records'],
  fn: (records) => {
    const spec = window.mk.paramsToSpec(dash.params());
    return records.filter((r) => window.mk.match(r, spec));
  },
});

dash.calc('explorer_summary', {
  title: 'Explorer: counts in the filtered rows',
  description: 'How many of the filtered rows are leads, MQLs, SALs, opps, wins and customers.',
  inputs: ['explorer_rows'],
  fn: (rows) => {
    const yes = (v) => v === true || v === 'true';
    const o = { rows: rows.length, leads: 0, mqls: 0, sals: 0, opps: 0, won: 0, customers: 0, churned: 0, won_arr: 0 };
    for (const r of rows) {
      if (r.record_type === 'lead') { o.leads++; if (yes(r.is_mql)) o.mqls++; if (yes(r.is_sal)) o.sals++; if (r.opportunity_id) o.opps++; if (yes(r.opp_won)) { o.won++; o.won_arr += +r.opp_arr || 0; } }
      if (r.customer_id) { o.customers++; if (r.customer_status === 'churned') o.churned++; }
    }
    return [o];
  },
});

dash.calc('drill_check', {
  title: 'Drill-through reconciliation',
  description: 'For every clickable count on the other tabs, builds the explorer filter that click would apply and checks that it returns exactly the rows behind the number.',
  inputs: ['records', 'channel_actuals', 'funnel_total', 'churn_by_channel', 'churn_by_plan', 'mql_outcomes'],
  fn: (records, channelActuals, funnelTotal, churnByChannel, churnByPlan, mqlOutcomes) => {
    const M = window.mk;
    const out = [];
    const run = (metric, table, field, row, expected, sumField) => {
      const spec = M.paramsToSpec(M.specToParams(M.cellSpec(table, field, row)));
      const hits = records.filter((r) => M.match(r, spec));
      const got = sumField ? hits.reduce((t, r) => t + (+r[sumField] || 0), 0) : hits.length;
      out.push({ metric, expected, got, ok: expected === got });
    };
    for (const r of channelActuals) {
      for (const f of ['leads', 'mqls', 'sals', 'opps', 'won']) run(`${r.channel} ${f}`, 'tab2', f, r, r[f]);
      run(`${r.channel} new ARR`, 'tab2', 'new_arr', r, r.new_arr, 'opp_arr');
    }
    for (const r of funnelTotal) run(`funnel ${r.stage}`, 'stage', 'count', r, r.count);
    for (const rows of [churnByChannel, churnByPlan]) for (const r of rows) {
      for (const f of ['customers', 'churned', 'elig12', 'churn12', 'elig24', 'churn24']) run(`churn ${r.dim} ${r.key} ${f}`, 'churn', f, r, r[f]);
      run(`churn ${r.dim} ${r.key} ARR lost`, 'churn', 'arr_lost', r, r.arr_lost, 'last_contract_arr');
    }
    for (const r of mqlOutcomes) run(`MQL outcome ${r.outcome}`, 'mql_outcome', 'count', r, r.count);
    return out;
  },
});

// Data hygiene: known data quality problems in the uploaded files, ranked by how much they can move the metrics.
// Counts cover all dates. spec (when set) is the Data explorer filter that opens exactly those records.
dash.calc('data_hygiene', {
  title: 'Data hygiene issues',
  description: 'Tagging conflicts, missing values and coverage gaps that can distort the funnel and cost metrics, with what to fix.',
  inputs: ['records', 'spend_month', 'join_checks'],
  fn: (records, spendMonth, joinChecks) => {
    const L = records.filter((r) => r.record_type === 'lead');
    const n = (f) => L.filter(f).length;
    const fmt = (v) => v.toLocaleString('en-US');
    const items = [];
    const add = (o) => { if (o.count > 0) items.push(o); };

    add({ id: 'working_with_reason', priority: 'High', area: 'Lead status tagging', issue: 'Working leads that also carry a disqualification reason',
      count: n((r) => r.lead_status === 'Working' && r.disqualified_reason), unit: 'leads',
      affects: 'Excluded from SAL because of the reason, so if they are really being worked, SALs, MQL→SAL and cost per SAL are understated. The CRM’s own pipeline reports count them as active.',
      action: 'Pull these leads with their owners. Clear the reason on any lead still being worked; move dead ones to Disqualified. Then make the CRM clear the reason when status changes to Working.',
      spec: { stage: 'lead', status: 'Working', reason: '__any__' } });
    add({ id: 'disqualified_no_reason', priority: 'High', area: 'Lead status tagging', issue: 'Disqualified leads with no disqualification reason',
      count: n((r) => r.lead_status === 'Disqualified' && !r.disqualified_reason), unit: 'leads',
      affects: 'With no fit reason they stay MQLs, which inflates MQL counts, flatters cost per MQL and drags down MQL→SAL.',
      action: 'Backfill reasons for recent ones with the SDR team, and make the reason a required field when a lead is disqualified.',
      spec: { stage: 'lead', status: 'Disqualified', reason: '__none__' } });
    const nurt = L.filter((r) => r.lead_status === 'Nurture' && r.disqualified_reason);
    const tally = {}; for (const r of nurt) tally[r.disqualified_reason] = (tally[r.disqualified_reason] || 0) + 1;
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    add({ id: 'nurture_with_reason', priority: 'Medium', area: 'Lead status tagging', issue: `Nurture leads tagged with a disqualification reason${top ? ` (most often ${top[0]}: ${fmt(top[1])})` : ''}`,
      count: n((r) => r.lead_status === 'Nurture' && r.disqualified_reason), unit: 'leads',
      affects: 'Nurture status keeps them as MQLs despite the reason. If they are truly out of ICP, MQL counts are inflated and MQL→SAL understated.',
      action: 'Decide whether leads with a fit reason belong in Nurture at all. If not, move them to Disqualified; if so, clear the reason.',
      spec: { stage: 'lead', status: 'Nurture', reason: '__any__' } });
    add({ id: 'duplicates', priority: 'Medium', area: 'Deduplication', issue: 'Duplicate lead records',
      count: n((r) => r.lead_status === 'Duplicate'), unit: 'leads',
      affects: 'Every row counts as a Lead, so duplicates inflate lead counts and lower cost per lead and Lead→MQL. They are already excluded from MQLs.',
      action: 'Find which forms and channels create them, and add duplicate matching on email and company at capture.',
      spec: { stage: 'lead', status: 'Duplicate' } });

    const spendBy = {};
    for (const r of spendMonth) spendBy[r.channel] = (spendBy[r.channel] || 0) + (+r.program_spend || 0);
    const inbound = ['organic_search', 'paid_search', 'paid_social', 'event', 'referral', 'direct', 'partner', 'email'];
    const noSpend = inbound.filter((c) => !spendBy[c]);
    const LBL = { organic_search: 'organic search', paid_search: 'paid search', paid_social: 'paid social', event: 'event', referral: 'referral', direct: 'direct', partner: 'partner', email: 'email' };
    add({ id: 'no_program_spend', priority: 'Medium', area: 'Spend coverage', issue: `Inbound channels with no program spend in the spend file: ${noSpend.map((c) => LBL[c]).join(', ')}`,
      count: noSpend.length, unit: noSpend.length === 1 ? 'channel' : 'channels',
      affects: 'Their demand gen cost is payroll and SDR time only, so their cost per lead, SAL and customer may look cheaper than they are.',
      action: 'Confirm with finance whether these channels have real costs (partner fees, email tools, agency time) booked elsewhere, and add them to the spend export.',
      spec: null });

    const noLead23 = records.filter((r) => r.record_type === 'customer_only' && r.signup_date && r.signup_date >= '2023-01-01').length;
    add({ id: 'customers_no_lead', priority: 'Low', area: 'Lead-to-customer linking', issue: 'Customers signed since 2023 with no source lead',
      count: noLead23, unit: 'customers',
      affects: 'Their won deals are left out of funnel counts, so Won, new ARR and cost per customer for their channel are slightly off in windows that include them. They still count in churn.',
      action: 'Check whether their opportunities were created before the lead export began, or were never linked to a lead. Link them where a lead exists.',
      spec: null });

    const missing = [['company', 'company'], ['company_size', 'company size'], ['job_title', 'job title'], ['country', 'country']]
      .map(([f, label]) => [label, n((r) => !r[f])]).filter(([, c]) => c > 0);
    add({ id: 'missing_fields', priority: 'Low', area: 'Lead completeness', issue: `Leads missing profile fields: ${missing.map(([l, c]) => `${l} ${fmt(c)}`).join(', ')}`,
      count: Math.max(0, ...missing.map(([, c]) => c)), unit: 'leads',
      affects: 'No effect on counts or costs. It limits ICP and segment analysis, account matching and deduplication, and what the AI recommendations can say about fit. Placeholder text such as n/a is counted as missing.',
      action: 'Make company and company size required on forms, and backfill from enrichment for open leads.',
      spec: null });

    const pre23 = records.filter((r) => r.channel === 'unknown_pre2023').length;
    add({ id: 'pre2023', priority: 'Info', area: 'Churn history', issue: 'Customers signed before 2023 have no acquisition channel, and only those still active on 1 Jan 2023 are in the data',
      count: pre23, unit: 'customers',
      affects: 'Churn for pre-2023 cohorts is understated (customers who churned earlier are missing), so the "All customers" churn view looks better than reality. Their source shows as Unknown.',
      action: 'If the old CRM export exists, add churned pre-2023 customers and their sources. Otherwise keep churn analysis to cohorts from 2023.',
      spec: null });

    // Cross-file join checks from ingest: only the ones that found something join the queue.
    for (const j of joinChecks || []) {
      if (!j.count) continue;
      items.push({ id: j.id, priority: j.priority, area: j.area, issue: j.issue, count: j.count, unit: j.unit, affects: j.affects, action: j.action,
        examples: j.examples, spec: j.ids ? { stage: 'all', ids: j.ids.join(',') } : null });
    }

    const rank = { High: 0, Medium: 1, Low: 2, Info: 3 };
    items.sort((a, b) => rank[a.priority] - rank[b.priority] || b.count - a.count);
    return items;
  },
});
