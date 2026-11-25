// Data hygiene tab: draws the data_hygiene calc as a ranked investigation queue.
(() => {
  const M = window.mk;
  const D = () => dash.data('data_hygiene');
  const cell = (tr, text, cls) => { const td = document.createElement('td'); if (text != null) td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };

  dash.draw('hyg-summary', (el) => {
    const d = D(); if (d.status !== 'ok') { el.textContent = d.status === 'error' ? 'Failed to load.' : '—'; return; }
    const by = (p) => d.data.filter((x) => x.priority === p).length;
    const hi = by('High'), md = by('Medium'), lo = by('Low');
    el.textContent = d.data.length
      ? `${hi + md + lo} issue${hi + md + lo === 1 ? '' : 's'} to investigate: ${hi} high, ${md} medium and ${lo} low priority${by('Info') ? `, plus ${by('Info')} known data gap to keep in mind` : ''}. High-priority issues change the headline funnel and cost figures.`
      : 'No known data hygiene issues found in these files.';
  });

  // The cross-file checks that found nothing, so the team can see what was checked.
  dash.draw('hyg-passed', (el) => {
    const d = dash.data('join_checks'); el.replaceChildren(); if (d.status !== 'ok') return;
    const passed = d.data.filter((j) => !j.count), failed = d.data.length - passed.length;
    const p = document.createElement('p');
    p.textContent = `${d.data.length} cross-file checks ran on these files: ${passed.length} passed${failed ? `, ${failed} found issues (listed above)` : ''}.`;
    const ul = document.createElement('ul'); ul.className = 'mk-passed';
    for (const j of passed) { const li = document.createElement('li'); const b = document.createElement('span'); b.className = 'mk-area'; b.textContent = j.area; li.append('✓ ' + j.passed, b); ul.append(li); }
    el.append(p, ul);
  });

  dash.draw('hyg-rows', (tb) => {
    const d = D(); tb.replaceChildren(); if (d.status !== 'ok') return;
    d.data.forEach((x, i) => {
      const tr = tb.insertRow();
      cell(tr, String(i + 1));
      const p = cell(tr); const chip = document.createElement('span'); chip.className = `mk-pri mk-pri-${x.priority}`; chip.textContent = x.priority; p.append(chip);
      const is = cell(tr, x.issue); const area = document.createElement('span'); area.className = 'mk-area'; area.textContent = x.area; is.append(area);
      if (x.examples && x.examples.length) {
        const ex = document.createElement('span'); ex.className = 'mk-examples';
        ex.textContent = 'e.g. ' + x.examples.join('; ');
        is.append(ex);
      }
      const c = cell(tr, null, 'mk-r');
      const txt = `${x.count.toLocaleString('en-US')} ${x.unit}`;
      const note = x.spec && x.spec.ids ? `Data hygiene: the ${x.spec.ids.split(',').length.toLocaleString('en-US')} records behind "${x.issue}". Change any filter to clear this list.` : `Data hygiene: ${x.issue}. All dates.`;
      if (x.spec) M.fill(c, txt, { drill: Object.assign({ note }, x.spec) }); else c.textContent = txt;
      cell(tr, x.affects);
      cell(tr, x.action);
    });
  });
})();
