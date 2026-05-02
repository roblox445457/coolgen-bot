import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCK_FILE = join(__dirname, "../stock.json");
const PREMIUM_STOCK_FILE = join(__dirname, "../premium-stock.json");
const GOD_STOCK_FILE = join(__dirname, "../god-stock.json");

export interface Account {
  username: string;
  password: string;
  cookie: string;
}

function loadFile(file: string): Account[] {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Account[];
  } catch {
    return [];
  }
}

function saveFile(file: string, accounts: Account[]): void {
  writeFileSync(file, JSON.stringify(accounts, null, 2), "utf-8");
}

// ── Regular stock ─────────────────────────────────────────────────────────────

export function addAccount(account: Account): void {
  const accounts = loadFile(STOCK_FILE);
  accounts.push(account);
  saveFile(STOCK_FILE, accounts);
}

export function popAccount(): Account | null {
  const accounts = loadFile(STOCK_FILE);
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(STOCK_FILE, accounts);
  return account;
}

export function stockCount(): number {
  return loadFile(STOCK_FILE).length;
}

// ── God stock ─────────────────────────────────────────────────────────────────

export function addGodAccount(account: Account): void {
  const accounts = loadFile(GOD_STOCK_FILE);
  accounts.push(account);
  saveFile(GOD_STOCK_FILE, accounts);
}

export function popGodAccount(): Account | null {
  const accounts = loadFile(GOD_STOCK_FILE);
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(GOD_STOCK_FILE, accounts);
  return account;
}

export function godStockCount(): number {
  return loadFile(GOD_STOCK_FILE).length;
}

// ── Premium stock ─────────────────────────────────────────────────────────────

export function addPremiumAccount(account: Account): void {
  const accounts = loadFile(PREMIUM_STOCK_FILE);
  accounts.push(account);
  saveFile(PREMIUM_STOCK_FILE, accounts);
}

export function popPremiumAccount(): Account | null {
  const accounts = loadFile(PREMIUM_STOCK_FILE);
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(PREMIUM_STOCK_FILE, accounts);
  return account;
}

export function premiumStockCount(): number {
  return loadFile(PREMIUM_STOCK_FILE).length;
}
