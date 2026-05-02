import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEYS_FILE = join(__dirname, "../api-keys.json");
const API_DATA_FILE = join(__dirname, "../api-data.json");

export interface UserApiData {
  key: string;
  webhook?: string;
}

function loadApiKeys(): string[] {
  if (!existsSync(API_KEYS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(API_KEYS_FILE, "utf-8")) as string[];
  } catch {
    return [];
  }
}

function saveApiKeys(keys: string[]): void {
  writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");
}

function loadApiData(): Record<string, UserApiData> {
  if (!existsSync(API_DATA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(API_DATA_FILE, "utf-8")) as Record<string, UserApiData>;
  } catch {
    return {};
  }
}

function saveApiData(data: Record<string, UserApiData>): void {
  writeFileSync(API_DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function addApiKeys(keys: string[]): number {
  const existing = loadApiKeys();
  const newKeys = keys.filter((k) => k.length > 0 && !existing.includes(k));
  saveApiKeys([...existing, ...newKeys]);
  return newKeys.length;
}

export function apiKeyPoolCount(): number {
  return loadApiKeys().length;
}

export type RedeemResult = "success" | "already_has_key" | "invalid";

export function redeemKey(userId: string, key: string): RedeemResult {
  const data = loadApiData();
  if (data[userId]) return "already_has_key";
  const keys = loadApiKeys();
  const idx = keys.indexOf(key.trim());
  if (idx === -1) return "invalid";
  keys.splice(idx, 1);
  saveApiKeys(keys);
  data[userId] = { key };
  saveApiData(data);
  return "success";
}

export function resetHwid(userId: string): boolean {
  const data = loadApiData();
  if (!data[userId]) return false;
  delete data[userId];
  saveApiData(data);
  return true;
}

export type SetWebhookResult = "success" | "no_key";

export function setWebhook(userId: string, url: string): SetWebhookResult {
  const data = loadApiData();
  if (!data[userId]) return "no_key";
  data[userId].webhook = url;
  saveApiData(data);
  return "success";
}

export function getApiData(userId: string): UserApiData | null {
  const data = loadApiData();
  return data[userId] ?? null;
}
