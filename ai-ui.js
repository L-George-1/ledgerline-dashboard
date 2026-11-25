// AI recommendations card on the Summary tab: key entry, preview-and-confirm, and the answer.
// Claude is called only from the Send button in the preview, never on load or on a filter change.
(() => {
  const AI = window.mkAI, M = window.mk;
  const $ = (id) => document.getElementById(id);
  const keyIn = $('ai-key'), keyRow = $('ai-key-row'), ready = $('ai-ready'), status = $('ai-status'), result = $('ai-result');
  const dlg = $('ai-preview');
  let pending = null; // the exact request body shown in the preview
  let busy = false;

  const setStatus = (text, isError) => { status.textContent = text; status.classList.toggle('mk-error', !!isError); };
  const li = (parent, build) => { const el = document.createElement('li'); build(el); parent.append(el); };
  function showLocked(locked) { keyRow.hidden = !locked; ready.hidden = locked; }

  // A pasted key moves into mkAI's memory on the first Generate click, and the field is cleared.
  function takeKey() {
    if (AI.hasKey()) return true;
    if (!AI.setKey(keyIn.value)) { setStatus('Paste your Anthropic API key first, then click Generate.', true); keyIn.focus(); return false; }
    keyIn.value = '';
    showLocked(false); setStatus('');
    return true;
  }
  keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ai-generate').click(); });
  $('ai-forget').addEventListener('click', () => { AI.clearKey(); showLocked(true); setStatus('Key forgotten.'); });

  $('ai-generate').addEventListener('click', () => {
    if (busy) return;
    if (!takeKey()) return;
    const payload = AI.buildPayload();
    pending = AI.buildRequest(payload);
    $('ai-prev-model').textContent = AI.MODEL;
    const secs = $('ai-prev-sections'); secs.replaceChildren();
    li(secs, (el) => { el.innerHTML = '<b>Settings:</b> '; el.append(`as-of month ${payload.as_of}; demand gen window ${M.monthLabel(payload.demand_gen_window.start)} to ${M.monthLabel(payload.demand_gen_window.end)}; churn cohort ${M.monthLabel(payload.churn_cohort_signups.start)} to ${M.monthLabel(payload.churn_cohort_signups.end)}; targets; marketing payroll split.`); });
    for (const [id, desc] of AI.SECTIONS) {
      const rows = payload.data[id]; if (!rows) continue;
      const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      li(secs, (el) => { const b = document.createElement('b'); b.textContent = desc; el.append(b, ` (${rows.length} row${rows.length === 1 ? '' : 's'}): ${fields.join(', ')}`); });
    }
    $('ai-prev-summary').textContent = `No record rows are included: no lead, opportunity or customer names, companies, emails or IDs. Status and reason labels outside the known lists are sent as "Other". About ${Math.round(JSON.stringify(pending).length / 1000)} KB in total.`;
    $('ai-prev-json').textContent = JSON.stringify(payload, null, 2);
    const st = AI.settingsOf(pending);
    $('ai-prev-instructions').textContent = `Settings: ${JSON.stringify(st, null, 2)}\n\nSystem instructions:\n${pending.system}\n\nRequest text (the figures above follow it):\n${AI.instruction()}`;
    $('ai-prev-body').textContent = JSON.stringify(pending, null, 2);
    $('ai-prev-fallback').textContent = pending.fallbacks
      ? `If ${AI.MODEL}'s safety filter declines the request, Anthropic may answer with its recommended fallback model instead. The model that actually answered is shown with the result.`
      : '';
    dlg.showModal();
  });

  $('ai-cancel').addEventListener('click', () => { pending = null; dlg.close(); setStatus('Cancelled. Nothing was sent.'); });
  dlg.addEventListener('cancel', () => { pending = null; setStatus('Cancelled. Nothing was sent.'); });

  $('ai-send').addEventListener('click', async () => {
    const body = pending; pending = null; dlg.close();
    if (!body) return;
    busy = true; $('ai-generate').disabled = true; $('ai-generate').textContent = 'Generating…';
    setStatus('Asking Claude… this usually takes 20 to 60 seconds.');
    try {
      const { result: r, model } = await AI.send(body);
      render(r, model);
      setStatus('');
    } catch (e) {
      setStatus(e instanceof AI.AIError ? e.message : 'Something went wrong: ' + e.message, true);
    } finally { busy = false; $('ai-generate').disabled = false; $('ai-generate').textContent = 'Generate AI recommendations'; }
  });

  const LEVELS = ['high', 'medium', 'low'];
  const lvl = (v) => (LEVELS.includes(v) ? v : 'medium');
  const cap = (v) => v.charAt(0).toUpperCase() + v.slice(1);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // Topic colors for the findings groups, in display order.
  const TOPIC_COLOR = { 'Funnel conversion': '#304659', 'Channel efficiency': '#F54D46', 'CAC and benchmarks': '#101E28', 'Retention and churn': '#A35F00', 'Data quality': '#61717A' };

  function render(r, model) {
    const rec = $('ai-recs-list'), f = $('ai-findings'), cav = $('ai-caveats');
    rec.replaceChildren(); f.replaceChildren(); cav.replaceChildren();

    for (const x of r.recommendations || []) {
      const imp = lvl(x.impact), conf = lvl(x.confidence);
      const card = el('li', `mk-rec mk-rec-${imp}`);
      card.append(el('p', 'mk-rec-title', x.action));
      const tags = el('div', 'mk-rec-tags');
      tags.append(el('span', `mk-imp mk-imp-${imp}`, `${cap(imp)} impact`), el('span', `mk-conf mk-conf-${conf}`, `${cap(conf)} confidence`));
      if (x.area) tags.append(el('span', 'mk-area-tag', M.label(x.area)));
      card.append(tags);
      const ev = el('ul'); for (const e of (Array.isArray(x.evidence) ? x.evidence : [x.evidence]).filter(Boolean)) ev.append(el('li', null, e));
      card.append(ev);
      if (x.impact_detail) card.append(el('p', 'mk-rec-impact', x.impact_detail));
      rec.append(card);
    }

    const groups = new Map();
    for (const x of r.findings || []) { const c = AI.CATEGORIES.includes(x.category) ? x.category : 'Other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(x); }
    for (const c of [...AI.CATEGORIES, 'Other']) {
      const items = groups.get(c); if (!items) continue;
      const g = el('section', 'mk-fgroup'); g.style.setProperty('--fc', TOPIC_COLOR[c] || '#61717A');
      g.append(el('h4', null, c));
      const ul = el('ul');
      for (const x of items) { const li = el('li'); li.append(el('b', null, x.headline), x.detail); ul.append(li); }
      g.append(ul); f.append(g);
    }

    for (const x of r.caveats || []) cav.append(el('li', null, x));
    if (!(r.caveats || []).length) cav.append(el('li', null, 'None noted.'));
    const w = M.tab2Window();
    $('ai-meta').textContent = `Generated by ${model || AI.MODEL} from the ${M.monthLabel(w.start)} to ${M.monthLabel(w.end)} figures at ${new Date().toLocaleTimeString()}. AI output can be wrong: check it against the dashboard before acting.`;
    result.hidden = false;
  }
})();
