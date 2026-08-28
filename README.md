# FX Sim — Currency Trading Simulator

A thin client-side web app for paper currency trading with historical replay, multiple saved scenarios, and local browser storage.

## Features

- **Multiple scenarios** — save, switch, and delete independent portfolios locally
- **Historical mode** — step forward, auto-play with speed control, jump to any date
- **Exchange Rates tab** — interactive charts; click a date to jump the simulation
- Trade 10 major currencies using rates from [Frankfurter](https://frankfurter.dev)
- Export / import JSON for the **active scenario only**

## Scenarios

Use the **Scenario** dropdown in the header to switch between saved sets. Choose **+ Add new scenario** to create another portfolio with its own trades and simulation date. **Delete** removes only the active scenario.

Existing single-portfolio data is migrated automatically to **Scenario 1** on first load.

## Run locally

```bash
python3 -m http.server 8080
```

Live: https://aisachiu.github.io/FXSim/

## Export format (v4)

```json
{
  "format": "fxsim-export",
  "version": 4,
  "scenarioName": "2010 USD hedge",
  "exportedAt": "2026-08-28T10:00:00.000Z",
  "portfolio": { ... }
}
```

Import replaces the active scenario. v3 exports remain compatible.

## Disclaimer

Simulation only. No real money involved.
