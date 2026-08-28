import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  DEFAULT_STARTING_HKD,
  MIN_STARTING_HKD,
} from './constants.js';
import {
  executeTrade,
  getPortfolioView,
  seedInitialSnapshot,
  snapshotOnRefresh,
} from './portfolio.js';
import { getCrossRate, refreshRates } from './rates.js';
import {
  clearPortfolio,
  createEmptyPortfolio,
  exportPortfolio,
  getPortfolio,
  importPortfolio,
  savePortfolio,
} from './storage.js';

const views = {
  setup: document.getElementById('view-setup'),
  dashboard: document.getElementById('view-dashboard'),
};

const setupForm = document.getElementById('setup-form');
const tradeForm = document.getElementById('trade-form');
const importFile = document.getElementById('import-file');
const setupImportFile = document.getElementById('setup-import-file');

let wealthChart = null;
let previewTimer = null;

function formatMoney(value, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(value);
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDate(iso) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle('hidden', key !== name);
  });
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function populateCurrencySelects() {
  const from = document.getElementById('trade-from');
  const to = document.getElementById('trade-to');
  from.innerHTML = '';
  to.innerHTML = '';

  for (const code of CURRENCIES) {
    from.append(new Option(code, code));
    to.append(new Option(code, code));
  }

  from.value = DEFAULT_CURRENCY;
  to.value = 'USD';
}

function renderHoldings(holdings) {
  const body = document.getElementById('holdings-body');
  body.innerHTML = '';

  if (holdings.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="muted">No holdings</td></tr>';
    return;
  }

  for (const row of holdings) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.currency}</td>
      <td class="num">${formatMoney(row.amount, row.currency)}</td>
      <td class="num">${formatMoney(row.valueHkd, DEFAULT_CURRENCY)}</td>
      <td class="num">${formatNumber(row.weight, 1)}%</td>
    `;
    body.appendChild(tr);
  }
}

function renderTransactions(transactions) {
  const body = document.getElementById('transactions-body');
  const empty = document.getElementById('no-trades');
  body.innerHTML = '';

  if (transactions.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  for (const tx of transactions.slice(0, 20)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(tx.at)}</td>
      <td class="num">${formatMoney(tx.fromAmount, tx.fromCurrency)}</td>
      <td class="num">${formatMoney(tx.toAmount, tx.toCurrency)}</td>
      <td class="num">1 ${tx.fromCurrency} = ${formatNumber(tx.rate, 6)} ${tx.toCurrency}</td>
    `;
    body.appendChild(tr);
  }
}

function renderChart(snapshots, startingHkd) {
  const canvas = document.getElementById('wealth-chart');
  const labels = snapshots.map((point) => formatDate(point.at));
  const values = snapshots.map((point) => point.totalValueHkd);

  if (labels.length === 0) {
    labels.push(formatDate(new Date().toISOString()));
    values.push(startingHkd);
  }

  if (wealthChart) {
    wealthChart.destroy();
  }

  wealthChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total wealth (HKD)',
          data: values,
          borderColor: '#111827',
          backgroundColor: 'rgba(17, 24, 39, 0.06)',
          fill: true,
          tension: 0.25,
          pointRadius: values.length > 30 ? 0 : 3,
        },
        {
          label: 'Starting deposit',
          data: labels.map(() => startingHkd),
          borderColor: '#9ca3af',
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => formatMoney(value, DEFAULT_CURRENCY),
          },
        },
      },
    },
  });
}

async function renderDashboard() {
  if (!getPortfolio()) {
    showView('setup');
    return;
  }

  showView('dashboard');

  try {
    await snapshotOnRefresh();
    const data = await getPortfolioView();
    const { portfolio, valuation, pnl, pnlPct } = data;

    document.getElementById('rates-updated').textContent =
      `Rates as of ${data.ratesDate ?? 'today'} · updated just now`;

    document.getElementById('total-wealth').textContent = formatMoney(
      valuation.totalHkd,
      DEFAULT_CURRENCY,
    );
    document.getElementById('starting-hkd').textContent = formatMoney(
      portfolio.startingHkd,
      DEFAULT_CURRENCY,
    );
    document.getElementById('trade-count').textContent =
      `${portfolio.transactions.length} trade${portfolio.transactions.length === 1 ? '' : 's'}`;

    const pnlEl = document.getElementById('pnl');
    const sign = pnl >= 0 ? '+' : '';
    pnlEl.textContent = `${sign}${formatMoney(pnl, DEFAULT_CURRENCY)} (${sign}${formatNumber(pnlPct, 2)}%) vs start`;
    pnlEl.className = `pnl ${pnl >= 0 ? 'positive' : 'negative'}`;

    populateCurrencySelects();
    renderHoldings(valuation.holdings);
    renderTransactions(portfolio.transactions);
    renderChart(portfolio.snapshots, portfolio.startingHkd);
  } catch (error) {
    showError('trade-error', error.message);
  }
}

