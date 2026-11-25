// Ingest: the adapter seam. Turns the 8 uploaded data room CSVs into the datasets the calcs read
// (records, spend_month, cost_month), plus the As-of month, data health and fatal errors.
// A port of prototype/build_data2.py; definitions are in DECISION_RECORD.md section 4 and GLOSSARY.md.
// Classic script (no modules, no build step): defines window.mkIngest.
window.mkIngest = (() => {
  // ---------- CSV ----------
  // Cells pandas treats as missing by default; the prototype read the CSVs with pandas, so parity needs the same set.
  const NA = new Set(['', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN', '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null']);
  // RFC 4180: quoted fields may hold commas, quotes ("") and newlines. Empty cells become null.
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = []; let row = []; let field = ''; let q = false; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') { q = true; quoted = true; }
      else if (c === ',') { row.push(quoted || field !== '' ? field : null); field = ''; quoted = false; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(quoted || field !== '' ? field : null); field = ''; quoted = false;
        if (!(row.length === 1 && row[0] === null)) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || quoted || row.length) { row.push(quoted || field !== '' ? field : null); rows.push(row); }
    const header = (rows.shift() || []).map((h) => (h || '').trim());
    const cell = (v) => (v == null || NA.has(v) ? null : v);
    return { header, rows: rows.map((r) => Object.fromEntries(header.map((h, j) => [h, cell(r[j])]))) };
  }

  // ---------- file kinds, recognized by header ----------
  const KINDS = {
    leads: { label: 'leads.csv', desc: 'CRM lead export: one row per lead, with its channel, status and any linked opportunity.', sig: ['lead_id', 'created_at'], need: ['lead_id', 'created_at', 'channel', 'source_form', 'status', 'disqualified_reason', 'owner', 'company', 'job_title', 'company_size_reported', 'country', 'opportunity_id'] },
    opportunities: { label: 'opportunities.csv', desc: 'CRM opportunity export: one row per deal, with its stage, ARR and close date.', sig: ['opportunity_id', 'source_channel'], need: ['opportunity_id', 'type', 'customer_id', 'created_date', 'stage', 'close_date', 'amount_arr', 'plan', 'loss_reason', 'source_channel'] },
    customers: { label: 'customers.csv', desc: 'Customer list: one row per customer, with plan, signup date, churn date and acquisition channel.', sig: ['customer_id', 'signup_date', 'acquisition_channel'], need: ['customer_id', 'name', 'industry', 'country', 'plan', 'status', 'signup_date', 'churn_date', 'churn_reason', 'current_arr', 'acquisition_channel'] },
    contracts: { label: 'contracts.csv', desc: 'Contract history: one row per contract term, with its ARR.', sig: ['customer_id', 'term_start', 'arr'], need: ['customer_id', 'term_start', 'arr'] },
    spend: { label: 'marketing_spend_monthly.csv', desc: 'Marketing program spend by month and channel.', sig: ['month', 'channel', 'spend'], need: ['month', 'channel', 'spend'] },
    funnel: { label: 'web_funnel_monthly.csv', desc: 'Website sessions and funnel counts by month and channel.', sig: ['month', 'channel', 'website_sessions'], need: ['month', 'channel', 'website_sessions'] },
    payroll: { label: 'payroll_monthly.csv', desc: 'Payroll cost by month and department (Sales, Marketing).', sig: ['month', 'department', 'payroll_cost'], need: ['month', 'department', 'payroll_cost'] },
    employees: { label: 'employees.csv', desc: 'Staff list with title, department, start and end dates, and base salary.', sig: ['employee_id', 'base_salary_usd'], need: ['title', 'department', 'start_date', 'end_date', 'base_salary_usd'] },
  };
  function kindOf(header) {
    const has = new Set(header);
    // Most specific signature first, so contracts (customer_id, arr) isn't taken for customers.
    const order = ['leads', 'opportunities', 'customers', 'contracts', 'funnel', 'spend', 'payroll', 'employees'];
    return order.find((k) => KINDS[k].sig.every((c) => has.has(c))) || null;
  }

  // ---------- dates and numbers ----------
  const ym = (d) => d.slice(0, 7);
  const monthIndex = (m) => { const [y, mo] = m.split('-').map(Number); return y * 12 + mo - 1; };
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
  // Calendar month offset with end-of-month clamping, like pandas DateOffset(months=n).
  function addMonthsDate(d, n) {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number);
    const t = y * 12 + (m - 1) + n; const ny = Math.floor(t / 12); const nm = (t % 12) + 1;
    const dd = Math.min(day, lastDay(ny, nm));
    return `${ny}-${String(nm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(lastDay(y, mo)).padStart(2, '0')}`; };
  const num = (v) => (v == null ? null : Number(v));
  const int = (v) => (v == null ? null : Math.trunc(Number(v)));
  // Python round(): half to even at 0 places; toFixed elsewhere (ties at 2-3 places are not exact in binary).
  function pyRound(x, n = 0) {
    if (n > 0) return Number(x.toFixed(n));
    const f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1; if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  // ---------- As-of month ----------
  // The last complete month that leads, marketing spend and payroll all cover. A leads month is complete
  // when the latest lead falls on its last day; for the monthly files, the last month present counts.
  function asOfMonth(L, S, P) {
    const maxOf = (xs) => xs.reduce((a, b) => (b != null && (a == null || b > a) ? b : a), null);
    const lastLead = maxOf(L.map((r) => r.created_at && r.created_at.slice(0, 10)));
    let leadsM = lastLead && ym(lastLead);
    if (leadsM && lastLead !== monthEnd(leadsM)) leadsM = window.mk && window.mk.addMonths ? window.mk.addMonths(leadsM, -1) : prevMonth(leadsM);
    const cands = [['leads', leadsM], ['marketing spend', maxOf(S.map((r) => r.month))], ['payroll', maxOf(P.map((r) => r.month))]].filter((c) => c[1]);
    cands.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return { month: cands[0][1], setBy: cands[0][0], byFile: Object.fromEntries(cands) };
  }
  function prevMonth(m) { const t = monthIndex(m) - 1; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }

  // ---------- definitions ----------
  const JUNK = new Set(['Spam or test', 'Existing customer', 'Repeat submission']);
  const DQ_NOT_MQL = new Set(['Student or researcher', 'Vendor pitch', 'Too small', 'Suspected competitor']);
  const isMql = (l) => !(JUNK.has(l.disqualified_reason) || l.status === 'Duplicate' || (l.status === 'Disqualified' && DQ_NOT_MQL.has(l.disqualified_reason)));
  const isSal = (l) => (l.status === 'Working' || l.status === 'Converted to opportunity') && l.disqualified_reason == null;

  // ---------- build ----------
  function build(T, asOf) {
    const L = T.leads, O = T.opportunities, C = T.customers, K = T.contracts, S = T.spend, W = T.funnel, P = T.payroll, E = T.employees;
    const ASOF = monthEnd(asOf);

    // New-business opps by id (first wins, as in a pandas left merge with unique ids).
    const nb = new Map();
    for (const o of O) if (o.type === 'New business' && o.opportunity_id != null && !nb.has(o.opportunity_id)) nb.set(o.opportunity_id, o);

    // Customer facts. Last contract ARR = the last contract by term_start (stable for ties).
    const lastArr = new Map();
    const ks = K.map((k, i) => [k, i]).sort((a, b) => (a[0].term_start < b[0].term_start ? -1 : a[0].term_start > b[0].term_start ? 1 : a[1] - b[1]));
    for (const [k] of ks) if (k.arr != null) lastArr.set(k.customer_id, int(k.arr));
    const elig12 = addMonthsDate(ASOF, -12), elig24 = addMonthsDate(ASOF, -24);
    const cust = new Map();
    for (const c of C) {
      const sig = c.signup_date.slice(0, 10), ch = c.churn_date && c.churn_date.slice(0, 10);
      cust.set(c.customer_id, {
        c, acq: c.acquisition_channel == null ? 'unknown_pre2023' : c.acquisition_channel,
        fields: {
          customer_id: c.customer_id, plan: c.plan, industry: c.industry, signup_date: c.signup_date,
          customer_status: c.status, churn_date: c.churn_date, churn_reason: c.churn_reason,
          current_arr: int(c.current_arr), last_contract_arr: lastArr.has(c.customer_id) ? lastArr.get(c.customer_id) : null,
          churned_12m: !!ch && ch <= addMonthsDate(sig, 12), churned_24m: !!ch && ch <= addMonthsDate(sig, 24),
          eligible_12m: sig <= elig12, eligible_24m: sig <= elig24,
        },
      });
    }
    const CUST_KEYS = ['customer_id', 'plan', 'industry', 'signup_date', 'customer_status', 'churn_date', 'churn_reason', 'current_arr', 'last_contract_arr', 'churned_12m', 'churned_24m', 'eligible_12m', 'eligible_24m'];
    const noCust = Object.fromEntries(CUST_KEYS.map((k) => [k, null]));

    const records = [];
    const linked = new Set();
    for (const l of L) {
      const o = l.opportunity_id != null ? nb.get(l.opportunity_id) : undefined;
      const stage = o ? o.stage : null;
      const won = stage === 'Closed won';
      const row = {
        row_id: l.lead_id, record_type: 'lead', lead_id: l.lead_id, lead_created: l.created_at.slice(0, 10),
        channel: l.channel, source_form: l.source_form, lead_status: l.status, disqualified_reason: l.disqualified_reason,
        owner: l.owner, company: l.company, job_title: l.job_title, company_size: l.company_size_reported, country: l.country,
        is_mql: isMql(l), is_sal: isSal(l), opportunity_id: l.opportunity_id,
        opp_created: o ? o.created_date : null, opp_stage: stage,
        opp_close: o && (stage === 'Closed won' || stage === 'Closed lost') ? o.close_date : null,
        opp_won: won, opp_arr: won ? int(o.amount_arr) : null, loss_reason: o ? o.loss_reason : null,
      };
      const cf = won && o.customer_id != null && cust.has(o.customer_id) ? cust.get(o.customer_id).fields : noCust;
      Object.assign(row, cf);
      if (row.customer_id) linked.add(row.customer_id);
      records.push(row);
    }
    for (const [cid, { c, acq, fields }] of cust) {
      if (linked.has(cid)) continue;
      records.push(Object.assign({
        row_id: cid, record_type: 'customer_only', lead_id: null, lead_created: null, channel: acq, source_form: null,
        lead_status: null, disqualified_reason: null, owner: null, company: c.name, job_title: null, company_size: null,
        country: c.country, is_mql: null, is_sal: null, opportunity_id: null, opp_created: null, opp_stage: null,
        opp_close: null, opp_won: null, opp_arr: null, loss_reason: null,
      }, fields));
    }

    // Program spend and website sessions by month and Channel (outer join, missing = 0).
    const sp = new Map();
    const key = (m, ch) => `${m}\u0000${ch}`;
    for (const s of S) sp.set(key(s.month, s.channel), { month: s.month, channel: s.channel, program_spend: int(s.spend) || 0, sessions: 0 });
    for (const w of W) {
      const k = key(w.month, w.channel);
      if (!sp.has(k)) sp.set(k, { month: w.month, channel: w.channel, program_spend: 0, sessions: 0 });
      sp.get(k).sessions = int(w.website_sessions) || 0;
    }
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const spend_month = [...sp.values()].filter((r) => r.month <= asOf).sort((a, b) => cmp(a.month, b.month) || cmp(a.channel, b.channel));

    // Sales and marketing payroll cost by month. Salaries are current, deflated 4%/yr before the As-of month.
    const sales = E.filter((e) => e.department === 'Sales');
    const pay = (m, dept) => { const r = P.find((x) => x.month === m && x.department === dept); return r ? int(r.payroll_cost) : null; };
    const months = [...new Set(P.map((r) => r.month))].sort(cmp);
    const cost_month = [];
    for (const m of months) {
      if (m > asOf) continue;
      const defl = Math.pow(1.04, -((monthIndex(asOf) - monthIndex(m)) / 12));
      const first = `${m}-01`, last = monthEnd(m);
      const act = sales.filter((e) => e.start_date <= last && (e.end_date == null || e.end_date >= first));
      const spay = pay(m, 'Sales'), mpay = pay(m, 'Marketing');
      const sum = (xs) => xs.reduce((a, e) => a + num(e.base_salary_usd), 0);
      const load = spay / ((sum(act) * defl) / 12);
      const ae = act.filter((e) => e.title === 'Account Executive');
      const rate = ((sum(ae) / ae.length) * defl * load) / 2080;
      const outb = (rate * 20 * 52) / 12;
      const sdr = (sum(act.filter((e) => e.title === 'Sales Development Rep')) * defl * load) / 12;
      cost_month.push({ month: m, marketing_payroll: mpay, sales_payroll: spay, loading_factor: pyRound(load, 3),
        ae_hourly_loaded: pyRound(rate, 2), outbound_cost: pyRound(outb), sdr_cost: pyRound(sdr), sales_side_cost: pyRound(spay - sdr - outb) });
    }
    return { records, spend_month, cost_month };
  }


  // ---------- join checks ----------
  // Every link the build relies on, checked against the raw files. Each check returns a count, a few
  // examples, and (where they exist in the explorer) the record ids behind it. Checks with 0 are kept so the
  // Data hygiene tab can show what passed.
  function joinChecks(T, records) {
    const L = T.leads, O = T.opportunities, C = T.customers, K = T.contracts, S = T.spend, W = T.funnel, P = T.payroll, E = T.employees;
    const st = (v) => (v == null ? '' : String(v).trim().toLowerCase());
    const group = (rows, k) => { const m = new Map(); for (const r of rows) { if (r[k] == null) continue; if (!m.has(r[k])) m.set(r[k], []); m.get(r[k]).push(r); } return m; };
    const Om = group(O, 'opportunity_id'), Cm = group(C, 'customer_id'), Km = group(K, 'customer_id'), Lm = group(L, 'lead_id');
    const firstOpp = (id) => (Om.get(id) || [])[0];
    // Explorer rows are keyed by row_id: a lead id, or a customer id for customers with no lead. A customer
    // reached through a lead lives on that lead's row, so customer ids are translated to it.
    const recIds = new Set(records.map((r) => r.row_id));
    const rowOfCustomer = new Map(); for (const r of records) if (r.customer_id != null && !rowOfCustomer.has(r.customer_id)) rowOfCustomer.set(r.customer_id, r.row_id);
    const toRow = (x) => (recIds.has(x) ? x : rowOfCustomer.get(x));
    // What each check confirms when it finds nothing.
    const PASS = {
      dup_ids: 'Every lead, opportunity and customer ID is unique',
      lead_opp_missing: 'Every opportunity a lead points to exists',
      lead_opp_not_nb: 'Every lead links to a New business opportunity',
      opp_many_leads: 'No opportunity is claimed by more than one lead',
      status_vs_link: 'Lead status and opportunity links agree',
      channel_lead_opp: 'Each lead\u2019s channel matches its opportunity\u2019s source channel',
      opp_before_lead: 'No opportunity predates the lead linked to it',
      won_no_customer: 'Every won opportunity has a matching customer',
      customer_many_wins: 'No customer is won more than once',
      channel_opp_customer: 'Each won opportunity\u2019s channel matches the customer\u2019s acquisition channel',
      plan_opp_customer: 'Each won opportunity\u2019s plan matches the customer\u2019s plan',
      close_vs_signup: 'Close dates and signup dates line up',
      contracts_link: 'Every contract belongs to a known customer, and every customer has contracts',
      churn_status: 'Customer status and churn dates agree',
      existing_customer_tag: 'Every lead tagged Existing customer matches a customer',
      funnel_reconcile: 'The web funnel file matches the lead and opportunity files, month by month and channel by channel',
      channel_names: 'Spend and funnel files use the same channel names as the leads',
      payroll_months: 'Every payroll month has Sales and Marketing rows',
      owners: 'Every lead and opportunity owner is in the employees file',
    };
    const checks = [];
    const add = (o) => {
      const ids = (o.ids || []).map(toRow).filter((x) => x != null);
      checks.push(Object.assign({ unit: 'records', examples: [], passed: PASS[o.id] }, o, { ids: ids.length ? [...new Set(ids)] : null, examples: (o.examples || []).slice(0, 3) }));
    };
    const withOpp = L.filter((l) => l.opportunity_id != null);
    const leadOf = new Map(); for (const l of withOpp) { if (!leadOf.has(l.opportunity_id)) leadOf.set(l.opportunity_id, []); leadOf.get(l.opportunity_id).push(l); }

    // Keys
    const dupKeys = [['lead_id', Lm, 'leads'], ['opportunity_id', Om, 'opportunities'], ['customer_id', Cm, 'customers']]
      .map(([k, m, f]) => [k, f, [...m.entries()].filter(([, v]) => v.length > 1)]);
    const dupCount = dupKeys.reduce((a, [, , d]) => a + d.length, 0);
    add({ id: 'dup_ids', priority: 'High', area: 'Record IDs', issue: 'The same ID appears on more than one row', count: dupCount, unit: 'IDs',
      affects: 'Joins pick one of the rows and silently ignore the others, so stage counts, ARR and churn can attach to the wrong record.',
      action: 'Find why the export repeats these IDs (merged records, re-imports) and make each ID unique before loading.',
      examples: dupKeys.flatMap(([k, f, d]) => d.map(([id, v]) => `${id} appears ${v.length} times in ${f}.csv`)), ids: dupKeys[0][2].map(([id]) => id) });

    // Lead -> opportunity
    const missingOpp = withOpp.filter((l) => !Om.has(l.opportunity_id));
    add({ id: 'lead_opp_missing', priority: 'High', area: 'Lead → opportunity', issue: 'Leads point to an opportunity ID that isn’t in the opportunities file', count: missingOpp.length, unit: 'leads',
      affects: 'These leads can’t be credited with an Opp or a win, so Opps, Won and their conversion rates are understated for their channels.',
      action: 'Check whether the opportunities export is filtered (by date, owner or type) or the IDs were changed in the CRM.',
      examples: missingOpp.map((l) => `${l.lead_id} → ${l.opportunity_id}`), ids: missingOpp.map((l) => l.lead_id) });
    const notNb = withOpp.filter((l) => Om.has(l.opportunity_id) && firstOpp(l.opportunity_id).type !== 'New business');
    add({ id: 'lead_opp_not_nb', priority: 'Medium', area: 'Lead → opportunity', issue: 'Leads linked to an opportunity that isn’t New business (e.g. a renewal)', count: notNb.length, unit: 'leads',
      affects: 'Only new-business opportunities count in the funnel, so these leads show no Opp. If the type is wrong, Opps and wins are understated.',
      action: 'Confirm the opportunity type. A new lead attached to a renewal is usually a CRM linking mistake.',
      examples: notNb.map((l) => `${l.lead_id} → ${l.opportunity_id} (${firstOpp(l.opportunity_id).type})`), ids: notNb.map((l) => l.lead_id) });
    const shared = [...leadOf.entries()].filter(([id, v]) => v.length > 1 && Om.has(id));
    add({ id: 'opp_many_leads', priority: 'High', area: 'Lead → opportunity', issue: 'Opportunities claimed by more than one lead', count: shared.length, unit: 'opportunities',
      affects: 'Each lead gets credit for the same Opp and win, so Opps, Won and new ARR are double-counted, possibly across two channels.',
      action: 'Decide which lead sourced each deal (usually the earliest) and unlink the others in the CRM.',
      examples: shared.map(([id, v]) => `${id} ← ${v.map((l) => l.lead_id).join(', ')}`), ids: shared.flatMap(([, v]) => v.map((l) => l.lead_id)) });
    const convNoOpp = L.filter((l) => l.status === 'Converted to opportunity' && l.opportunity_id == null);
    const oppNotConv = withOpp.filter((l) => l.status !== 'Converted to opportunity');
    add({ id: 'status_vs_link', priority: 'Medium', area: 'Lead → opportunity', issue: 'Lead status and opportunity link disagree (Converted with no opportunity, or an opportunity on a lead not marked Converted)',
      count: convNoOpp.length + oppNotConv.length, unit: 'leads',
      affects: 'SAL and Opp counts disagree with each other for these leads, which distorts SAL→Opp.',
      action: 'Fix the status or the link on each lead; a converted lead should always carry its opportunity.',
      examples: [...convNoOpp.map((l) => `${l.lead_id} Converted, no opportunity`), ...oppNotConv.map((l) => `${l.lead_id} ${l.status}, has ${l.opportunity_id}`)],
      ids: [...convNoOpp, ...oppNotConv].map((l) => l.lead_id) });
    const chMis = withOpp.filter((l) => Om.has(l.opportunity_id) && firstOpp(l.opportunity_id).source_channel !== l.channel);
    add({ id: 'channel_lead_opp', priority: 'Medium', area: 'Channel attribution', issue: 'Lead channel differs from its opportunity’s source channel', count: chMis.length, unit: 'leads',
      affects: 'Leads, MQLs and SALs are credited to the lead’s channel but Opps and wins to the opportunity’s, so channel conversion rates and cost per customer mix two channels.',
      action: 'Agree which field is the source of truth and correct the other in the CRM.',
      examples: chMis.map((l) => `${l.lead_id} ${l.channel} vs ${l.opportunity_id} ${firstOpp(l.opportunity_id).source_channel}`), ids: chMis.map((l) => l.lead_id) });
    const early = withOpp.filter((l) => Om.has(l.opportunity_id) && l.created_at && firstOpp(l.opportunity_id).created_date < l.created_at.slice(0, 10));
    add({ id: 'opp_before_lead', priority: 'Low', area: 'Lead → opportunity', issue: 'Opportunity created before the lead it is linked to', count: early.length, unit: 'leads',
      affects: 'Timing-based figures (which window an Opp lands in versus its lead) are unreliable, and the lead may not be the real source.',
      action: 'Check whether a later lead was attached to an existing deal; if so, unlink it.',
      examples: early.map((l) => `${l.lead_id} created ${l.created_at.slice(0, 10)}, ${l.opportunity_id} created ${firstOpp(l.opportunity_id).created_date}`), ids: early.map((l) => l.lead_id) });

    // Opportunity -> customer
    const won = O.filter((o) => o.type === 'New business' && o.stage === 'Closed won');
    const wonNoCust = won.filter((o) => o.customer_id == null || !Cm.has(o.customer_id));
    add({ id: 'won_no_customer', priority: 'High', area: 'Opportunity → customer', issue: 'Won new-business opportunities with no matching customer', count: wonNoCust.length, unit: 'opportunities',
      affects: 'The win counts in the funnel, but the customer is missing from churn and ARR lost, so retention looks better than it is.',
      action: 'Find or create the customer record and set the customer ID on the opportunity.',
      examples: wonNoCust.map((o) => `${o.opportunity_id} → ${o.customer_id == null ? 'no customer ID' : o.customer_id + ' (not in customers)'}`),
      ids: wonNoCust.flatMap((o) => (leadOf.get(o.opportunity_id) || []).map((l) => l.lead_id)) });
    const wonBy = group(won.filter((o) => o.customer_id != null), 'customer_id');
    const multiWon = [...wonBy.entries()].filter(([, v]) => v.length > 1);
    add({ id: 'customer_many_wins', priority: 'High', area: 'Opportunity → customer', issue: 'Customers with more than one won new-business opportunity', count: multiWon.length, unit: 'customers',
      affects: 'The customer is counted as won more than once, which inflates wins and new ARR and lowers cost per customer.',
      action: 'Reclassify the later deals as expansion or renewal, or merge duplicate opportunities.',
      examples: multiWon.map(([id, v]) => `${id} ← ${v.map((o) => o.opportunity_id).join(', ')}`), ids: multiWon.map(([id]) => id) });
    const pairs = won.filter((o) => Cm.has(o.customer_id)).map((o) => [o, Cm.get(o.customer_id)[0]]);
    const srcMis = pairs.filter(([o, c]) => c.acquisition_channel != null && o.source_channel !== c.acquisition_channel);
    add({ id: 'channel_opp_customer', priority: 'Medium', area: 'Channel attribution', issue: 'Won opportunity’s source channel differs from the customer’s acquisition channel', count: srcMis.length, unit: 'customers',
      affects: 'Wins are credited to one channel and churn to another, so channel retention and acquisition cost don’t line up.',
      action: 'Align the customer’s acquisition channel with the opportunity that won it.',
      examples: srcMis.map(([o, c]) => `${o.opportunity_id} ${o.source_channel} vs ${c.customer_id} ${c.acquisition_channel}`), ids: srcMis.map(([, c]) => c.customer_id) });
    const planMis = pairs.filter(([o, c]) => o.plan != null && c.plan != null && o.plan !== c.plan);
    add({ id: 'plan_opp_customer', priority: 'Medium', area: 'Opportunity → customer', issue: 'Won opportunity’s plan differs from the customer’s plan', count: planMis.length, unit: 'customers',
      affects: 'Churn by plan uses the customer’s plan; if it’s wrong, plan-level churn and the plan-fit recommendation are off.',
      action: 'Correct the plan on whichever record is wrong (plans don’t change after signup).',
      examples: planMis.map(([o, c]) => `${o.opportunity_id} ${o.plan} vs ${c.customer_id} ${c.plan}`), ids: planMis.map(([, c]) => c.customer_id) });
    const dayGap = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);
    const dateMis = pairs.filter(([o, c]) => o.close_date && c.signup_date && dayGap(o.close_date.slice(0, 10), c.signup_date.slice(0, 10)) > 31);
    add({ id: 'close_vs_signup', priority: 'Low', area: 'Opportunity → customer', issue: 'Won opportunity’s close date is more than a month from the customer’s signup date', count: dateMis.length, unit: 'customers',
      affects: 'Wins and churn cohorts land in different months, so window comparisons between the two drift.',
      action: 'Check which date is right and correct the other.',
      examples: dateMis.map(([o, c]) => `${o.opportunity_id} closed ${o.close_date} vs signup ${c.signup_date}`), ids: dateMis.map(([, c]) => c.customer_id) });

    // Customer -> contracts and status
    const kOrphan = [...Km.keys()].filter((id) => !Cm.has(id));
    const cNoK = C.filter((c) => !Km.has(c.customer_id));
    add({ id: 'contracts_link', priority: 'Medium', area: 'Customer → contracts', issue: 'Contracts with an unknown customer, or customers with no contracts', count: kOrphan.length + cNoK.length, unit: 'records',
      affects: 'ARR lost on churn comes from the last contract; without contracts it is blank, and orphan contracts are ignored.',
      action: 'Match the contracts to their customers, or add the missing contract history to the export.',
      examples: [...kOrphan.map((id) => `contracts for ${id}, not in customers`), ...cNoK.map((c) => `${c.customer_id} has no contracts`)], ids: cNoK.map((c) => c.customer_id) });
    const churnBad = C.filter((c) => (st(c.status) === 'churned') !== (c.churn_date != null));
    add({ id: 'churn_status', priority: 'Medium', area: 'Customer status', issue: 'Customer status and churn date disagree (churned with no date, or a churn date on an active customer)', count: churnBad.length, unit: 'customers',
      affects: 'Churn is counted from the churn date, so these customers are counted the opposite way from what their status says.',
      action: 'Fix the status or the date on each customer.',
      examples: churnBad.map((c) => `${c.customer_id} status ${c.status}, churn date ${c.churn_date || 'none'}`), ids: churnBad.map((c) => c.customer_id) });

    // Tags that refer to another file
    const custNames = new Set(C.map((c) => st(c.name)));
    const exNo = L.filter((l) => l.disqualified_reason === 'Existing customer' && !custNames.has(st(l.company)));
    add({ id: 'existing_customer_tag', priority: 'Medium', area: 'Lead tagging', issue: 'Leads tagged Existing customer whose company matches no customer (exact name match)', count: exNo.length, unit: 'leads',
      affects: 'The tag removes them from MQLs as junk. If they aren’t really customers, MQLs are understated. Some are name variants (e.g. a missing "Group").',
      action: 'Review each: fix the company name to match the customer, or remove the tag if the company isn’t a customer.',
      examples: exNo.map((l) => `${l.lead_id} "${l.company == null ? '(no company)' : l.company}" (${l.status})`), ids: exNo.map((l) => l.lead_id) });

    // Monthly files
    const key = (m, c) => `${m}|${c}`;
    const lc = new Map(); for (const l of L) if (l.created_at) { const k = key(l.created_at.slice(0, 7), l.channel); lc.set(k, (lc.get(k) || 0) + 1); }
    const oc = new Map(); for (const o of O) if (o.type === 'New business' && o.created_date) { const k = key(o.created_date.slice(0, 7), o.source_channel); oc.set(k, (oc.get(k) || 0) + 1); }
    const fMis = W.filter((w) => (w.leads_created != null && (lc.get(key(w.month, w.channel)) || 0) !== +w.leads_created) || (w.opportunities_created != null && (oc.get(key(w.month, w.channel)) || 0) !== +w.opportunities_created));
    add({ id: 'funnel_reconcile', priority: 'Medium', area: 'Cross-file totals', issue: 'Web funnel file disagrees with the lead or opportunity files for some months and channels', count: fMis.length, unit: 'month × channel rows',
      affects: 'Two sources report different lead or Opp counts, so one of them is incomplete; the dashboard counts from the lead and opportunity files.',
      action: 'Find which export is missing rows for those months and channels.',
      examples: fMis.map((w) => `${w.month} ${w.channel}: funnel ${w.leads_created} leads / ${w.opportunities_created} opps vs files ${lc.get(key(w.month, w.channel)) || 0} / ${oc.get(key(w.month, w.channel)) || 0}`) });
    const leadCh = new Set(L.map((l) => l.channel).filter((x) => x != null));
    const strayCh = [...new Set([...S.map((r) => r.channel), ...W.map((r) => r.channel)].filter((x) => x != null && !leadCh.has(x)))];
    add({ id: 'channel_names', priority: 'High', area: 'Channel attribution', issue: 'Channel names in the spend or funnel files that no lead uses', count: strayCh.length, unit: 'channel names',
      affects: 'Spend under a name the dashboard doesn’t recognise is dropped from demand gen cost, so cost-per figures are understated.',
      action: 'Use the same channel names in every export (e.g. paid_search, not Paid Search).',
      examples: strayCh.map((c) => `"${c}"`) });
    const pm = group(P, 'month');
    const badMonths = [...pm.entries()].filter(([, v]) => !v.some((r) => r.department === 'Sales') || !v.some((r) => r.department === 'Marketing')).map(([m]) => m);
    add({ id: 'payroll_months', priority: 'High', area: 'Cost data', issue: 'Payroll months missing a Sales or Marketing row', count: badMonths.length, unit: 'months',
      affects: 'Marketing payroll, SDR, outbound and sales-side cost are missing for those months, so CAC is understated.',
      action: 'Add the missing department rows to the payroll export.',
      examples: badMonths });
    const staff = new Set(E.map((e) => e.name));
    const ghost = [...new Set([...L.map((l) => l.owner), ...O.map((o) => o.owner)].filter((x) => x != null && !staff.has(x)))];
    add({ id: 'owners', priority: 'Low', area: 'People', issue: 'Lead or opportunity owners not in the employees file', count: ghost.length, unit: 'names',
      affects: 'No effect on counts or costs; it limits rep-level analysis and suggests the employee list is out of date or names are spelled differently.',
      action: 'Update the employees export or correct the owner names.',
      examples: ghost });
    return checks;
  }

  // ---------- entry point ----------
  // files: [{name, text}]. Returns {datasets, asOf, asOfDate, first, setBy, files, health, errors}.
  function ingest(files) {
    const errors = []; const T = {}; const found = {};
    for (const f of files) {
      const { header, rows } = parseCsv(f.text);
      const k = kindOf(header);
      if (!k) { errors.push(`${f.name}: not one of the 8 expected data room files (its columns don't match any of them).`); continue; }
      if (T[k]) { errors.push(`${f.name}: a second ${KINDS[k].label} (already loaded from ${found[k]}).`); continue; }
      const missing = KINDS[k].need.filter((c) => !header.includes(c));
      if (missing.length) { errors.push(`${f.name} (${KINDS[k].label}): missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`); continue; }
      T[k] = rows; found[k] = f.name;
    }
    for (const k of Object.keys(KINDS)) if (!T[k] && !errors.some((e) => e.includes(KINDS[k].label))) errors.push(`Missing file: ${KINDS[k].label}.`);
    if (errors.length) return { errors, files: found };

    const a = asOfMonth(T.leads, T.spend, T.payroll);
    const datasets = build(T, a.month);
    datasets.join_checks = joinChecks(T, datasets.records);
    const months = [];
    for (const r of datasets.records) { if (r.lead_created) months.push(ym(r.lead_created)); if (r.signup_date) months.push(ym(r.signup_date)); }
    const first = months.reduce((x, y) => (y < x ? y : x), a.month);
    return { datasets, asOf: a.month, asOfDate: monthEnd(a.month), first, setBy: a.setBy, asOfByFile: a.byFile, files: found, health: {}, errors: [] };
  }

  return { parseCsv, ingest, joinChecks, KINDS, kindOf, addMonthsDate, monthEnd, pyRound };
})();
