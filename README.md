# Cleaning Invoices

A small phone app (a web app you add to your home screen) for logging cleaning jobs as a
subcontractor and making the fortnightly invoice as PDF or Excel.

## What it does

- **Jobs tab**: add each clean with its date, address, service and bedrooms. Once you've loaded
  your own price list file (see Privacy), the price and your percentage fill in automatically,
  with separate rates for Sundays and NSW public holidays.
- **Paste shifts**: copy rows from your shift schedule and paste them in. The app reads the date,
  shift title, address and bedrooms.
- Addresses you've used before are remembered, so a repeat property fills itself in.
- Extras, fixed amounts and deductions are covered too.
- **Invoice tab**: works in billing periods (1st–15th and 16th–end of month), shows the due date,
  and makes the invoice as **PDF** or **Excel**. "Share" opens the phone's share sheet (Mail,
  WhatsApp…).
- If your ABN is registered for GST, it adds 10% GST and labels the invoice a Tax Invoice.
- Works offline.

## Privacy

There are no company names, prices, rates or client details in this repository. Anyone who
copies this code gets an empty app with no price list.

- **Price list**: in Settings → Price list, load your subcontractor agreement (PDF) and the app reads
  the prices, percentages, extras and company details from it on the phone. You can also load a
  price list file (.json). Never commit either; `.gitignore` blocks `*price-list*.json` and `*backup*.json`.
- **Your jobs, name and bank details**: stored only in the phone's browser storage. Nothing is
  sent anywhere.
- **Backup**: use Settings → Save backup now and then.

## Hosting

This is plain HTML, CSS and JavaScript with no build step, so any static host works. On GitHub
Pages, go to **Settings → Pages → Deploy from a branch** and pick the branch and `/ (root)`.
Then open the site in Safari and tap **Share → Add to Home Screen**.

## Files

- `index.html`, `css/style.css`: the screens
- `js/rates.js`: loads the price list; NSW public holidays
- `js/app.js`: jobs, billing periods, paste parsing, settings, backup
- `js/invoice.js`: invoice summary plus Excel and PDF output
- `sw.js`, `manifest.webmanifest`, `icons/`: home-screen app and offline support
- `js/agreement.js`: reads the price list from the agreement PDF
- `vendor/`: ExcelJS 4.4.0, jsPDF 2.5.1, jspdf-autotable 3.8.2 (MIT), pdf.js 3.11.174 (Apache-2.0)
