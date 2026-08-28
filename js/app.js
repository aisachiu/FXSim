import {
  DEFAULT_CURRENCY,
  DEFAULT_STARTING_HKD,
  HISTORY_EARLIEST,
  MIN_STARTING_HKD,
  currenciesForDate,
  todayIso,
} from './constants.js';
import {
  executeTrade,
  getPortfolioView,
  seedInitialSnapshot,
  snapshotOnRefresh,
} from './portfolio.js';
import { bindRatesView, jumpSimulationToDate, refreshRatesChart, resetChartState } from './rates-view.js';
import { getCrossRate, refreshRates } from './rates.js';
import {
  applyRateContext,
  canStepForward,
  ensureTradingDays,
  getSimulation,
  initSimulation,
  isPlaying,
  setMode,
  setPlaybackSpeed,
  startPlayback,
  stepForward,
  stepToDate,
  stopPlayback,
} from './simulation.js';
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
  portfolio: document.getElementById('view-portfolio'),
  rates: document.getElementById('view-rates'),
};

const setupForm = document.getElementById('setup-form');
const setupStartDate = document.getElementById('setup-start-date');
const tradeForm = document.getElementById('trade-form');
const importFile = document.getElementById('import-file');
const setupImportFile = document.getElementById('setup-import-file');
const tabNav = document.getElementById('tab-nav');
const simBar = document.getElementById('sim-bar');

let wealthChart = null;
let previewTimer = null;
let activeTab = 'portfolio';

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
  }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

