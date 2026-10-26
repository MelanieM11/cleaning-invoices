/* Reads the subcontractor agreement PDF on the phone and builds a price list from it:
   the service price table, the regular/Sunday/public holiday percentages, extra fees,
   deductions and the company's name, ABN and address. Nothing leaves the device. */
(() => {
  let pdfReady;
  function loadPdfJs() {
    return (pdfReady ||= new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = 'vendor/pdf.min.js';
      el.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(); };
      el.onerror = () => { pdfReady = null; rej(new Error('Could not load the PDF reader')); };
      document.head.appendChild(el);
    }));
  }

  // Text lines in reading order; each line is the list of its cells (left to right).
  async function readLines(file) {
    await loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const { items } = await (await doc.getPage(i)).getTextContent();
      const rows = [];
      for (const it of items) {
        const text = it.str.trim();
        if (!text) continue;
        const y = it.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) rows.push((row = { y, cells: [] }));
        row.cells.push({ x: it.transform[4], text });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) lines.push(r.cells.sort((a, b) => a.x - b.x).map((c) => c.text));
    }
    return lines;
  }

  const PRICE = /^\$\s*([\d,]+(?:\.\d+)?)$/;
  const BEDS = /^(studio|[1-9])$/i;
  const toNum = (s) => +s.replace(/,/g, '');

  // Lines between a heading matching `start` and the next "Annexure N" heading.
  function section(lines, start) {
    const from = lines.findIndex((l) => start.test(l.join(' ')));
    if (from < 0) return [];
    let to = lines.findIndex((l, i) => i > from && /^annexure\s+\d/i.test(l.join(' ')));
    if (to < 0) to = lines.length;
    return lines.slice(from + 1, to);
  }

  function parseServices(lines) {
    const services = {};
    let current = null;
    for (const cells of section(lines, /^annexure\s*2\b/i)) {
      // Merge "$" and "110.0" if the PDF split them.
      const merged = [];
      for (const c of cells) {
        if (merged.length && merged[merged.length - 1] === '$') merged[merged.length - 1] = '$' + c;
        else merged.push(c);
      }
      const priceCell = merged.find((c) => PRICE.test(c));
      const bedCell = merged.find((c) => BEDS.test(c));
      if (!priceCell || !bedCell) continue;
      const bed = /studio/i.test(bedCell) ? 0 : +bedCell;
      if (bed === 0 || !current) current = { name: '', prices: [] };
      current.prices[bed] = toNum(priceCell.match(PRICE)[1]);
      const name = merged.filter((c) => c !== priceCell && c !== bedCell).join(' ').replace(/\s+/g, ' ').trim();
      if (name) current.name = name;
      if (current.name) services[current.name] = current.prices;
    }
    return services;
  }

  function parseExtras(lines) {
    const extras = [];
    for (const cells of section(lines, /^annexure\s*4\b/i)) {
      const priceCell = cells.find((c) => PRICE.test(c));
      if (!priceCell) continue;
      const name = cells.filter((c) => c !== priceCell).join(' ').trim();
      if (name && !/price/i.test(name)) extras.push({ name, price: toNum(priceCell.match(PRICE)[1]) });
    }
    return extras;
  }

  async function readAgreement(file) {
    const lines = await readLines(file);
    if (!lines.length) throw new Error('This PDF has no readable text (it may be a scanned image).');
    const text = lines.map((l) => l.join(' ')).join('\n').replace(/\s+-\s+/g, '-');
    const flat = text.replace(/\s+/g, ' ');

    const services = parseServices(lines);
    if (!Object.keys(services).length) throw new Error('Could not find the service price list (Annexure 2) in this PDF.');

    const pct = (re) => { const m = flat.match(re); return m ? +m[1] / 100 : 0; };
    const rates = {
      regular: pct(/(\d{1,3})\s*%[^%]{0,80}?regular/i),
      sunday: pct(/(\d{1,3})\s*%[^%]{0,80}?sunday/i),
      holiday: pct(/(\d{1,3})\s*%[^%]{0,80}?public holiday/i),
    };
    if (!rates.regular) throw new Error('Could not find your percentage for regular days in this PDF.');

    const deductions = [];
    const noShow = flat.match(/deduct \$\s*([\d.]+)/i);
    if (noShow) deductions.push({ name: 'No-show / refused job', price: +noShow[1] });
    const reclean = flat.match(/reduced at a rate of \$\s*([\d.]+)/i);
    if (reclean) deductions.push({ name: 'Reclean done by company staff', price: +reclean[1] });

    const pIdx = lines.findIndex((l) => /principal details/i.test(l.join(' ')));
    const name = pIdx >= 0 && lines[pIdx + 1] ? lines[pIdx + 1].join(' ').trim() : '';
    // An ABN is 11 digits, sometimes written with spaces (71 642 828 251).
    const abnDigits = (flat.match(/ABN:?\s*((?:\d ?){10}\d)(?!\d)/i) || [])[1]?.replace(/\s/g, '');
    const abn = abnDigits ? abnDigits.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : '';
    const address = (flat.match(/principal place of business at (.+?),?\s*Australia/i) || [])[1] || '';

    return {
      type: 'cleaning-invoices-price-list',
      version: 1,
      source: file.name,
      company: { name, abn, address: address.trim(), chargeLabel: name ? `${name} charge` : 'Company charge' },
      rates,
      services,
      extras: parseExtras(lines),
      deductions,
    };
  }

  window.readAgreement = readAgreement;
})();
