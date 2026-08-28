import { EXPORT_FORMAT, EXPORT_VERSION, STORAGE_KEYS } from './constants.js';

function readAccounts() {
  const raw = localStorage.getItem(STORAGE_KEYS.accounts);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAccounts(accounts) {
  localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(accounts));
}

export function getSession() {
  const raw = localStorage.getItem(STORAGE_KEYS.session);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(email) {
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify({ email }));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

export function getAccount(email) {
  const accounts = readAccounts();
  return accounts[email.toLowerCase()] ?? null;
}

export function saveAccount(email, account) {
  const accounts = readAccounts();
  accounts[email.toLowerCase()] = account;
  writeAccounts(accounts);
}

export function accountExists(email) {
  return Boolean(getAccount(email));
}

export function createEmptyPortfolio(startingHkd) {
  return {
    startingHkd,
    balances: { HKD: startingHkd },
    transactions: [],
    snapshots: [],
  };
}

export function exportAccount(email) {
  const account = getAccount(email);
  if (!account) {
    throw new Error('No account found to export.');
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    account: {
      email: email.toLowerCase(),
      name: account.name,
      passwordHash: account.passwordHash,
      passwordSalt: account.passwordSalt,
      portfolio: account.portfolio,
    },
  };
}

export function importAccount(payload, { replace = false } = {}) {
  if (!payload || payload.format !== EXPORT_FORMAT) {
    throw new Error('Invalid export file. Expected an FX Sim JSON backup.');
  }

  if (!payload.account?.email || !payload.account?.portfolio) {
    throw new Error('Export file is missing required account data.');
  }

  const email = payload.account.email.toLowerCase();
  const exists = accountExists(email);

  if (exists && !replace) {
    throw new Error(`Account ${email} already exists. Choose replace to overwrite.`);
  }

  const account = {
    name: payload.account.name ?? '',
    passwordHash: payload.account.passwordHash,
    passwordSalt: payload.account.passwordSalt,
    portfolio: payload.account.portfolio,
  };

  if (!account.passwordHash || !account.passwordSalt) {
    throw new Error('Export file is missing credential data.');
  }

  saveAccount(email, account);
  return email;
}
