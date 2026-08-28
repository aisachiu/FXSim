# FX Sim — Currency Trading Simulator

A thin client-side web app for paper currency trading. Start with Hong Kong dollars (HKD), step through historical exchange rates or trade at live rates, and track how your simulated wealth changes over time.

All data is stored **locally in your browser**. Export and import a JSON backup file to move your portfolio between devices.

## Features

- Start with a configurable HKD balance and simulation start date (from 1981)
- **Historical mode** — step forward one trading day, auto-play with speed control, or jump to any date
- **Exchange Rates tab** — interactive charts with adjustable time range; click a point to jump the simulation
- Trade between 10 major currencies using rates from [Frankfurter](https://frankfurter.dev)
- Dashboard with total wealth (HKD), profit/loss, holdings, trade history, and wealth chart
- Export / import JSON backup files
- No accounts, passwords, or backend

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Deploy

Pushes to `main` deploy automatically to GitHub Pages via Actions.

Live URL: https://aisachiu.github.io/FXSim/

## Historical simulation

- Step forward skips weekends and holidays (business days only)
- Speed dial: 1× to 50× (days per second while playing)
- EUR is unavailable before 1999-01-04
- Switch to **Live (today)** for current rates

## Disclaimer

Simulation only. No real money involved.
