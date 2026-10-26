/* Invoice building: summary screen, Excel (same layout as the company template) and PDF. */
(() => {
  const A = window.App;
  const $ = (s) => document.querySelector(s);
  const BRAND = '156082';
  const GREEN = '92D050';

  // ---------- data ----------
  function build(p) {
    const jobs = A.jobsIn(p);
    const cleans = { regular: [], sunday: [], holiday: [] };
    const fixed = [], extras = [], deductions = [];
    for (const j of jobs) {
      if (j.kind === 'clean') cleans[A.dayTypeOf(j)].push(j);
      else if (j.kind === 'fixed') fixed.push(j);
      else if (j.kind === 'extra') extras.push(j);
      else if (j.kind === 'deduction') deductions.push(j);
    }
    const sum = (arr) => A.round2(arr.reduce((s, j) => s + A.earn(j), 0));
    const t = {
      companyCharge: A.round2(jobs.filter((j) => j.kind === 'clean').reduce((s, j) => s + (+j.price || 0), 0)),
      regular: sum(cleans.regular), sunday: sum(cleans.sunday), holiday: sum(cleans.holiday),
      fixed: sum(fixed), extras: sum(extras), deductions: -sum(deductions),
    };
    t.total = A.round2(t.regular + t.sunday + t.holiday + t.fixed + t.extras - t.deductions);
    // GST-registered: the agreement's prices are excl. GST, so 10% GST goes on top of the total.
    const gst = !!A.state.settings.gstRegistered;
    t.gst = gst ? A.round2(t.total * 0.1) : 0;
    t.payable = A.round2(t.total + t.gst);
    return {
      gst, title: gst ? 'Tax Invoice' : 'Subcontractors Invoice', issued: A.iso(new Date()), p, jobs, cleans, fixed, extras, deductions, t, number: A.invoiceNumberFor(p), s: A.state.settings };
  }

  // ---------- summary screen ----------
  A.renderInvoice = () => {
    const inv = build(A.period);
    const { t } = inv;
    const num = $('#inv-number');
    if (document.activeElement !== num) num.value = inv.number;

    const row = (lbl, val, cls = '') => `<div class="sum-row ${cls}"><span class="lbl">${lbl}</span><span>${A.money(val)}</span></div>`;
    const n = (arr) => `${arr.length} job${arr.length === 1 ? '' : 's'}`;
    let html = row(COMPANY.chargeLabel, t.companyCharge);
    html += row(`Regular cleans ${pctLabel('regular')} · ${n(inv.cleans.regular)}`, t.regular);
    if (inv.cleans.sunday.length) html += row(`Sunday cleans ${pctLabel('sunday')} · ${n(inv.cleans.sunday)}`, t.sunday);
    if (inv.cleans.holiday.length) html += row(`Public holiday ${pctLabel('holiday')} · ${n(inv.cleans.holiday)}`, t.holiday);
    if (inv.fixed.length) html += row('Net value (fixed amounts)', t.fixed);
    if (inv.extras.length) html += row('Extra charges', t.extras);
    if (inv.deductions.length) html += row('Deductions', -t.deductions);
    if (inv.gst) {
      html += row('Total excl. GST', t.total);
      html += row('GST (10%)', t.gst);
      html += row('Total to be paid (incl. GST)', t.payable, 'total');
    } else {
      html += row('Total to be paid', t.total, 'total');
    }
    $('#inv-summary').innerHTML = html;

    const s = inv.s;
    const warnings = [];
    if (!A.state.priceList) warnings.push('Load your price list in Settings.');
    if (!inv.jobs.length) warnings.push('No jobs in this period yet.');
    if (!s.name) warnings.push('Add your name in Settings.');
    if (!s.abn) warnings.push('Add your ABN in Settings.');
    if (inv.gst && t.payable >= 1000 && !COMPANY.abn) warnings.push('Tax invoices of $1,000 or more need the company\'s ABN: load the latest price list file.');
    if (!s.bsb || !s.accountNumber) warnings.push('Add your bank details in Settings so you get paid.');
    $('#inv-warnings').innerHTML = warnings.map((w) => `<div class="warn">${A.esc(w)}</div>`).join('');

    const subject = `Invoice ${inv.number} – ${s.name || 'Subcontractor'} – ${inv.p.label}`;
    const body = `Hi,\n\nPlease find attached my invoice ${inv.number} for ${inv.p.label}.\nTotal: ${A.money(t.payable)}${inv.gst ? ' (incl. GST)' : ''}\n\nKind regards,\n${s.name || ''}\n${s.phone || ''}`;
    $('#email-link').href = `mailto:${encodeURIComponent(s.invoiceEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    preload();
  };

  $('#inv-number').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (v) { A.state.invoiceNumbers[A.period.key] = v; A.save(); }
  });

  // ---------- library loading ----------
  const loaded = {};
  function loadScript(src) {
    return (loaded[src] ||= new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); };
      document.head.appendChild(el);
    }));
  }
  const loadExcel = () => loadScript('vendor/exceljs.min.js');
  const loadPdf = () => loadScript('vendor/jspdf.umd.min.js').then(() => loadScript('vendor/jspdf.plugin.autotable.min.js'));
  function preload() { loadExcel().catch(() => {}); loadPdf().catch(() => {}); }

  // ---------- Excel ----------
  const xDate = (s) => { const d = A.parseISO(s); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

  async function makeXlsx(inv) {
    await loadExcel();
    const wb = new ExcelJS.Workbook();
    wb.creator = inv.s.name || 'Subcontractor';
    const ws = wb.addWorksheet('SUBCONTRACTOR INVOICE', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = [3, 12, 42, 28, 34, 20, 15, 15, 17].map((width) => ({ width }));
    const MONEY = '"$"#,##0.00';
    const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } });
    const white = { bold: true, color: { argb: 'FFFFFFFF' } };
    let r = 1;

    const bar = (text, color, from = 'B', to = 'I') => {
      ws.mergeCells(`${from}${r}:${to}${r}`);
      const c = ws.getCell(`${from}${r}`);
      c.value = text; c.fill = fill(color); c.font = color === GREEN ? { bold: true } : white;
      c.alignment = { horizontal: 'center' };
      r++;
    };
    const headers = (cols) => {
      for (const [col, text] of Object.entries(cols)) {
        const c = ws.getCell(`${col}${r}`);
        c.value = text; c.fill = fill(BRAND); c.font = white; c.border = box;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
      ws.getRow(r).height = 30;
      r++;
    };
    const cell = (addr, value, opts = {}) => {
      const c = ws.getCell(addr);
      c.value = value;
      if (opts.money) c.numFmt = MONEY;
      if (opts.pct) c.numFmt = '0%';
      if (opts.date) c.numFmt = 'dd/mm/yyyy';
      if (opts.bold) c.font = { bold: true, ...(opts.color ? { color: { argb: 'FF' + opts.color } } : {}) };
      if (opts.border !== false) c.border = box;
      if (opts.wrap) c.alignment = { wrapText: true, vertical: 'top' };
      return c;
    };

    // Header (rows 1–13 like the template)
    r = 3;
    ws.mergeCells('D3:F3');
    Object.assign(ws.getCell('D3'), { value: inv.title, font: { bold: true, size: 20, color: { argb: 'FF' + BRAND } }, alignment: { horizontal: 'center' } });
    ws.getCell('B8').value = 'Bill to:'; ws.getCell('B8').font = { bold: true };
    ws.getCell('F8').value = 'From:'; ws.getCell('F8').font = { bold: true };
    const billTo = billToRows();
    const from = fromRows(inv);
    billTo.forEach(([k, v], i) => { ws.getCell(`B${9 + i}`).value = k; ws.getCell(`C${9 + i}`).value = v; });
    from.forEach(([k, v], i) => { ws.getCell(`F${9 + i}`).value = k; ws.getCell(`F${9 + i}`).font = { bold: true }; ws.getCell(`G${9 + i}`).value = v || ''; });
    ws.getCell('B14').value = 'Invoice Details'; ws.getCell('B14').font = { bold: true };

    // Cleans
    r = 16;
    bar('Description', BRAND);
    headers({ B: 'Date', C: 'Property Address', D: 'Service', E: 'Description', F: 'comments', G: 'Company Charge', H: 'Subcontractor Revenue Percentage', I: 'Total Subcontractor Profit' });

    const cleanSection = (title, list, pct) => {
      bar(title, GREEN);
      const first = r;
      const rows = list.length ? list : [null];
      for (const j of rows) {
        if (j) {
          cell(`B${r}`, xDate(j.date), { date: true });
          cell(`C${r}`, j.address, { wrap: true });
          cell(`D${r}`, `${j.service} (${A.bedLabel(j.bedrooms)})`, { wrap: true });
          cell(`E${r}`, j.description, { wrap: true });
          cell(`F${r}`, j.comments, { wrap: true });
          cell(`G${r}`, +j.price || 0, { money: true });
        } else {
          ['B', 'C', 'D', 'E', 'F'].forEach((c) => cell(`${c}${r}`, ''));
          cell(`G${r}`, 0, { money: true });
        }
        cell(`H${r}`, pct, { pct: true });
        cell(`I${r}`, { formula: `ROUND(G${r}*H${r},2)`, result: j ? A.earn(j) : 0 }, { money: true });
        r++;
      }
      const total = A.round2(list.reduce((s, j) => s + A.earn(j), 0));
      cell(`H${r}`, 'Subtotal', { bold: true });
      const c = cell(`I${r}`, { formula: `SUM(I${first}:I${r - 1})`, result: total }, { money: true, bold: true });
      r++;
      return { first, last: r - 2, totalCell: c.address };
    };
    const reg = cleanSection('Regular Cleans', inv.cleans.regular, RATES.regular.pct);
    const sun = cleanSection('Sunday Cleans', inv.cleans.sunday, RATES.sunday.pct);
    const hol = cleanSection('Public Holiday', inv.cleans.holiday, RATES.holiday.pct);
    const chargeCell = `G${r}`;
    cell(chargeCell, { formula: `SUM(G${reg.first}:G${hol.last})`, result: inv.t.companyCharge }, { money: true, bold: true });
    cell(`F${r}`, 'Total', { bold: true });
    const profitCell = `I${r}`;
    cell(profitCell, { formula: `${reg.totalCell}+${sun.totalCell}+${hol.totalCell}`, result: A.round2(inv.t.regular + inv.t.sunday + inv.t.holiday) }, { money: true, bold: true });
    r += 3;

    // Net value (fixed amounts)
    bar('Net value for the subcontractor', BRAND, 'B', 'H');
    headers({ B: 'Date', C: 'Property Address', D: 'Service', E: 'Description', F: 'Comments', H: 'Total Amount' });
    ws.mergeCells(`F${r - 1}:G${r - 1}`);
    let first = r;
    for (const j of inv.fixed.length ? inv.fixed : [null]) {
      cell(`B${r}`, j ? xDate(j.date) : '', { date: true });
      cell(`C${r}`, j?.address || '', { wrap: true });
      cell(`D${r}`, j?.service && j.kind === 'clean' ? j.service : '', { wrap: true });
      cell(`E${r}`, j?.description || '', { wrap: true });
      ws.mergeCells(`F${r}:G${r}`);
      cell(`F${r}`, j?.comments || '', { wrap: true });
      cell(`H${r}`, j ? +j.amount || 0 : 0, { money: true });
      r++;
    }
    const fixedCell = `H${r}`;
    cell(fixedCell, { formula: `SUM(H${first}:H${r - 1})`, result: inv.t.fixed }, { money: true, bold: true });
    r += 3;

    // Extra charges
    bar('Extra Charges', BRAND, 'B', 'H');
    headers({ B: 'Date', C: 'Property Address', D: 'Service', E: 'Description', F: 'Company Charge', G: 'Percentage', H: 'Total Amount' });
    first = r;
    for (const j of inv.extras.length ? inv.extras : [null]) {
      cell(`B${r}`, j ? xDate(j.date) : '', { date: true });
      cell(`C${r}`, j?.address || '', { wrap: true });
      cell(`D${r}`, j?.comments || '', { wrap: true });
      cell(`E${r}`, j?.description || '', { wrap: true });
      cell(`F${r}`, j ? +j.price || 0 : 0, { money: true });
      cell(`G${r}`, j ? (+j.percent || 0) / 100 : 1, { pct: true });
      cell(`H${r}`, { formula: `ROUND(F${r}*G${r},2)`, result: j ? A.earn(j) : 0 }, { money: true });
      r++;
    }
    const extraCell = `H${r}`;
    cell(extraCell, { formula: `SUM(H${first}:H${r - 1})`, result: inv.t.extras }, { money: true, bold: true });
    r += 3;

    // Deductions (listed so the total in the summary is explained)
    let deductionValue = 0;
    if (inv.deductions.length) {
      bar('Deductions', BRAND, 'B', 'H');
      headers({ B: 'Date', C: 'Property Address', E: 'Description', F: 'Comments', H: 'Amount' });
      first = r;
      for (const j of inv.deductions) {
        cell(`B${r}`, xDate(j.date), { date: true });
        cell(`C${r}`, j.address || '', { wrap: true });
        cell(`D${r}`, '');
        cell(`E${r}`, j.description || '', { wrap: true });
        ws.mergeCells(`F${r}:G${r}`);
        cell(`F${r}`, j.comments || '', { wrap: true });
        cell(`H${r}`, +j.amount || 0, { money: true });
        r++;
      }
      deductionValue = { formula: `SUM(H${first}:H${r - 1})`, result: inv.t.deductions };
      r += 2;
    }

    // Summary
    ws.mergeCells(`B${r}:G${r}`);
    Object.assign(ws.getCell(`B${r}`), { value: 'SUBCONTRACTORS CHARGES', font: { bold: true, size: 13, color: { argb: 'FF' + BRAND } }, alignment: { horizontal: 'center' } });
    r += 2;
    const sumLine = (label, value, opts = {}) => {
      ws.mergeCells(`C${r}:D${r}`);
      Object.assign(ws.getCell(`C${r}`), { value: label, font: { bold: true }, alignment: { horizontal: 'right' } });
      const c = cell(`E${r}`, value, { money: true, border: false, ...opts });
      r++;
      return c;
    };
    sumLine(COMPANY.chargeLabel, { formula: chargeCell, result: inv.t.companyCharge });
    r++;
    const s1 = sumLine(`Total subcontractor amount (${pctLabel('regular')})`, { formula: reg.totalCell, result: inv.t.regular }).address;
    sumLine(`Total subcontractor amount (${pctLabel('sunday')})`, { formula: sun.totalCell, result: inv.t.sunday });
    sumLine(`Total subcontractor amount (${pctLabel('holiday')})`, { formula: hol.totalCell, result: inv.t.holiday });
    sumLine('Net Value for Subcontractor', { formula: fixedCell, result: inv.t.fixed });
    const sLast = sumLine('Extra Charges', { formula: extraCell, result: inv.t.extras }).address;
    const dCell = sumLine('Deduction', deductionValue, { color: 'FF0000', bold: true }).address;
    r++;
    let totalCell = sumLine(inv.gst ? 'Total subcontractor profit (excl. GST)' : 'Total subcontractor profit', { formula: `SUM(${s1}:${sLast})-${dCell}`, result: inv.t.total });
    if (inv.gst) {
      const exCell = totalCell.address;
      totalCell.font = { bold: true };
      const gstCell = sumLine('GST (10%)', { formula: `ROUND(${exCell}*0.1,2)`, result: inv.t.gst }).address;
      totalCell = sumLine('Total payable (incl. GST)', { formula: `${exCell}+${gstCell}`, result: inv.t.payable });
    }
    totalCell.fill = fill(BRAND);
    totalCell.font = { ...white, size: 13 };
    r += 2;

    // Bank details
    ws.mergeCells(`B${r}:D${r}`);
    Object.assign(ws.getCell(`B${r}`), { value: 'Bank details', font: { bold: true, color: { argb: 'FF' + BRAND } } });
    r += 1;
    for (const [k, v] of [['Account Name:', inv.s.accountName], ['Bank:', inv.s.bank], ['BSB:', inv.s.bsb], ['Account Number:', inv.s.accountNumber], ['ABN:', inv.s.abn]]) {
      ws.getCell(`B${r}`).value = k; ws.getCell(`B${r}`).font = { bold: true };
      ws.getCell(`D${r}`).value = v || '';
      r++;
    }

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- shared header blocks ----------
  function billToRows() {
    const rows = [['Company:', COMPANY.name], ['Address:', COMPANY.address], ['Phone No:', COMPANY.phone], ['Email:', COMPANY.email]];
    if (COMPANY.abn) rows.push(['ABN:', COMPANY.abn]);
    return rows;
  }
  function fromRows(inv) {
    const rows = [];
    if (inv.s.businessName) rows.push(['Business:', inv.s.businessName]);
    rows.push(['Employee Name:', inv.s.name], ['ABN:', inv.s.abn], ['Invoice No:', inv.number],
      ['Date issued:', A.fmtDate(inv.issued, { day: '2-digit', month: '2-digit', year: 'numeric' })],
      ['Period:', inv.p.label], ['Phone No:', inv.s.phone]);
    return rows;
  }

  // ---------- PDF ----------
  async function makePdf(inv) {
    await loadPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 12;
    const brand = [21, 96, 130];
    const d = (s) => A.fmtDate(s, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const m = A.money;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...brand);
    doc.text(inv.title, W / 2, 18, { align: 'center' });
    doc.setFontSize(10); doc.setTextColor(0);

    const block = (x, title, rows) => {
      let y = 30;
      doc.setFont('helvetica', 'bold'); doc.text(title, x, y); y += 5;
      for (const [k, v] of rows) {
        doc.setFont('helvetica', 'bold'); doc.text(k, x, y);
        doc.setFont('helvetica', 'normal'); doc.text(String(v || ''), x + 31, y);
        y += 5;
      }
      return y;
    };
    const y1 = block(M, 'Bill to:', billToRows());
    const y2 = block(W / 2 + 10, 'From:', fromRows(inv));
    let y = Math.max(y1, y2) + 4;

    const table = (title, color, head, body, foot) => {
      doc.autoTable({
        startY: y,
        head: [[{ content: title, colSpan: head.length, styles: { fillColor: color, textColor: color === brand ? 255 : 0, halign: 'center' } }], head],
        body: body.length ? body : [head.map(() => '')],
        foot: foot ? [foot] : undefined,
        theme: 'grid',
        margin: { left: M, right: M },
        styles: { fontSize: 8, cellPadding: 1.6, valign: 'middle' },
        headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
        columnStyles: Object.fromEntries(head.map((h, i) => [i, /Charge|%|Total|Amount|Earned/.test(h) ? { halign: 'right' } : {}])),
      });
      y = doc.lastAutoTable.finalY + 5;
    };

    const cleanHead = ['Date', 'Property Address', 'Service', 'Description', 'Company Charge', '%', 'Total'];
    const green = [146, 208, 80];
    for (const [key, title] of [['regular', `Regular Cleans (${pctLabel('regular')})`], ['sunday', `Sunday Cleans (${pctLabel('sunday')})`], ['holiday', `Public Holiday (${pctLabel('holiday')})`]]) {
      const list = inv.cleans[key];
      if (!list.length && key !== 'regular') continue;
      table(title, green, cleanHead,
        list.map((j) => [d(j.date), j.address, `${j.service} (${A.bedLabel(j.bedrooms)})`, [j.description, j.comments].filter(Boolean).join(' · '),
          m(+j.price || 0), pctLabel(A.dayTypeOf(j)), m(A.earn(j))]),
        ['', '', '', 'Subtotal', m(list.reduce((s, j) => s + (+j.price || 0), 0)), '', m(inv.t[key])]);
    }
    if (inv.fixed.length) {
      table('Net value for the subcontractor', brand, ['Date', 'Property Address', 'Description', 'Comments', 'Total Amount'],
        inv.fixed.map((j) => [d(j.date), j.address, j.description, j.comments, m(+j.amount || 0)]), ['', '', '', 'Subtotal', m(inv.t.fixed)]);
    }
    if (inv.extras.length) {
      table('Extra Charges', brand, ['Date', 'Property Address', 'Description', 'Company Charge', '%', 'Total Amount'],
        inv.extras.map((j) => [d(j.date), j.address, [j.description, j.comments].filter(Boolean).join(' · '), m(+j.price || 0), `${+j.percent || 0}%`, m(A.earn(j))]),
        ['', '', '', '', 'Subtotal', m(inv.t.extras)]);
    }
    if (inv.deductions.length) {
      table('Deductions', brand, ['Date', 'Property Address', 'Description', 'Amount'],
        inv.deductions.map((j) => [d(j.date), j.address, [j.description, j.comments].filter(Boolean).join(' · '), m(+j.amount || 0)]),
        ['', '', 'Subtotal', m(inv.t.deductions)]);
    }

    const summary = [
      [COMPANY.chargeLabel, m(inv.t.companyCharge)],
      [`Total subcontractor amount (${pctLabel('regular')})`, m(inv.t.regular)],
      [`Total subcontractor amount (${pctLabel('sunday')})`, m(inv.t.sunday)],
      [`Total subcontractor amount (${pctLabel('holiday')})`, m(inv.t.holiday)],
      ['Net Value for Subcontractor', m(inv.t.fixed)],
      ['Extra Charges', m(inv.t.extras)],
      ['Deduction', inv.t.deductions ? '-' + m(inv.t.deductions) : m(0)],
    ];
    if (inv.gst) summary.push(['Total subcontractor profit (excl. GST)', m(inv.t.total)], ['GST (10%)', m(inv.t.gst)]);
    if (y > 230) { doc.addPage(); y = 15; }
    doc.autoTable({
      startY: y,
      head: [[{ content: 'SUBCONTRACTORS CHARGES', colSpan: 2, styles: { halign: 'center' } }]],
      body: summary,
      foot: [inv.gst ? ['Total payable (incl. GST)', m(inv.t.payable)] : ['Total subcontractor profit', m(inv.t.total)]],
      theme: 'plain',
      tableWidth: 110,
      margin: { left: W - M - 110 },
      styles: { fontSize: 9, cellPadding: 1.5 },
      headStyles: { fillColor: brand, textColor: 255 },
      footStyles: { fillColor: brand, textColor: 255, fontSize: 11 },
      columnStyles: { 1: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 8;

    if (y > 255) { doc.addPage(); y = 15; }
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...brand); doc.text('Bank details', M, y); y += 5;
    doc.setTextColor(0);
    for (const [k, v] of [['Account Name:', inv.s.accountName], ['Bank:', inv.s.bank], ['BSB:', inv.s.bsb], ['Account Number:', inv.s.accountNumber], ['ABN:', inv.s.abn]]) {
      doc.setFont('helvetica', 'bold'); doc.text(k, M, y);
      doc.setFont('helvetica', 'normal'); doc.text(String(v || ''), M + 34, y);
      y += 5;
    }
    return doc.output('blob');
  }

  // ---------- delivery ----------
  let ready = null; // file prepared earlier whose share needs a fresh tap

  async function deliver(blob, filename, { share = false } = {}) {
    const file = new File([blob], filename, { type: blob.type });
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (e.name === 'NotAllowedError') {
          ready = { filename, file };
          A.toast('Ready — tap the button again to share');
          return;
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  A.deliver = deliver;

  function fileName(inv, ext) {
    const who = (inv.s.name || 'Subcontractor').trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
    return `Invoice_${String(inv.number).replace(/[^\w-]/g, '')}_${who}_${inv.p.short.replace(/\s+/g, '_')}.${ext}`;
  }

  async function run(kind, share) {
    const inv0 = build(A.period);
    if (!inv0.jobs.length && !confirm('There are no jobs in this period. Make an empty invoice anyway?')) return;
    A.invoiceNumberFor(A.period, { assign: true });
    const inv = build(A.period);
    const name = fileName(inv, kind);
    if (share && ready && ready.filename === name) {
      const { file } = ready;
      ready = null;
      try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== 'AbortError') A.toast('Could not share — try Download'); }
      return;
    }
    try {
      const blob = kind === 'pdf' ? await makePdf(inv) : await makeXlsx(inv);
      await deliver(blob, name, { share });
      A.render();
    } catch (e) {
      console.error(e);
      A.toast('Something went wrong making the file. Are you online the first time?');
    }
  }

  $('#share-pdf').onclick = () => run('pdf', true);
  $('#share-xlsx').onclick = () => run('xlsx', true);
  $('#dl-pdf').onclick = () => run('pdf', false);
  $('#dl-xlsx').onclick = () => run('xlsx', false);

  // exposed for testing
  A.makeXlsx = (p = A.period) => makeXlsx(build(p));
  A.makePdf = (p = A.period) => makePdf(build(p));
})();
