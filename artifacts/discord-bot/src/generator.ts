import axios from "axios";

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
  "Destroyer", "Champion", "Ace", "Rogue", "Ranger", "Phantom", "Ghost",
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

export interface RobloxAccount {
  username: string;
  password: string;
  userId: number;
  gender: string;
  birthday: string;
}

export async function createRobloxAccount(): Promise<RobloxAccount> {
  const username = generateUsername();
  const password = generatePassword();
  const birthday = generateBirthday();
  const gender = Math.random() < 0.5 ? 1 : 2; // 1=unknown/male, 2=female in Roblox API

  const birthdayStr = `${birthday.year}-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}T00:00:00.000Z`;

  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.roblox.com",
    "Referer": "https://www.roblox.com/",
  };

  // Step 1: Get CSRF token
  let csrfToken = "";
  try {
    await axios.post(
      "https://auth.roblox.com/v2/signup",
      {},
      { headers: baseHeaders }
    );
  } catch (err: any) {
    const token = err?.response?.headers?.["x-csrf-token"];
    if (token) csrfToken = token;
    else throw new Error("Could not obtain CSRF token from Roblox.");
  }

  // Step 2: Submit signup
  const payload = {
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

  const response = await axios.post(
    "https://auth.roblox.com/v2/signup",
    payload,
    {
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
    }
  );

  const userId: number = response.data?.userId ?? response.data?.user?.id ?? 0;

  const genderLabel = gender === 2 ? "Female" : "Male";
  const birthdayLabel = `${String(birthday.month).padStart(2, "0")}/${String(birthday.day).padStart(2, "0")}/${birthday.year}`;

  return {
    username,
    password,
    userId,
    gender: genderLabel,
    birthday: birthdayLabel,
  };
}
