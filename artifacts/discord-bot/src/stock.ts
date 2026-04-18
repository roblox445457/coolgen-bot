import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCK_FILE = join(__dirname, "../stock.json");

export interface Account {
  username: string;
  password: string;
  cookie: string;
}

function load(): Account[] {
  if (!existsSync(STOCK_FILE)) return [];
  try {
    return JSON.parse(readFileSync(STOCK_FILE, "utf-8")) as Account[];
  } catch {
    return [];
  }
}

function save(accounts: Account[]): void {
  writeFileSync(STOCK_FILE, JSON.stringify(accounts, null, 2), "utf-8");
}

export function addAccount(account: Account): void {
  const accounts = load();
  accounts.push(account);
  save(accounts);
}

export function popAccount(): Account | null {
  const accounts = load();
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  save(accounts);
  return account;
}

export function stockCount(): number {
  return load().length;
}
