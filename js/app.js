import { CURRENCIES, DEFAULT_CURRENCY, MIN_STARTING_HKD } from './constants.js';
import { hashPassword, verifyPassword } from './crypto.js';
import {
  executeTrade,
  getPortfolioView,
  seedInitialSnapshot,
  snapshotOnRefresh,
} from './portfolio.js';
import { getCrossRate, refreshRates } from './rates.js';
import {
  accountExists,
  clearSession,
  createEmptyPortfolio,
  exportAccount,
  getAccount,
  getSession,
  importAccount,
  saveAccount,
  setSession,
} from './storage.js';

const views = {
  landing: document.getElementById('view-landing'),
  signup: document.getElementById('view-signup'),
  login: document.getElementById('view-login'),
  dashboard: document.getElementById('view-dashboard'),
};

const headerNav = document.getElementById('header-nav');
const signupForm = document.getElementById('signup-form');
const loginForm = document.getElementById('login-form');
const tradeForm = document.getElementById('trade-form');
const importFile = document.getElementById('import-file');

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
  renderHeader(name);
}

function renderHeader(activeView) {
  const session = getSession();
  headerNav.innerHTML = '';

  if (session && activeView === 'dashboard') {
    return;
  }

  if (session) {
    const dash = document.createElement('button');
    dash.className = 'btn btn-secondary btn-sm';
    dash.textContent = 'Dashboard';
    dash.dataset.nav = 'dashboard';
    headerNav.appendChild(dash);
  } else if (activeView !== 'signup' && activeView !== 'login') {
    const signup = document.createElement('button');
    signup.className = 'btn btn-primary btn-sm';
    signup.textContent = 'Sign up';
    signup.dataset.nav = 'signup';
    headerNav.appendChild(signup);
  }
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
  const session = getSession();
  if (!session) {
    showView('login');
    return;
  }

  showView('dashboard');

  try {
    await snapshotOnRefresh(session.email);
    const data = await getPortfolioView(session.email);
    const { portfolio, valuation, pnl, pnlPct } = data;

    document.getElementById('dashboard-greeting').textContent =
      data.name ? `${data.name}'s portfolio` : 'Your portfolio';
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

async function handleSignup(event) {
  event.preventDefault();
  showError('signup-error', '');

  const form = new FormData(signupForm);
  const name = String(form.get('name')).trim();
  const email = String(form.get('email')).trim().toLowerCase();
  const password = String(form.get('password'));
  const startingHkd = Number(form.get('startingHkd'));

  if (!email || !password) {
    showError('signup-error', 'Email and password are required.');
    return;
  }

  if (password.length < 6) {
    showError('signup-error', 'Password must be at least 6 characters.');
    return;
  }

  if (!Number.isFinite(startingHkd) || startingHkd < MIN_STARTING_HKD) {
    showError('signup-error', `Starting balance must be at least ${MIN_STARTING_HKD} HKD.`);
    return;
  }

  if (accountExists(email)) {
    showError('signup-error', 'An account with this email already exists.');
    return;
  }

  try {
    const { passwordHash, passwordSalt } = await hashPassword(password);
    const portfolio = createEmptyPortfolio(startingHkd);
    const { hkdRates } = await refreshRates({ force: true });
    seedInitialSnapshot(portfolio, hkdRates);

    saveAccount(email, {
      name,
      passwordHash,
      passwordSalt,
      portfolio,
    });

    setSession(email);
    signupForm.reset();
    await renderDashboard();
  } catch (error) {
    showError('signup-error', error.message);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  showError('login-error', '');

  const form = new FormData(loginForm);
  const email = String(form.get('email')).trim().toLowerCase();
  const password = String(form.get('password'));

  const stored = getAccount(email);

  if (!stored) {
    showError('login-error', 'No account found for this email.');
    return;
  }

  const valid = await verifyPassword(password, stored.passwordHash, stored.passwordSalt);
  if (!valid) {
    showError('login-error', 'Incorrect password.');
    return;
  }

  setSession(email);
  loginForm.reset();
  await renderDashboard();
}

async function handleTrade(event) {
  event.preventDefault();
  showError('trade-error', '');

  const session = getSession();
  if (!session) {
    showView('login');
    return;
  }

  const form = new FormData(tradeForm);
  const fromCurrency = String(form.get('fromCurrency'));
  const toCurrency = String(form.get('toCurrency'));
  const amount = Number(form.get('amount'));

  try {
    await executeTrade(session.email, { fromCurrency, toCurrency, amount });
    tradeForm.amount.value = '';
    await renderDashboard();
  } catch (error) {
    showError('trade-error', error.message);
  }
}

function handleExport() {
  const session = getSession();
  if (!session) return;

  try {
    const payload = exportAccount(session.email);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `fxsim-${session.email.replace(/[^a-z0-9]/gi, '-')}-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const email = payload.account?.email?.toLowerCase();
    const exists = email && accountExists(email);
    const replace = exists
      ? window.confirm(
          `Account ${email} already exists on this device. Replace it with the imported backup?`,
        )
      : false;

    if (exists && !replace) {
      return;
    }

    const importedEmail = importAccount(payload, { replace });
    const loginNow = window.confirm(
      `Import successful for ${importedEmail}. Log in with this account now?`,
    );

    if (loginNow) {
      setSession(importedEmail);
      await renderDashboard();
    }
  } catch (error) {
    alert(error.message);
  }
}

function bindNavigation() {
  document.body.addEventListener('click', (event) => {
    const target = event.target.closest('[data-nav]');
    if (!target) return;
    event.preventDefault();
    const view = target.dataset.nav;
    if (view === 'dashboard') {
      renderDashboard();
    } else {
      showView(view);
    }
  });
}

function init() {
  bindNavigation();
  populateCurrencySelects();

  signupForm.addEventListener('submit', handleSignup);
  loginForm.addEventListener('submit', handleLogin);
  tradeForm.addEventListener('submit', handleTrade);

  tradeForm.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewTrade, 250);
  });

  document.getElementById('trade-from').addEventListener('change', previewTrade);
  document.getElementById('trade-to').addEventListener('change', previewTrade);

  document.getElementById('btn-logout').addEventListener('click', () => {
    clearSession();
    showView('landing');
  });

  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-refresh-rates').addEventListener('click', async () => {
    const session = getSession();
    if (!session) return;
    await refreshRates({ force: true });
    await snapshotOnRefresh(session.email);
    await renderDashboard();
  });

  importFile.addEventListener('change', handleImport);

  const session = getSession();
  if (session) {
    renderDashboard();
  } else {
    showView('landing');
  }
}

init();