function formatDateTime(iso) {
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

function showAppChrome(show) {
  tabNav.classList.toggle('hidden', !show);
  simBar.classList.toggle('hidden', !show);
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

function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  showView(tab === 'rates' ? 'rates' : 'portfolio');
}

function populateCurrencySelects(simulationDate) {
  const allowed = currenciesForDate(simulationDate);
  const from = document.getElementById('trade-from');
  const to = document.getElementById('trade-to');
  const previousFrom = from.value || DEFAULT_CURRENCY;
  const previousTo = to.value || 'USD';

  from.innerHTML = '';
  to.innerHTML = '';

  for (const code of allowed) {
    from.append(new Option(code, code));
    to.append(new Option(code, code));
  }

  from.value = allowed.includes(previousFrom) ? previousFrom : DEFAULT_CURRENCY;
  to.value = allowed.includes(previousTo) ? previousTo : allowed.find((c) => c !== from.value) ?? 'USD';
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
      <td>${formatDateTime(tx.at)}</td>
      <td class="num">${formatMoney(tx.fromAmount, tx.fromCurrency)}</td>
      <td class="num">${formatMoney(tx.toAmount, tx.toCurrency)}</td>
      <td class="num">1 ${tx.fromCurrency} = ${formatNumber(tx.rate, 6)} ${tx.toCurrency}</td>
    `;
    body.appendChild(tr);
  }
}

function renderWealthChart(snapshots, startingHkd) {
  const canvas = document.getElementById('wealth-chart');
  const labels = snapshots.map((point) => formatDate(point.at));
  const values = snapshots.map((point) => point.totalValueHkd);

  if (labels.length === 0) {
    labels.push(formatDate(todayIso()));
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

function updateSimulationControls(simulation) {
  document.getElementById('sim-current-date').textContent = formatDate(simulation.currentDate);
  document.getElementById('sim-mode-label').textContent =
    simulation.mode === 'historical' ? 'Historical' : 'Live';
  document.getElementById('sim-mode').value = simulation.mode;
  document.getElementById('sim-speed').value = String(simulation.playbackSpeed);
  document.getElementById('sim-speed-label').textContent = `${simulation.playbackSpeed}×`;

  const jumpInput = document.getElementById('sim-jump-date');
  jumpInput.min = simulation.startDate;
  jumpInput.max = todayIso();
  jumpInput.value = simulation.currentDate;

  const playButton = document.getElementById('btn-play');
  playButton.textContent = isPlaying() ? '⏸' : '▶';
  playButton.disabled = simulation.mode !== 'historical';
  document.getElementById('btn-step').disabled =
    simulation.mode !== 'historical' || !canStepForward(simulation);

  const historicalControlsDisabled = simulation.mode !== 'historical';
  document.getElementById('sim-speed').disabled = historicalControlsDisabled;
  document.getElementById('btn-jump').disabled = historicalControlsDisabled;
  jumpInput.disabled = historicalControlsDisabled;
}

async function refreshAllViews() {
  if (!getPortfolio()) {
    showAppChrome(false);
    showView('setup');
    return;
  }

  showAppChrome(true);
  const simulation = getSimulation();
  applyRateContext(simulation);

  if (simulation.mode === 'historical') {
    await ensureTradingDays(simulation.startDate, todayIso());
  }

  updateSimulationControls(simulation);

  if (activeTab === 'portfolio') {
    await renderPortfolio();
  } else {
    await refreshRatesChart(handleChartDateSelect);
  }
}

async function renderPortfolio() {
  try {
    await snapshotOnRefresh();
    const data = await getPortfolioView();
    const { portfolio, valuation, pnl, pnlPct, simulation, ratesDate } = data;

    document.getElementById('rates-updated').textContent =
      simulation.mode === 'historical'
        ? `Rates as of ${formatDate(ratesDate)} · simulation date`
        : `Live rates as of ${formatDate(ratesDate)}`;

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

    populateCurrencySelects(simulation.currentDate);
    renderHoldings(valuation.holdings);
    renderTransactions(portfolio.transactions);
    renderWealthChart(portfolio.snapshots, portfolio.startingHkd);
    updateSimulationControls(simulation);
  } catch (error) {
    showError('trade-error', error.message);
  }
}

async function handleChartDateSelect(date) {
  try {
    stopPlayback();
    await jumpSimulationToDate(date, refreshAllViews);
  } catch (error) {
    alert(error.message);
  }
}

async function previewTrade() {
  const simulation = getSimulation();
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
    const rateDate = simulation.mode === 'historical' ? simulation.currentDate : undefined;
    const { rate } = await getCrossRate(fromCurrency, toCurrency, { date: rateDate });
    const converted = Math.round(amount * rate * 100) / 100;
    preview.textContent =
      `${formatMoney(amount, fromCurrency)} → ${formatMoney(converted, toCurrency)} ` +
      `(1 ${fromCurrency} = ${formatNumber(rate, 6)} ${toCurrency})`;
  } catch {
    preview.textContent = 'Could not fetch rate for preview.';
  }
}

async function handleSetup(event) {
  event.preventDefault();
  showError('setup-error', '');

  const form = new FormData(setupForm);
  const startingHkd = Number(form.get('startingHkd'));
  const startDate = String(form.get('startDate'));

  if (!Number.isFinite(startingHkd) || startingHkd < MIN_STARTING_HKD) {
    showError('setup-error', `Starting balance must be at least ${MIN_STARTING_HKD} HKD.`);
    return;
  }

  if (!startDate) {
    showError('setup-error', 'Choose a simulation start date.');
    return;
  }

  try {
    const portfolio = createEmptyPortfolio(startingHkd, startDate);
    initSimulation(startDate);
    applyRateContext(getSimulation());

    const { hkdRates } = await refreshRates({
      date: getSimulation().mode === 'historical' ? getSimulation().currentDate : undefined,
      force: true,
    });

    seedInitialSnapshot(
      portfolio,
      hkdRates,
      `${getSimulation().currentDate}T12:00:00.000Z`,
    );
    savePortfolio(portfolio);

    setActiveTab('portfolio');
    await refreshAllViews();
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
    await refreshAllViews();
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
    const stamp = todayIso();
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

    stopPlayback();
    importPortfolio(payload);
    applyRateContext(getSimulation());

    if (fromSetup) {
      setupForm.reset();
      setupForm.startingHkd.value = DEFAULT_STARTING_HKD;
      setupStartDate.value = '2010-01-05';
    }

    setActiveTab('portfolio');
    await refreshAllViews();
  } catch (error) {
    alert(error.message);
  }
}

function handleReset() {
  const confirmed = window.confirm(
    'Reset your portfolio? This clears all data from this browser. Export a backup first if you want to keep it.',
  );
  if (!confirmed) return;

  stopPlayback();
  resetChartState();
  clearPortfolio();
  setupForm.reset();
  setupForm.startingHkd.value = DEFAULT_STARTING_HKD;
  setupStartDate.value = '2010-01-05';
  showAppChrome(false);
  showView('setup');
}

async function handlePlayPause() {
  const simulation = getSimulation();
  if (simulation.mode !== 'historical') return;

  if (isPlaying()) {
    stopPlayback();
    updateSimulationControls(getSimulation());
    return;
  }

  startPlayback(refreshAllViews);
  updateSimulationControls(getSimulation());
}

async function handleStep() {
  try {
    const advanced = await stepForward();
    if (!advanced) {
      stopPlayback();
    }
    await refreshAllViews();
  } catch (error) {
    alert(error.message);
  }
}

async function handleJump() {
  const target = document.getElementById('sim-jump-date').value;
  if (!target) return;

  try {
    stopPlayback();
    await stepToDate(target);
    await refreshAllViews();
  } catch (error) {
    alert(error.message);
  }
}

async function handleModeChange() {
  const mode = document.getElementById('sim-mode').value;
  stopPlayback();
  setMode(mode);
  await refreshAllViews();
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', async () => {
      setActiveTab(button.dataset.tab);
      await refreshAllViews();
    });
  });
}

function init() {
  setupStartDate.min = HISTORY_EARLIEST;
  setupStartDate.max = todayIso();
  setupStartDate.value = '2010-01-05';

  bindTabs();
  bindRatesView(handleChartDateSelect);

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
  document.getElementById('btn-play').addEventListener('click', handlePlayPause);
  document.getElementById('btn-step').addEventListener('click', handleStep);
  document.getElementById('btn-jump').addEventListener('click', handleJump);
  document.getElementById('sim-mode').addEventListener('change', handleModeChange);

  document.getElementById('sim-speed').addEventListener('input', (event) => {
    const speed = Number(event.target.value);
    document.getElementById('sim-speed-label').textContent = `${speed}×`;
    setPlaybackSpeed(speed);
  });

  importFile.addEventListener('change', handleImport);
  setupImportFile.addEventListener('change', (event) => handleImport(event, { fromSetup: true }));

  if (getPortfolio()) {
    applyRateContext(getSimulation());
    setActiveTab('portfolio');
    refreshAllViews();
  } else {
    showAppChrome(false);
    showView('setup');
  }
}

init();
