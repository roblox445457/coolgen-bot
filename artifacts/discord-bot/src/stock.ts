import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCK_FILE = join(__dirname, "../stock.json");
const PREMIUM_STOCK_FILE = join(__dirname, "../premium-stock.json");
const GOD_STOCK_FILE = join(__dirname, "../god-stock.json");
const AGE_GROUP_STOCK_FILE = join(__dirname, "../age-group-stock.json");
const RARE_STOCK_FILE = join(__dirname, "../rare-stock.json");

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
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(accounts, null, 2), "utf-8");
  renameSync(tmp, file);
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

// ── Age Group stock ───────────────────────────────────────────────────────────

export function addAgeGroupAccount(account: Account): void {
  const accounts = loadFile(AGE_GROUP_STOCK_FILE);
  accounts.push(account);
  saveFile(AGE_GROUP_STOCK_FILE, accounts);
}

export function popAgeGroupAccount(): Account | null {
  const accounts = loadFile(AGE_GROUP_STOCK_FILE);
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(AGE_GROUP_STOCK_FILE, accounts);
  return account;
}

export function ageGroupStockCount(): number {
  return loadFile(AGE_GROUP_STOCK_FILE).length;
}

// ── Rare Usernames stock ──────────────────────────────────────────────────────

export function addRareAccount(account: Account): void {
  const accounts = loadFile(RARE_STOCK_FILE);
  accounts.push(account);
  saveFile(RARE_STOCK_FILE, accounts);
}

export function popRareAccount(): Account | null {
  const accounts = loadFile(RARE_STOCK_FILE);
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(RARE_STOCK_FILE, accounts);
  return account;
}

export function rareStockCount(): number {
  return loadFile(RARE_STOCK_FILE).length;
}

// ── Dump stock ────────────────────────────────────────────────────────────────

const DUMP_STOCK_FILE = join(__dirname, "../dump-stock.json");

export function addDumpAccount(account: Account): void {
  const accounts = loadFile(DUMP_STOCK_FILE);
  accounts.push(account);
  saveFile(DUMP_STOCK_FILE, accounts);
}

export function popDumpAccount(): Account | null {
  const accounts = loadFile(DUMP_STOCK_FILE);
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(DUMP_STOCK_FILE, accounts);
  return account;
}

export function dumpStockCount(): number {
  return loadFile(DUMP_STOCK_FILE).length;
}

// ── Bulk read for dump ────────────────────────────────────────────────────────

export function getAllAccounts(): Account[]         { return loadFile(STOCK_FILE); }
export function getAllPremiumAccounts(): Account[]  { return loadFile(PREMIUM_STOCK_FILE); }
export function getAllGodAccounts(): Account[]      { return loadFile(GOD_STOCK_FILE); }
export function getAllAgeGroupAccounts(): Account[] { return loadFile(AGE_GROUP_STOCK_FILE); }
export function getAllRareAccounts(): Account[]     { return loadFile(RARE_STOCK_FILE); }
export function getAllDumpAccounts(): Account[]     { return loadFile(DUMP_STOCK_FILE); }

// ── Transfer between tiers ────────────────────────────────────────────────────

const TIER_FILES: Record<string, string> = {
  free:     STOCK_FILE,
  premium:  PREMIUM_STOCK_FILE,
  god:      GOD_STOCK_FILE,
  agegroup: AGE_GROUP_STOCK_FILE,
  rare:     RARE_STOCK_FILE,
  dump:     DUMP_STOCK_FILE,
};

export function transferAccounts(from: string, to: string, count: number): number {
  const srcFile = TIER_FILES[from];
  const dstFile = TIER_FILES[to];
  if (!srcFile || !dstFile) return 0;

  const src = loadFile(srcFile);
  const moved = src.splice(0, count);
  if (moved.length === 0) return 0;

  saveFile(srcFile, src);
  const dst = loadFile(dstFile);
  saveFile(dstFile, [...dst, ...moved]);
  return moved.length;
}