async function previewTrade() {
  const fromCurrency = document.getElementById('trade-from').value;
  const toCurrency = document.getElementById('trade-to').value;
  const amount = Number(tradeForm.amount.value);
  const preview = document.getElementById('trade-preview');
  document.getElementById('trade-from-label').textContent = fromCurrency;

  if (!Number.isFinite(amount) || amount <= 0) {
    preview.textContent = 'Enter an amount to preview conversion.';
    return;
  }

  try {
    const { rate } = await getCrossRate(fromCurrency, toCurrency);
    const converted = Math.round(amount * rate * 100) / 100;
    preview.textContent =
      `${formatMoney(amount, fromCurrency)} → ${formatMoney(converted, toCurrency)} ` +
      `(1 ${fromCurrency} = ${formatNumber(rate, 6)} ${toCurrency})`;
  } catch {
    preview.textContent = 'Could not fetch live rate for preview.';
  }
}

async function handleSetup(event) {
  event.preventDefault();
  showError('setup-error', '');

  const form = new FormData(setupForm);
  const startingHkd = Number(form.get('startingHkd'));

  if (!Number.isFinite(startingHkd) || startingHkd < MIN_STARTING_HKD) {
    showError('setup-error', `Starting balance must be at least ${MIN_STARTING_HKD} HKD.`);
    return;
  }

  try {
    const portfolio = createEmptyPortfolio(startingHkd);
    const { hkdRates } = await refreshRates({ force: true });
    seedInitialSnapshot(portfolio, hkdRates);
    savePortfolio(portfolio);
    await renderDashboard();
  } catch (error) {
    showError('setup-error', error.message);
  }
}

async function handleTrade(event) {
  event.preventDefault();
  showError('trade-error', '');

  const form = new FormData(tradeForm);
  const fromCurrency = String(form.get('fromCurrency'));
  const toCurrency = String(form.get('toCurrency'));
  const amount = Number(form.get('amount'));

  try {
    await executeTrade({ fromCurrency, toCurrency, amount });
    tradeForm.amount.value = '';
    await renderDashboard();
  } catch (error) {
    showError('trade-error', error.message);
  }
}

function handleExport() {
  try {
    const payload = exportPortfolio();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `fxsim-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

async function handleImport(event, { fromSetup = false } = {}) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    if (getPortfolio()) {
      const confirmed = window.confirm(
        'Replace your current portfolio with the imported backup?',
      );
      if (!confirmed) return;
    }

    importPortfolio(payload);
    if (fromSetup) {
      setupForm.reset();
      setupForm.startingHkd.value = DEFAULT_STARTING_HKD;
    }
    await renderDashboard();
  } catch (error) {
    alert(error.message);
  }
}

function handleReset() {
  const confirmed = window.confirm(
    'Reset your portfolio? This clears all data from this browser. Export a backup first if you want to keep it.',
  );
  if (!confirmed) return;

  clearPortfolio();
  setupForm.reset();
  setupForm.startingHkd.value = DEFAULT_STARTING_HKD;
  showView('setup');
}

function init() {
  populateCurrencySelects();

  setupForm.addEventListener('submit', handleSetup);
  tradeForm.addEventListener('submit', handleTrade);

  tradeForm.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewTrade, 250);
  });

  document.getElementById('trade-from').addEventListener('change', previewTrade);
  document.getElementById('trade-to').addEventListener('change', previewTrade);

  document.getElementById('btn-reset').addEventListener('click', handleReset);
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-refresh-rates').addEventListener('click', async () => {
    await refreshRates({ force: true });
    await snapshotOnRefresh();
    await renderDashboard();
  });

  importFile.addEventListener('change', handleImport);
  setupImportFile.addEventListener('change', (event) => handleImport(event, { fromSetup: true }));

  renderDashboard();
}

init();
