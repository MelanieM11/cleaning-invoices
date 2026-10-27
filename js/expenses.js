/* Business expenses and a quarterly BAS summary (G1, 1A, 1B) for the cleaning work. */
(() => {
  const A = window.App;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const CATEGORIES = [
    'Cleaning supplies', 'Equipment', 'Phone & internet', 'Car & fuel', 'Parking & tolls',
    'Uniform & clothing', 'Insurance', 'Other',
  ];

  A.state.expenses ||= [];

  // ---------- quarters (Australian financial year: Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun) ----------
  function quarterOf(dateStr) {
    const d = A.parseISO(dateStr);
    const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
    const start = new Date(d.getFullYear(), qStartMonth, 1);
    const end = new Date(d.getFullYear(), qStartMonth + 3, 0);
    // BAS due the 28th of the month after the quarter; Oct–Dec is due 28 February.
    const due = qStartMonth === 9 ? new Date(d.getFullYear() + 1, 1, 28) : new Date(d.getFullYear(), qStartMonth + 4, 28);
    const fyStart = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
    const qNum = { 6: 1, 9: 2, 0: 3, 3: 4 }[qStartMonth];
    const m = (x) => x.toLocaleDateString('en-AU', { month: 'short' });
    return {
      start: A.iso(start), end: A.iso(end), due: A.iso(due),
      label: `${m(start)}–${m(end)} ${end.getFullYear()}`,
      fy: `Q${qNum} FY${fyStart}–${String(fyStart + 1).slice(2)}`,
    };
  }
  function shiftQuarter(q, dir) {
    const d = A.parseISO(dir > 0 ? q.end : q.start);
    d.setDate(d.getDate() + dir);
    return quarterOf(A.iso(d));
  }
  let quarter = quarterOf(A.iso(new Date()));

  // ---------- figures ----------
  function gstCredit(x) {
    if (!x.includesGst) return 0;
    return A.round2((+x.amount || 0) * ((+x.businessPct || 0) / 100) / 11);
  }

  // Cleaning invoices that belong to the quarter: by expected payment date (cash basis)
  // or by the end of the billing period (accrual basis).
  function invoicesIn(q) {
    const cash = A.state.settings.gstBasis !== 'accrual';
    const out = [];
    let p = A.periodOf(q.start);
    for (let i = 0; i < 3; i++) {
      const prev = A.parseISO(p.start);
      prev.setDate(prev.getDate() - 1);
      p = A.periodOf(A.iso(prev));
    }
    while (p.start <= q.end) {
      const when = cash ? p.pay : p.end;
      if (when >= q.start && when <= q.end && A.jobsIn(p).length) out.push({ p, inv: A.buildInvoice(p), when });
      const next = A.parseISO(p.end);
      next.setDate(next.getDate() + 1);
      p = A.periodOf(A.iso(next));
    }
    return out;
  }

  function expensesIn(q) {
    return A.state.expenses
      .filter((x) => x.date >= q.start && x.date <= q.end)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  }

  function bas(q) {
    const invoices = invoicesIn(q);
    const expenses = expensesIn(q);
    return {
      invoices, expenses,
      g1: A.round2(invoices.reduce((s, x) => s + x.inv.t.payable, 0)),
      gst1A: A.round2(invoices.reduce((s, x) => s + x.inv.t.gst, 0)),
      gst1B: A.round2(expenses.reduce((s, x) => s + gstCredit(x), 0)),
      spent: A.round2(expenses.reduce((s, x) => s + (+x.amount || 0) * ((+x.businessPct || 0) / 100), 0)),
    };
  }

  // ---------- screen ----------
  function renderExpenses() {
    A.loadExcel().catch(() => {});
    $('#exp-quarter-label').textContent = quarter.label;
    $('#exp-quarter-due').textContent = `${quarter.fy} · BAS due ${A.fmtDate(quarter.due, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const b = bas(quarter);
    const row = (code, lbl, val, cls = '') =>
      `<div class="sum-row ${cls}"><span class="lbl"><b class="code">${code}</b> ${lbl}</span><span>${A.money(val)}</span></div>`;
    const basis = A.state.settings.gstBasis === 'accrual' ? 'accrual (when invoiced)' : 'cash (when paid)';
    $('#bas-summary').innerHTML =
      row('G1', 'Total sales (incl. GST)', b.g1) +
      row('1A', 'GST on sales', b.gst1A) +
      row('1B', 'GST on purchases', b.gst1B) +
      row('', 'GST to pay (1A − 1B)', A.round2(b.gst1A - b.gst1B), 'total') +
      `<p class="hint">${b.invoices.length} invoice${b.invoices.length === 1 ? '' : 's'} counted on a ${basis} basis` +
      (b.invoices.length ? `: ${b.invoices.map((x) => A.esc(x.p.short)).join(', ')}` : '') +
      `. Add your rideshare figures to each box.</p>` +
      (A.state.settings.gstRegistered ? '' : '<div class="warn">GST is off in Settings, so 1A shows $0.</div>');

    const list = $('#expenses-list');
    if (!b.expenses.length) {
      list.innerHTML = '<div class="empty">No expenses this quarter.<br>Tap <b>+ Add expense</b> when you buy something for work.</div>';
      return;
    }
    list.innerHTML = b.expenses.map((x) => {
      const credit = gstCredit(x);
      const pct = +x.businessPct === 100 ? '' : ` · ${+x.businessPct}% business`;
      return `<button class="job" data-id="${x.id}">
        <div class="main"><div class="addr">${A.esc(x.supplier || x.category)}</div>
          <div class="meta">${A.fmtDate(x.date)} · ${A.esc(x.category)}${pct}</div></div>
        <div class="amt">${A.money(+x.amount || 0)}<small>${x.includesGst ? `GST ${A.money(credit)}` : 'no GST'}</small></div>
      </button>`;
    }).join('');
    $$('#expenses-list .job').forEach((el) => el.addEventListener('click', () => openExpense(A.state.expenses.find((x) => x.id === el.dataset.id))));
  }
  A.renderExpenses = renderExpenses;

  $('#exp-prev').onclick = () => { quarter = shiftQuarter(quarter, -1); renderExpenses(); };
  $('#exp-next').onclick = () => { quarter = shiftQuarter(quarter, 1); renderExpenses(); };

  // ---------- expense sheet ----------
  const dlg = $('#expense-dialog');
  const form = $('#expense-form');
  let editing = null;
  form.category.innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');

  function formExpense() {
    return {
      date: form.date.value,
      supplier: form.supplier.value.trim(),
      category: form.category.value,
      amount: form.amount.value === '' ? '' : +form.amount.value,
      includesGst: form.includesGst.checked,
      businessPct: form.businessPct.value === '' ? 100 : Math.min(100, Math.max(0, +form.businessPct.value)),
      notes: form.notes.value.trim(),
    };
  }
  function updateCredit() {
    const x = formExpense();
    $('#expense-credit').innerHTML = `GST you can claim (1B): <strong>${A.money(gstCredit(x))}</strong>` +
      (+x.amount > 82.5 && x.includesGst ? '<br><small>Over $82.50: keep the tax invoice/receipt.</small>' : '') +
      (x.category === 'Car & fuel' ? '<br><small>Don\'t enter car costs here if the rideshare app already claims them.</small>' : '');
  }

  function openExpense(x) {
    editing = x || null;
    form.reset();
    const today = A.iso(new Date());
    const v = x || { date: today >= quarter.start && today <= quarter.end ? today : quarter.start, category: CATEGORIES[0], includesGst: true, businessPct: 100 };
    form.date.value = v.date;
    form.supplier.value = v.supplier || '';
    form.category.value = v.category;
    form.amount.value = v.amount ?? '';
    form.includesGst.checked = v.includesGst !== false;
    form.businessPct.value = v.businessPct ?? 100;
    form.notes.value = v.notes || '';
    $('#expense-dialog-title').textContent = x ? 'Edit expense' : 'Add expense';
    $('#delete-expense').hidden = !x;
    updateCredit();
    dlg.showModal();
  }
  $('#add-expense').onclick = () => openExpense(null);
  form.addEventListener('input', updateCredit);
  form.addEventListener('change', updateCredit);
  form.addEventListener('submit', (e) => {
    const x = formExpense();
    if (!x.date || x.amount === '') { e.preventDefault(); A.toast('Add the date and amount'); return; }
    if (editing) Object.assign(editing, x);
    else A.state.expenses.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), created: Date.now(), ...x });
    A.save();
    quarter = quarterOf(x.date);
    renderExpenses();
    A.toast(editing ? 'Expense updated' : `Saved · GST ${A.money(gstCredit(x))}`);
  });
  $('#delete-expense').onclick = () => {
    if (!editing || !confirm('Delete this expense?')) return;
    A.state.expenses = A.state.expenses.filter((x) => x !== editing);
    A.save();
    dlg.close();
    renderExpenses();
    A.toast('Expense deleted');
  };

  // ---------- Excel export for the quarter ----------
  $('#exp-download').onclick = async () => {
    try {
      await A.loadExcel();
      const b = bas(quarter);
      const wb = new ExcelJS.Workbook();
      const MONEY = '"$"#,##0.00';
      const head = (ws, cols) => {
        const r = ws.addRow(cols);
        r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF156082' } }; });
      };
      const xDate = (s) => { const d = A.parseISO(s); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

      const s1 = wb.addWorksheet('BAS summary');
      s1.columns = [{ width: 34 }, { width: 16 }];
      s1.addRow([`BAS summary – cleaning – ${quarter.label} (${quarter.fy})`]).font = { bold: true, size: 13 };
      s1.addRow([`GST basis: ${A.state.settings.gstBasis === 'accrual' ? 'accrual' : 'cash'}`]);
      s1.addRow([]);
      for (const [k, v] of [['G1 Total sales (incl. GST)', b.g1], ['1A GST on sales', b.gst1A], ['1B GST on purchases', b.gst1B], ['GST to pay (1A − 1B)', A.round2(b.gst1A - b.gst1B)]]) {
        const r = s1.addRow([k, v]);
        r.getCell(2).numFmt = MONEY;
      }

      const s2 = wb.addWorksheet('Invoices');
      s2.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }];
      head(s2, ['Period', 'Invoice No', 'Counted on', 'Excl. GST', 'GST', 'Total incl. GST']);
      for (const x of b.invoices) {
        const r = s2.addRow([x.p.label, x.inv.number, xDate(x.when), x.inv.t.total, x.inv.t.gst, x.inv.t.payable]);
        r.getCell(3).numFmt = 'dd/mm/yyyy';
        [4, 5, 6].forEach((i) => { r.getCell(i).numFmt = MONEY; });
      }

      const s3 = wb.addWorksheet('Expenses');
      s3.columns = [{ width: 12 }, { width: 28 }, { width: 18 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 30 }];
      head(s3, ['Date', 'Supplier / item', 'Category', 'Amount paid', 'Has GST', 'Business %', 'GST credit', 'Notes']);
      for (const x of b.expenses) {
        const r = s3.addRow([xDate(x.date), x.supplier, x.category, +x.amount || 0, x.includesGst ? 'Yes' : 'No', (+x.businessPct || 0) / 100, gstCredit(x), x.notes]);
        r.getCell(1).numFmt = 'dd/mm/yyyy';
        r.getCell(4).numFmt = MONEY; r.getCell(6).numFmt = '0%'; r.getCell(7).numFmt = MONEY;
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      await A.deliver(blob, `BAS_${quarter.label.replace(/[^\w]+/g, '_')}.xlsx`, { share: true });
    } catch (e) {
      console.error(e);
      A.toast('Could not make the file');
    }
  };

  // exposed for testing
  A.bas = () => bas(quarter);
})();
