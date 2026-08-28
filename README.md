# FX Sim — Currency Trading Simulator

A thin client-side web app for paper currency trading. Start with Hong Kong dollars (HKD), convert into other major currencies at live exchange rates, and track how your simulated wealth changes over time.

All data is stored **locally in your browser**. Export and import a JSON backup file to move your portfolio between devices.

## Features

- Start with a configurable HKD balance (minimum 1,000 HKD)
- Trade between 10 major currencies using live rates from [Frankfurter](https://frankfurter.dev)
- Dashboard with total wealth (HKD), profit/loss vs starting deposit, holdings, and trade history
- Wealth-over-time chart
- Export / import JSON backup files
- No accounts, passwords, or backend

## Run locally

ES modules require a local web server (opening `index.html` directly from disk will not work in most browsers).

```bash
# Python 3
python3 -m http.server 8080

# or Node.js (npx)
npx serve .
```

Then open http://localhost:8080

## Deploy on GitHub Pages

This repo includes [`.github/workflows/pages.yml`](.github/workflows/pages.yml). After the code is pushed to GitHub:

1. Create a repository named **`FXSim`** on your GitHub account.
2. Push the `main` branch to that repo.
3. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. The workflow runs on push and publishes the site.

Live URL: `https://<your-github-username>.github.io/FXSim/`

No backend or database is required.

## Export / import format

Exported files look like this:

```json
{
  "format": "fxsim-export",
  "version": 2,
  "exportedAt": "2026-08-28T10:00:00.000Z",
  "portfolio": {
    "startingHkd": 10000,
    "balances": { "HKD": 5000, "USD": 641.03 },
    "transactions": [],
    "snapshots": []
  }
}
```

Import replaces the current portfolio on this device. v1 exports (with an `account` wrapper) are still supported.

## Disclaimer

This is a **simulation only**. No real money is involved. Exchange rates are indicative and update periodically from public sources.
