/* Cleaning invoice app: jobs, periods, settings. Data stays in localStorage on this device. */
(() => {
  const KEY = 'acu-invoices-v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------- storage ----------
  const defaults = () => ({
    settings: {
      name: '', phone: '', email: '', abn: '',
      accountName: '', bank: '', bsb: '', accountNumber: '',
      invoiceEmail: '', invoicePrefix: '', nextInvoiceNo: 1,
      dateOrder: 'MDY', businessName: '', gstRegistered: false,
    },
    jobs: [],
    invoiceNumbers: {},
    priceList: null,
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const data = JSON.parse(raw);
      const d = defaults();
      return { ...d, ...data, settings: { ...d.settings, ...data.settings } };
    } catch {
      return defaults();
    }
  }
  const state = load();
  if (isPriceList(state.priceList)) applyPriceList(state.priceList);
  const firstService = () => Object.keys(SERVICES)[0] || '';
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { toast('Could not save on this device'); }
  }

  // ---------- dates & money ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    parseISO(s).toLocaleDateString('en-AU', opts);
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Billing periods: 1st–15th and 16th–end of month (clause 6.4).
  function periodOf(dateStr) {
    const d = parseISO(dateStr);
    const y = d.getFullYear(), m = d.getMonth();
    const first = d.getDate() <= 15;
    const start = new Date(y, m, first ? 1 : 16);
    const end = first ? new Date(y, m, 15) : new Date(y, m + 1, 0);
    // Due 17th (first half) or 2nd of next month (second half); paid 19th / 4th.
    const due = first ? new Date(y, m, 17) : new Date(y, m + 1, 2);
    const pay = first ? new Date(y, m, 19) : new Date(y, m + 1, 4);
    const monthName = start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
    return {
      key: `${y}-${pad(m + 1)}-${first ? 'A' : 'B'}`,
      start: iso(start), end: iso(end), due: iso(due), pay: iso(pay),
      label: `${start.getDate()}–${end.getDate()} ${monthName}`,
      short: `${start.getDate()}-${end.getDate()} ${start.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`,
    };
  }
  function shiftPeriod(p, dir) {
    const d = parseISO(dir > 0 ? p.end : p.start);
    d.setDate(d.getDate() + dir);
    return periodOf(iso(d));
  }

  function autoDayType(dateStr) {
    if (NSW_HOLIDAYS[dateStr]) return 'holiday';
    return parseISO(dateStr).getDay() === 0 ? 'sunday' : 'regular';
  }
  const dayTypeOf = (job) => (job.dayType && job.dayType !== 'auto' ? job.dayType : autoDayType(job.date));

  function earn(job) {
    switch (job.kind) {
      case 'clean': return round2((+job.price || 0) * RATES[dayTypeOf(job)].pct);
      case 'extra': return round2((+job.price || 0) * (+job.percent || 0) / 100);
      case 'fixed': return round2(+job.amount || 0);
      case 'deduction': return -round2(+job.amount || 0);
      default: return 0;
    }
  }

  const listPrice = (service, bedrooms) => (SERVICES[service] ? SERVICES[service][+bedrooms] : undefined);
  const bedLabel = (b) => (+b === 0 ? 'Studio' : `${b} bed`);

  const jobsIn = (p) => state.jobs
    .filter((j) => j.date >= p.start && j.date <= p.end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));

  function invoiceNumberFor(p, { assign = false } = {}) {
    let n = state.invoiceNumbers[p.key];
    if (!n) {
      n = `${state.settings.invoicePrefix || ''}${state.settings.nextInvoiceNo || 1}`;
      if (assign) {
        state.invoiceNumbers[p.key] = n;
        state.settings.nextInvoiceNo = (+state.settings.nextInvoiceNo || 1) + 1;
        save();
      }
    }
    return n;
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dueText(p) {
    const today = iso(new Date());
    if (today < p.start) return 'Upcoming period';
    if (today <= p.end) return `In progress · invoice due ${fmtDate(p.due, { day: 'numeric', month: 'short' })}`;
    if (today <= p.due) return `Send invoice by ${fmtDate(p.due)}!`;
    return `Was due ${fmtDate(p.due, { day: 'numeric', month: 'short' })} · paid around ${fmtDate(p.pay, { day: 'numeric', month: 'short' })}`;
  }

  // ---------- navigation ----------
  let period = periodOf(iso(new Date()));
  const titles = { jobs: 'Jobs', invoice: 'Invoice', settings: 'Settings' };
  let currentView = 'jobs';

  function showView(name) {
    currentView = name;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('#title').textContent = titles[name];
    render();
    window.scrollTo(0, 0);
  }
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  const step = (dir) => { period = shiftPeriod(period, dir); render(); };
  $('#prev-period').onclick = () => step(-1);
  $('#next-period').onclick = () => step(1);
  $('#inv-prev').onclick = () => step(-1);
  $('#inv-next').onclick = () => step(1);

  function render() {
    renderPeriodHeader('#jobs-period-label', '#jobs-period-due');
    renderPeriodHeader('#inv-period-label', '#inv-period-due');
    if (currentView === 'jobs') renderJobs();
    if (currentView === 'invoice') renderInvoice();
  }

  function renderPeriodHeader(labelSel, dueSel) {
    $(labelSel).textContent = period.label;
    const due = $(dueSel);
    due.textContent = dueText(period);
    const today = iso(new Date());
    due.classList.toggle('urgent', today > period.end && today <= period.due);
  }

  // ---------- jobs view ----------
  function renderJobs() {
    const jobs = jobsIn(period);
    const total = jobs.reduce((s, j) => s + earn(j), 0);
    $('#jobs-total').textContent = money(total);
    const cleans = jobs.filter((j) => j.kind === 'clean').length;
    $('#jobs-count').textContent = `${cleans} clean${cleans === 1 ? '' : 's'}`;

    const list = $('#jobs-list');
    const noPrices = state.priceList ? '' : '<div class="warn">Load your price list in <b>Settings</b> so prices and percentages fill in automatically.</div>';
    if (!jobs.length) {
      list.innerHTML = noPrices + '<div class="empty">No jobs in this period yet.<br>Tap <b>+ Add job</b> after each shift.</div>';
      return;
    }
    let html = noPrices;
    let lastDate = '';
    for (const j of jobs) {
      if (j.date !== lastDate) {
        lastDate = j.date;
        const t = autoDayType(j.date);
        const tag = t === 'holiday' ? `<span class="tag holiday">${esc(NSW_HOLIDAYS[j.date])} · ${pctLabel('holiday')}</span>`
          : t === 'sunday' ? `<span class="tag sunday">Sunday · ${pctLabel('sunday')}</span>` : '';
        html += `<div class="day"><span>${fmtDate(j.date, { weekday: 'long', day: 'numeric', month: 'short' })}</span>${tag}</div>`;
      }
      const e = earn(j);
      let meta;
      if (j.kind === 'clean') meta = `${esc(j.service)} · ${bedLabel(j.bedrooms)} · ${money(+j.price || 0)} × ${pctLabel(dayTypeOf(j))}`;
      else if (j.kind === 'extra') meta = `Extra · ${esc(j.description || '')} · ${money(+j.price || 0)} × ${+j.percent || 0}%`;
      else if (j.kind === 'fixed') meta = `Fixed amount · ${esc(j.description || '')}`;
      else meta = `Deduction · ${esc(j.description || '')}`;
      html += `<button class="job" data-id="${j.id}">
        <div class="main"><div class="addr">${esc(j.address || j.description || '(no address)')}</div><div class="meta">${meta}</div></div>
        <div class="amt ${e < 0 ? 'neg' : ''}">${money(e)}</div>
      </button>`;
    }
    list.innerHTML = html;
    $$('.job', list).forEach((b) => b.addEventListener('click', () => openJob(state.jobs.find((j) => j.id === b.dataset.id))));
  }

  // ---------- job dialog ----------
  const dlg = $('#job-dialog');
  const form = $('#job-form');
  let editing = null;
  let priceTouched = false;

  function fillPriceListOptions() {
    $('select[name=service]', form).innerHTML = Object.keys(SERVICES).map((s) => `<option>${esc(s)}</option>`).join('');
    for (const t of Object.keys(RATES)) {
      const opt = $(`select[name=dayType] option[value=${t}]`, form);
      opt.textContent = `${t === 'regular' ? 'Regular day' : RATES[t].label} — ${pctLabel(t)}`;
    }
  }
  fillPriceListOptions();

  function knownAddresses() {
    const map = new Map();
    for (const j of state.jobs) if (j.kind === 'clean' && j.address) map.set(j.address.trim(), j);
    return map;
  }

  function setKind(kind) {
    $$('[data-for]', form).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(kind); });
    const presets = kind === 'extra' ? EXTRAS : kind === 'deduction' ? DEDUCTIONS : [];
    $('select[name=preset]', form).innerHTML = '<option value="">Choose…</option>' +
      presets.map((p, i) => `<option value="${i}">${esc(p.name)} (${money(p.price)})</option>`).join('') +
      '<option value="other">Other</option>';
    updateEarn();
  }

  function formJob() {
    const f = new FormData(form);
    return {
      kind: f.get('kind'),
      date: f.get('date'),
      address: (f.get('address') || '').trim(),
      service: f.get('service'),
      bedrooms: +f.get('bedrooms'),
      dayType: f.get('dayType'),
      price: f.get('price') === '' ? '' : +f.get('price'),
      percent: f.get('percent') === '' ? '' : +f.get('percent'),
      amount: f.get('amount') === '' ? '' : +f.get('amount'),
      description: (f.get('description') || '').trim(),
      comments: (f.get('comments') || '').trim(),
    };
  }

  function updateEarn() {
    const j = formJob();
    const box = $('#job-earn');
    if (!j.date) { box.innerHTML = ''; return; }
    let detail = '';
    if (j.kind === 'clean') {
      const t = dayTypeOf(j);
      const hol = NSW_HOLIDAYS[j.date];
      detail = `${RATES[t].label}${t === 'holiday' && hol ? ` (${esc(hol)})` : ''} rate: ${pctLabel(t)} of ${money(+j.price || 0)}`;
    }
    const e = earn(j);
    box.innerHTML = `${e < 0 ? 'Taken off your invoice' : 'You earn'}: <strong>${money(e)}</strong>${detail ? `<br><small>${detail}</small>` : ''}`;
  }

  function fillPrice() {
    if (priceTouched) return;
    const p = listPrice(form.service.value, form.bedrooms.value);
    if (p !== undefined) form.price.value = p;
  }

  function openJob(job, preset = {}) {
    editing = job || null;
    form.reset();
    priceTouched = !!job;
    const j = job || {
      kind: 'clean', date: iso(new Date()), address: '', service: firstService(), bedrooms: 2,
      dayType: 'auto', percent: 100, description: '', comments: '', ...preset,
    };
    $(`input[name=kind][value=${j.kind}]`, form).checked = true;
    setKind(j.kind);
    form.date.value = j.date;
    form.address.value = j.address || '';
    form.service.value = j.service || firstService();
    form.bedrooms.value = j.bedrooms ?? 2;
    form.dayType.value = j.dayType || 'auto';
    form.price.value = j.price ?? '';
    form.percent.value = j.percent ?? 100;
    form.amount.value = j.amount ?? '';
    form.description.value = j.description || '';
    form.comments.value = j.comments || '';
    if (!job) fillPrice();

    $('#address-list').innerHTML = [...knownAddresses().keys()].sort().map((a) => `<option value="${esc(a)}">`).join('');
    $('#job-dialog-title').textContent = job ? 'Edit job' : 'Add job';
    $('#delete-job').hidden = !job;
    updateEarn();
    dlg.showModal();
  }

  $('#add-job').onclick = () => {
    // Default the date to today if it is in the shown period, otherwise the period start.
    const today = iso(new Date());
    const date = today >= period.start && today <= period.end ? today : period.start;
    openJob(null, { date });
  };

  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n === 'kind') setKind(e.target.value);
    if (n === 'service' || n === 'bedrooms') fillPrice();
    if (n === 'preset') {
      const kind = form.kind.value;
      const list = kind === 'extra' ? EXTRAS : DEDUCTIONS;
      const p = list[+e.target.value];
      if (p) {
        if (kind === 'extra') form.price.value = p.price; else form.amount.value = p.price;
        form.description.value = p.name.replace(/ \(cl\..*\)$/, '');
      }
    }
    updateEarn();
  });
  form.addEventListener('input', (e) => {
    if (e.target.name === 'price') priceTouched = true;
    if (e.target.name === 'address' && !editing) {
      const prev = knownAddresses().get(e.target.value.trim());
      if (prev) {
        form.service.value = prev.service;
        form.bedrooms.value = prev.bedrooms;
        form.price.value = prev.price;
        priceTouched = prev.price !== listPrice(prev.service, prev.bedrooms);
        if (!form.description.value) form.description.value = prev.description || '';
      }
    }
    updateEarn();
  });

  form.addEventListener('submit', (e) => {
    const j = formJob();
    if (!j.date) { e.preventDefault(); return; }
    if (editing) Object.assign(editing, j);
    else state.jobs.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), created: Date.now(), ...j });
    save();
    period = periodOf(j.date);
    render();
    toast(editing ? 'Job updated' : `Saved · ${money(earn(j))}`);
  });

  $('#delete-job').onclick = () => {
    if (!editing || !confirm('Delete this job?')) return;
    state.jobs = state.jobs.filter((j) => j !== editing);
    save();
    dlg.close();
    render();
    toast('Job deleted');
  };

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------- paste shifts ----------
  const pasteDlg = $('#paste-dialog');
  let parsed = [];

  function serviceFromTitle(t) {
    const s = t.toLowerCase();
    if (/end of lease|bond/.test(s)) return 'End of Lease Cleaning';
    if (/deep/.test(s)) return 'Deep Cleaning';
    if (/refresh/.test(s)) return 'Refresh Cleaning';
    if (/no bed|clean(ing)? only/.test(s)) return 'Cleaning Only (No Bed Set Up)';
    if (/departure|turnover|clean/.test(s)) return 'Standard Departure Clean';
    if (/linen|amenit/.test(s)) return 'Change Linen & Amenities Only';
    return SERVICES['Standard Departure Clean'] ? 'Standard Departure Clean' : firstService();
  }

  const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
  function parseDate(tok) {
    const m = tok.match(DATE_RE);
    if (!m) return null;
    let [, a, b, y] = m.map(Number);
    if (y < 100) y += 2000;
    const [mo, d] = state.settings.dateOrder === 'DMY' ? [b, a] : [a, b];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  function parseShifts(text) {
    // Cells may be split by tabs, new lines or wide spacing; each row starts with a date.
    const tokens = text.split(/\t|\r?\n|\s{2,}/).map((t) => t.trim()).filter(Boolean);
    const rows = [];
    for (const t of tokens) {
      const d = parseDate(t);
      if (d) rows.push({ date: d, cells: [] });
      else if (rows.length) rows[rows.length - 1].cells.push(t);
    }
    const known = knownAddresses();
    return rows.map(({ date, cells }) => {
      const isTime = (c) => /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(c);
      const isBeds = (c) => /bedroom|studio/i.test(c);
      const isJobType = (c) => c.length < 25 && /airbnb|b2b/i.test(c);
      const isTitle = (c) => /clean|linen|refresh|departure|lease|amenit/i.test(c) && !/\d+\s*\/?\s*\d+\s+\w+\s+(st|rd|ave|blvd|street|road)/i.test(c);
      const title = cells.find((c) => isTitle(c) && !isBeds(c)) || '';
      const beds = cells.find(isBeds) || '';
      const bm = beds.match(/(\d+)\s*bed/i);
      const bedrooms = bm ? Math.min(6, +bm[1]) : /studio/i.test(beds) ? 0 : 2;
      const address = cells
        .filter((c) => c !== title && !isTime(c) && !isBeds(c) && !isJobType(c) && /\d/.test(c) && /[a-z]{3}/i.test(c))
        .sort((x, y) => y.length - x.length)[0] || '';
      const jobType = cells.find((c) => c !== title && isJobType(c)) || '';
      const prev = known.get(address);
      const service = serviceFromTitle(title);
      const price = prev && prev.service === service && +prev.bedrooms === bedrooms ? prev.price : listPrice(service, bedrooms);
      const dup = state.jobs.some((j) => j.kind === 'clean' && j.date === date && j.address.trim().toLowerCase() === address.toLowerCase());
      return {
        kind: 'clean', date, address, service, bedrooms, dayType: 'auto', price,
        description: title, comments: jobType, dup, bedsFound: !!beds,
      };
    });
  }

  function renderPastePreview() {
    parsed = parseShifts($('#paste-text').value);
    const box = $('#paste-preview');
    if (!parsed.length) {
      box.innerHTML = $('#paste-text').value.trim() ? '<div class="warn">No dates found. Each shift needs a date like 10/27/26.</div>' : '';
      return;
    }
    box.innerHTML = parsed.map((j) => `<div class="preview-row ${j.dup ? 'dup' : ''}">
      <b>${fmtDate(j.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${money(earn(j))}${j.dup ? ' · already added' : ''}</b>
      ${esc(j.address || '⚠️ address not found')}<br>
      <small>${esc(j.service)} · ${bedLabel(j.bedrooms)}${j.bedsFound ? '' : ' (guessed)'} · ${money(+j.price || 0)}</small>
    </div>`).join('');
  }

  $('#paste-jobs').onclick = () => {
    $('#paste-text').value = '';
    $('#paste-preview').innerHTML = '';
    pasteDlg.showModal();
  };
  $('#paste-text').addEventListener('input', renderPastePreview);
  $('#paste-add').onclick = () => {
    const fresh = parsed.filter((j) => !j.dup);
    if (!fresh.length) { toast('Nothing new to add'); return; }
    for (const { dup, bedsFound, ...j } of fresh) {
      state.jobs.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), created: Date.now(), ...j });
    }
    save();
    period = periodOf(fresh[0].date);
    pasteDlg.close();
    render();
    toast(`Added ${fresh.length} job${fresh.length === 1 ? '' : 's'}`);
  };

  // ---------- settings ----------
  const sform = $('#settings-form');
  for (const [k, v] of Object.entries(state.settings)) {
    const el = sform.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  sform.addEventListener('input', (e) => {
    const { name, value, type, checked } = e.target;
    if (!name) return;
    state.settings[name] = type === 'checkbox' ? checked : name === 'nextInvoiceNo' ? Math.max(1, +value || 1) : value;
    save();
  });
  sform.addEventListener('submit', (e) => e.preventDefault());

  // ---------- private price list ----------
  function renderPriceListStatus() {
    const pl = state.priceList;
    $('#price-list-status').innerHTML = pl
      ? `Loaded: <b>${esc(pl.company?.name || 'price list')}</b> · ${Object.keys(SERVICES).length} services · ` +
        `${pctLabel('regular')} regular, ${pctLabel('sunday')} Sundays, ${pctLabel('holiday')} public holidays (prices excl. GST).`
      : 'No price list loaded yet. Load your subcontractor agreement (PDF) or a price list file.';
  }
  renderPriceListStatus();
  $('#price-list-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      let cfg;
      if (isPdf) {
        toast('Reading the agreement…');
        cfg = await readAgreement(file);
        // Keep contact details the PDF doesn't have (phone, email) from the previous price list.
        const prev = state.priceList?.company || {};
        cfg.company = { ...prev, ...Object.fromEntries(Object.entries(cfg.company).filter(([, v]) => v)) };
        const found = `Found in ${file.name}:\n\n` +
          `• ${Object.keys(cfg.services).length} services, e.g. ${Object.keys(cfg.services)[0]}: ` +
          `${cfg.services[Object.keys(cfg.services)[0]].map((p, i) => `${i ? i + ' bed' : 'Studio'} $${p}`).join(', ')}\n` +
          `• Your share: ${Math.round(cfg.rates.regular * 100)}% regular, ${Math.round(cfg.rates.sunday * 100)}% Sundays, ${Math.round(cfg.rates.holiday * 100)}% public holidays\n` +
          `• ${cfg.extras.length} extra fees, ${cfg.deductions.length} deductions\n` +
          `• Company: ${cfg.company.name || '?'}, ABN ${cfg.company.abn || '?'}\n\nUse this price list?`;
        if (!confirm(found)) return;
      } else {
        cfg = JSON.parse(await file.text());
      }
      if (!isPriceList(cfg)) throw new Error('bad file');
      state.priceList = cfg;
      applyPriceList(cfg);
      if (!state.settings.invoiceEmail && COMPANY.invoiceEmail) {
        state.settings.invoiceEmail = COMPANY.invoiceEmail;
        sform.elements.invoiceEmail.value = COMPANY.invoiceEmail;
      }
      save();
      fillPriceListOptions();
      renderPriceListStatus();
      render();
      toast('Price list loaded');
    } catch (err) {
      toast(err && err.message && err.message !== 'bad file' ? err.message : 'That file is not a price list or agreement this app can read');
    } finally {
      e.target.value = '';
    }
  };

  $('#backup-export').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    App.deliver(blob, `invoice-app-backup-${iso(new Date())}.json`, { share: true });
  };
  $('#backup-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.jobs) || !data.settings) throw new Error('bad file');
      if (!confirm(`Replace everything on this phone with the backup (${data.jobs.length} jobs)?`)) return;
      localStorage.setItem(KEY, JSON.stringify(data));
      location.reload();
    } catch {
      toast('That file is not a backup from this app');
    } finally {
      e.target.value = '';
    }
  };

  // ---------- shared API for invoice.js ----------
  window.App = {
    state, save, toast, money, fmtDate, iso, parseISO, round2, esc,
    periodOf, jobsIn, earn, dayTypeOf, invoiceNumberFor, bedLabel,
    get period() { return period; },
    render,
    renderInvoice: () => {},
  };
  function renderInvoice() { App.renderInvoice(); }

  render();
})();
