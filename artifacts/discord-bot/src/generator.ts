import axios, { AxiosInstance } from "axios";
import { solveFunCaptcha } from "./capmonster.js";

const adjectives = [
  "Cool", "Dark", "Bright", "Shadow", "Flame", "Ice", "Storm", "Swift",
  "Mighty", "Silent", "Neon", "Hyper", "Ultra", "Super", "Epic", "Mega",
  "Crazy", "Blazing", "Turbo", "Alpha", "Omega", "Lunar", "Solar", "Cosmic",
  "Elite", "Ghost", "Ninja", "Phantom", "Stealth", "Rapid", "Savage", "Toxic",
  "Blaze", "Frost", "Thunder", "Viper", "Wolf", "Dragon", "Eagle", "Shark",
];

const nouns = [
  "Player", "Gamer", "Builder", "Hero", "Slayer", "Hunter", "Warrior",
  "Coder", "Blaster", "Raider", "Knight", "Wizard", "Titan", "Legend",
  "Blade", "Striker", "Sniper", "Runner", "Master", "King", "Pro",
  "Destroyer", "Champion", "Ace", "Rogue", "Ranger", "Phantom",
  "Spark", "Storm", "Nova", "Void", "Exile", "Reaper", "Specter",
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateUsername(): string {
  const adj = randomItem(adjectives);
  const noun = randomItem(nouns);
  const num = randomInt(1, 9999);
  const formats = [
    `${adj}${noun}`,
    `${adj}${noun}${num}`,
    `${adj}_${noun}`,
    `${noun}${num}`,
    `x${adj}${noun}x`,
    `${adj}${noun}_${num}`,
  ];
  return randomItem(formats);
}

function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%";

  let password = "";
  password += upper[randomInt(0, upper.length - 1)];
  password += upper[randomInt(0, upper.length - 1)];
  password += lower[randomInt(0, lower.length - 1)];
  password += lower[randomInt(0, lower.length - 1)];
  password += digits[randomInt(0, digits.length - 1)];
  password += digits[randomInt(0, digits.length - 1)];
  password += special[randomInt(0, special.length - 1)];

  const all = upper + lower + digits;
  for (let i = 0; i < randomInt(3, 6); i++) {
    password += all[randomInt(0, all.length - 1)];
  }

  return password.split("").sort(() => Math.random() - 0.5).join("");
}

function generateBirthday(): { month: number; day: number; year: number } {
  return {
    month: randomInt(1, 12),
    day: randomInt(1, 28),
    year: randomInt(1990, 2003),
  };
}

function buildClient(): AxiosInstance {
  return axios.create({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.roblox.com",
      Referer: "https://www.roblox.com/",
    },
  });
}

export interface RobloxAccount {
  username: string;
  password: string;
  userId: number;
  gender: string;
  birthday: string;
}

export async function createRobloxAccount(
  onProgress?: (msg: string) => void
): Promise<RobloxAccount> {
  const client = buildClient();
  const username = generateUsername();
  const password = generatePassword();
  const birthday = generateBirthday();
  const gender = Math.random() < 0.5 ? 1 : 2;

  const birthdayStr = `${birthday.year}-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}T00:00:00.000Z`;

  const signupPayload = {
    username,
    password,
    birthday: birthdayStr,
    gender,
    isTosAgreementBoxChecked: true,
    agreementIds: [
      "adf95b84-cd26-4a2e-9960-68183ebd6393",
      "91b2d276-92ca-485f-b50d-c3952faa1b6a",
    ],
  };

  onProgress?.(`\`Step 1/4\` — Getting CSRF token from Roblox`);

  // Step 1: Get CSRF token
  let csrfToken = "";
  try {
    await client.post("https://auth.roblox.com/v2/signup", {});
  } catch (err: any) {
    csrfToken = err?.response?.headers?.["x-csrf-token"] ?? "";
  }
  if (!csrfToken) throw new Error("Could not obtain CSRF token.");

  onProgress?.(`\`Step 2/4\` — Triggering Roblox challenge...`);

  // Step 2: First signup attempt — expect challenge
  let challengeId = "";
  try {
    const res = await client.post(
      "https://auth.roblox.com/v2/signup",
      signupPayload,
      { headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" } }
    );
    // If it somehow succeeds without a challenge
    const userId = res.data?.userId ?? 0;
    return buildResult(username, password, userId, gender, birthday);
  } catch (err: any) {
    const headers = err?.response?.headers ?? {};
    challengeId = headers["rblx-challenge-id"] ?? "";
    const challengeType = headers["rblx-challenge-type"] ?? "";

    if (!challengeId || challengeType !== "arkose") {
      const errMsg = err?.response?.data?.errors?.[0]?.message ?? err?.message ?? "Unknown";
      throw new Error(errMsg);
    }
    console.log(`Got challenge ID: ${challengeId}`);
  }

  // Step 3: Fetch challenge info (arkose blob)
  const infoRes = await client.get(
    `https://apis.roblox.com/challenge/v1/info`,
    { params: { challengeId } }
  );
  const blob: string = infoRes.data?.challengeMetaData?.dataExchangeBlob ?? "";
  const unifiedCaptchaId: string = infoRes.data?.challengeMetaData?.unifiedCaptchaId ?? "";
  if (!blob) throw new Error("Could not get Arkose blob from Roblox challenge info.");

  onProgress?.(`\`Step 3/4\` — Solving CAPTCHA via CapMonster (this may take ~30s)...`);
  console.log(`Got arkose blob, sending to CapMonster...`);

  // Step 4: Solve with CapMonster
  const captchaToken = await solveFunCaptcha(blob);

  onProgress?.(`\`Step 4/4\` — Submitting solved challenge & creating account...`);

  // Step 5: Submit solved token back to Roblox challenge system
  const continueRes = await client.post(
    "https://apis.roblox.com/challenge/v1/continue",
    {
      challengeId,
      challengeType: "arkose",
      challengeMetaData: {
        unifiedCaptchaId,
        captchaToken,
        actionType: "Signup",
      },
    },
    { headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" } }
  );
  const challengeMetadata: string = continueRes.data?.challengeMetaData ?? "";
  if (!challengeMetadata) throw new Error("Challenge continue did not return metadata.");
  console.log("Challenge verified, retrying signup...");

  // Step 6: Retry signup with verified challenge headers
  const finalRes = await client.post(
    "https://auth.roblox.com/v2/signup",
    signupPayload,
    {
      headers: {
        "x-csrf-token": csrfToken,
        "Content-Type": "application/json",
        "rblx-challenge-id": challengeId,
        "rblx-challenge-type": "arkose",
        "rblx-challenge-metadata": challengeMetadata,
      },
    }
  );

  const userId = finalRes.data?.userId ?? finalRes.data?.user?.id ?? 0;
  console.log(`Account created! userId=${userId} username=${username}`);
  return buildResult(username, password, userId, gender, birthday);
}

function buildResult(
  username: string,
  password: string,
  userId: number,
  gender: number,
  birthday: { month: number; day: number; year: number }
): RobloxAccount {
  return {
    username,
    password,
    userId,
    gender: gender === 2 ? "Female" : "Male",
    birthday: `${String(birthday.month).padStart(2, "0")}/${String(birthday.day).padStart(2, "0")}/${birthday.year}`,
  };
}
