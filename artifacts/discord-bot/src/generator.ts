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

const emailDomains = [
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "protonmail.com", "mail.com", "zoho.com",
];

const countries = [
  "United States", "Canada", "United Kingdom", "Australia", "Germany",
  "France", "Netherlands", "Sweden", "Norway", "Finland", "Denmark",
  "New Zealand", "Switzerland", "Austria", "Belgium",
];

const wordList = [
  "apple", "river", "cloud", "stone", "light", "dream", "spark", "flame",
  "ocean", "tiger", "maple", "quest", "brave", "storm", "frost", "ember",
  "lunar", "solar", "grace", "amber", "cedar", "crisp", "delta", "eagle",
  "forge", "globe", "haven", "ivory", "jewel", "karma", "lance", "might",
  "north", "orbit", "peace", "quill", "reign", "shine", "trail", "unity",
  "valor", "winds", "xenon", "yield", "zephyr", "arise", "bliss", "crane",
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
  const special = "!@#$%^&*";

  let password = "";
  password += upper[randomInt(0, upper.length - 1)];
  password += upper[randomInt(0, upper.length - 1)];
  password += lower[randomInt(0, lower.length - 1)];
  password += lower[randomInt(0, lower.length - 1)];
  password += digits[randomInt(0, digits.length - 1)];
  password += digits[randomInt(0, digits.length - 1)];
  password += special[randomInt(0, special.length - 1)];
  password += special[randomInt(0, special.length - 1)];

  const all = upper + lower + digits + special;
  for (let i = 0; i < randomInt(4, 8); i++) {
    password += all[randomInt(0, all.length - 1)];
  }

  return password.split("").sort(() => Math.random() - 0.5).join("");
}

function generateEmail(username: string): string {
  const domain = randomItem(emailDomains);
  const num = randomInt(1, 999);
  const formats = [
    `${username.toLowerCase()}@${domain}`,
    `${username.toLowerCase()}${num}@${domain}`,
    `${username.toLowerCase()}.${randomInt(1, 99)}@${domain}`,
  ];
  return randomItem(formats);
}

function generateDisplayName(): string {
  const firstNames = [
    "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery",
    "Quinn", "Skyler", "Cameron", "Blake", "Drew", "Reese", "Logan",
    "Peyton", "Sam", "Charlie", "Finley", "Sage", "River",
  ];
  const lastNames = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson",
    "White", "Harris", "Martin", "Thompson", "Young", "Allen",
  ];
  return `${randomItem(firstNames)} ${randomItem(lastNames)}`;
}

function generateDateOfBirth(): string {
  const year = randomInt(1980, 2003);
  const month = randomInt(1, 12);
  const day = randomInt(1, 28);
  const monthStr = month.toString().padStart(2, "0");
  const dayStr = day.toString().padStart(2, "0");
  return `${monthStr}/${dayStr}/${year}`;
}

function generatePin(): string {
  return randomInt(1000, 9999).toString();
}

function generateRecoveryPhrase(): string {
  const words: string[] = [];
  const shuffled = [...wordList].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 12; i++) {
    words.push(shuffled[i]);
  }
  return words.join(" ");
}

export interface RobloxAccount {
  username: string;
  password: string;
  email: string;
  displayName: string;
  dateOfBirth: string;
  gender: string;
  country: string;
  pin: string;
  recoveryPhrase: string;
}

export function generateRobloxAccount(): RobloxAccount {
  const username = generateUsername();
  return {
    username,
    password: generatePassword(),
    email: generateEmail(username),
    displayName: generateDisplayName(),
    dateOfBirth: generateDateOfBirth(),
    gender: Math.random() < 0.5 ? "Male" : "Female",
    country: randomItem(countries),
    pin: generatePin(),
    recoveryPhrase: generateRecoveryPhrase(),
  };
}
