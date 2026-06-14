import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EPICGAMES_STOCK_FILE = join(__dirname, "../epicgames-stock.json");

export interface EpicAccount {
  email: string;
  password: string;
}

function loadFile(): EpicAccount[] {
  if (!existsSync(EPICGAMES_STOCK_FILE)) return [];
  try {
    return JSON.parse(readFileSync(EPICGAMES_STOCK_FILE, "utf-8")) as EpicAccount[];
  } catch {
    return [];
  }
}

function saveFile(accounts: EpicAccount[]): void {
  const tmp = EPICGAMES_STOCK_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(accounts, null, 2), "utf-8");
  renameSync(tmp, EPICGAMES_STOCK_FILE);
}

export function addEpicAccount(account: EpicAccount): void {
  const accounts = loadFile();
  accounts.push(account);
  saveFile(accounts);
}

export function popEpicAccount(): EpicAccount | null {
  const accounts = loadFile();
  if (accounts.length === 0) return null;
  const account = accounts.shift()!;
  saveFile(accounts);
  return account;
}

export function epicStockCount(): number {
  return loadFile().length;
}

export function getAllEpicAccounts(): EpicAccount[] {
  return loadFile();
}
