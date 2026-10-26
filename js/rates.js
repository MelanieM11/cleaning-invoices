// Company prices and rules are deliberately NOT in this code: they come from a private
// price-list file that is loaded once on the phone (Settings → Price list) and stays there.
// Bedroom keys in `services`: index 0 = Studio, 1..6 = bedrooms. Prices excl. GST.

let SERVICES = {};
const RATES = {
  regular: { label: 'Regular', pct: 0 },
  sunday:  { label: 'Sunday', pct: 0 },
  holiday: { label: 'Public holiday', pct: 0 },
};
let EXTRAS = [];
let DEDUCTIONS = [];
let COMPANY = { name: '', address: '', phone: '', email: '', invoiceEmail: '', chargeLabel: 'Company charge' };

function isPriceList(cfg) {
  return !!cfg && cfg.type === 'cleaning-invoices-price-list' && cfg.services && cfg.rates;
}

function applyPriceList(cfg) {
  SERVICES = cfg.services || {};
  for (const k of Object.keys(RATES)) RATES[k].pct = +cfg.rates[k] || 0;
  EXTRAS = cfg.extras || [];
  DEDUCTIONS = cfg.deductions || [];
  COMPANY = { ...COMPANY, ...(cfg.company || {}) };
}

const pctLabel = (dayType) => `${Math.round(RATES[dayType].pct * 100)}%`;

// NSW public holidays. Check https://www.nsw.gov.au/about-nsw/public-holidays each year.
const NSW_HOLIDAYS = {
  '2025-12-25': 'Christmas Day', '2025-12-26': 'Boxing Day',
  '2026-01-01': "New Year's Day", '2026-01-26': 'Australia Day',
  '2026-04-03': 'Good Friday', '2026-04-04': 'Easter Saturday',
  '2026-04-05': 'Easter Sunday', '2026-04-06': 'Easter Monday',
  '2026-04-25': 'Anzac Day', '2026-06-08': "King's Birthday",
  '2026-10-05': 'Labour Day', '2026-12-25': 'Christmas Day',
  '2026-12-26': 'Boxing Day', '2026-12-28': 'Boxing Day (additional day)',
  '2027-01-01': "New Year's Day", '2027-01-26': 'Australia Day',
  '2027-03-26': 'Good Friday', '2027-03-27': 'Easter Saturday',
  '2027-03-28': 'Easter Sunday', '2027-03-29': 'Easter Monday',
  '2027-04-25': 'Anzac Day', '2027-06-14': "King's Birthday",
  '2027-10-04': 'Labour Day', '2027-12-25': 'Christmas Day',
  '2027-12-26': 'Boxing Day', '2027-12-27': 'Christmas Day (additional day)',
  '2027-12-28': 'Boxing Day (additional day)',
};
