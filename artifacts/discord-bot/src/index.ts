  import {
    Client,
    GatewayIntentBits,
    Message,
    EmbedBuilder,
    TextChannel,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Interaction,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ComponentType,
    AttachmentBuilder,
    User,
    ButtonInteraction,
    MessageComponentInteraction,
  } from "discord.js";
  import axios from "axios";
  import * as fs from "fs";
  import {
    Account,
    addAccount, popAccount, stockCount,
    addGodAccount, popGodAccount, godStockCount,
    addPremiumAccount, popPremiumAccount, premiumStockCount,
    addAgeGroupAccount, popAgeGroupAccount, ageGroupStockCount,
    addRareAccount, popRareAccount, rareStockCount,
    getAllAccounts, getAllGodAccounts, getAllPremiumAccounts, getAllAgeGroupAccounts, getAllRareAccounts, getAllDumpAccounts,
    addDumpAccount, popDumpAccount, dumpStockCount,
    transferAccounts,
  } from "./stock.js";
  import {
    addApiKeys, apiKeyPoolCount,
    redeemKey, resetHwid, setWebhook, getApiData,
  } from "./api-panel.js";

  interface RobloxProfile {
    userId: number;
    displayName: string;
    avatarUrl: string | null;
    createdAt: Date | null;
    ageDays: number | null;
    friends: number | null;
    followers: number | null;
    following: number | null;
    isBanned: boolean;
    hasVerifiedBadge: boolean;
    hasRobloxPlus: boolean;
  }

  async function getRobloxProfile(username: string): Promise<RobloxProfile | null> {
    try {
      // Resolve username → userId
      const userRes = await axios.post(
        "https://users.roblox.com/v1/usernames/users",
        { usernames: [username], excludeBannedUsers: false },
        { headers: { "Content-Type": "application/json" } }
      );
      const userId: number | undefined = userRes.data?.data?.[0]?.id;
      if (!userId) return null;
      

      // Fetch all details in parallel
      const [infoRes, thumbRes, friendsRes, followersRes, followingRes] = await Promise.allSettled([
        axios.get(`https://users.roblox.com/v1/users/${userId}`),
        axios.get("https://thumbnails.roblox.com/v1/users/avatar-headshot", {
          params: { userIds: userId, size: "150x150", format: "Png", isCircular: false },
        }),
        axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
        axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
        axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
      ]);

      const info = infoRes.status === "fulfilled" ? infoRes.value.data : null;
      const avatarUrl =
        thumbRes.status === "fulfilled"
          ? (thumbRes.value.data?.data?.[0]?.imageUrl ?? null)
          : null;

      const createdAt = info?.created ? new Date(info.created) : null;
      const ageDays = createdAt
        ? Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const friends =
        friendsRes.status === "fulfilled" ? (friendsRes.value.data?.count ?? null) : null;
      const followers =
        followersRes.status === "fulfilled" ? (followersRes.value.data?.count ?? null) : null;
      const following =
        followingRes.status === "fulfilled" ? (followingRes.value.data?.count ?? null) : null;

      return {
        userId,
        displayName: info?.displayName ?? username,
        avatarUrl,
        createdAt,
        ageDays,
        friends,
        followers,
        following,
        isBanned: info?.isBanned ?? false,
        hasVerifiedBadge: info?.hasVerifiedBadge ?? false,
        hasRobloxPlus: false, // ✅ add this line (or your detection logic)
      };


    } catch {
      return null;
    }
  }

  const PREFIX = "j!";
  const STOCK_CHANNEL_ID = "1495106187316822128";
  const ADD_STOCK_CHANNEL_ID = "1495195376590786720";
  const STOCK_ALLOWED_USER_ID = "1230660770749087796";
  const PREMIUM_ROLE_ID = "1495200351710613566";
  const GOD_ROLE_ID = "1499806905697042492";
  const STATUS_ROLE_ID = "1505227536379019444";
  const REQUIRED_STATUS = "BEST ACCOUNT GEN : https://discord.gg/KzGC6wksRk";

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMembers,
    ],
  });

  // Track active addstock sessions: userId -> step + collected data
  interface Session {
    step: "username" | "password" | "cookie";
    tier: "free" | "premium" | "god" | "agegroup" | "rare" | "dump";
    username?: string;
    password?: string;
  }
  const sessions = new Map<string, Session>();

  // Locked stock tiers — users cannot generate from locked tiers
  const lockedStocks = new Set<"free" | "premium" | "god" | "agegroup" | "rare" | "dump">();

  // Cooldowns — can be adjusted at runtime with j!setcooldown
  let GENERATE_COOLDOWN_MS = 9 * 60 * 1000;
  let AGE_GROUP_COOLDOWN_MS = 12 * 60 * 1000;
  const BULK_GEN_COOLDOWN_MS = 15 * 60 * 1000;
  const BULK_GEN_STATUS_PENALTY_MS = 60 * 60 * 1000; // 1 hour penalty for dropping status
  const BULK_GEN_DUMP_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown
  const BULK_SNIPE_COOLDOWN_MS = 10 * 1000; // 10 sec cooldown for snipe/bulksnipe
  const generateCooldowns = new Map<string, number>();
  const ageGroupCooldowns = new Map<string, number>();
  const bulkGenCooldowns = new Map<string, number>();
  const bulkGenDumpCooldowns = new Map<string, number>();
  const bulkSnipeCooldowns = new Map<string, number>();

  // Whitelist — users who bypass all cooldowns AND can use admin commands
  const whitelistedUsers = new Set<string>();

  function isAdmin(userId: string): boolean {
    return userId === STOCK_ALLOWED_USER_ID || whitelistedUsers.has(userId);
  }

  // Blacklist — users banned from all generate commands
  const blacklistedUsers = new Set<string>();

  // Skip Daily Cooldown — tracks how many times each user has skipped today
  const cdSkipUsage = new Map<string, { date: string; count: number }>();

  function getSkipsUsed(userId: string): number {
    const today = new Date().toDateString();
    const entry = cdSkipUsage.get(userId);
    if (!entry || entry.date !== today) return 0;
    return entry.count;
  }

  function getSkipLimit(hasGod: boolean, hasPremium: boolean): number {
    if (hasGod) return 5;
    if (hasPremium) return 1;
    return 1;
  }

  function useSkip(userId: string): void {
    const today = new Date().toDateString();
    const entry = cdSkipUsage.get(userId);
    if (!entry || entry.date !== today) {
      cdSkipUsage.set(userId, { date: today, count: 1 });
    } else {
      entry.count++;
    }
    savePanelData();
  }

  function buildCooldownWithSkipEmbed(remaining: number, skipsUsed: number, skipLimit: number): EmbedBuilder {
    const mins = Math.floor(remaining / 60000);
    const secs = Math.ceil((remaining % 60000) / 1000);
    const skipsLeft = Math.max(0, skipLimit - skipsUsed);
    return new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle("⏳ Cooldown Active")
      .setDescription(
        `You must wait **${mins}m ${secs}s** before generating again.\n\n` +
        `⚡ **Skip Daily Cooldown:** \`${skipsLeft}/${skipLimit}\` skip(s) left today`
      );
  }

  function buildSkipRow(skipsLeft: number, cdType: string): ActionRowBuilder<ButtonBuilder> {
    let customId: string;
    if (cdType === "main") customId = "skip_cooldown_main";
    else if (cdType === "ag") customId = "skip_cooldown_ag";
    else customId = `skip_panel_cd:${cdType.replace("panel:", "")}`;
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(`⚡ Skip Daily Cooldown`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(skipsLeft <= 0)
    );
  }

  async function replyBlacklisted(message: Message): Promise<void> {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("🚫 You're Blacklisted")
          .setDescription("You have been blacklisted and cannot use any generate commands.\nContact a staff member if you believe this is a mistake.")
          .setFooter({ text: "CoolGEN" }),
      ],
    });
  }

  async function replyCooldownMsg(message: Message, remaining: number): Promise<void> {
    const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
    const hasGod2 = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
    const hasPremium2 = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
    const skipsUsed = getSkipsUsed(message.author.id);
    const skipLimit = getSkipLimit(hasGod2, hasPremium2);
    const skipsLeft = Math.max(0, skipLimit - skipsUsed);
    await message.reply({
      embeds: [buildCooldownWithSkipEmbed(remaining, skipsUsed, skipLimit)],
      components: [buildSkipRow(skipsLeft, "main")],
    });
  }

  async function replyAgCooldownMsg(message: Message, remaining: number): Promise<void> {
    const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
    const hasGod2 = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
    const hasPremium2 = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
    const skipsUsed = getSkipsUsed(message.author.id);
    const skipLimit = getSkipLimit(hasGod2, hasPremium2);
    const skipsLeft = Math.max(0, skipLimit - skipsUsed);
    await message.reply({
      embeds: [buildCooldownWithSkipEmbed(remaining, skipsUsed, skipLimit)],
      components: [buildSkipRow(skipsLeft, "ag")],
    });
  }
  // Tracks all sniped usernames per user
  const snipedAccounts = new Map<string, string[]>();
  // Tracks free-tier users who bulkgen'd using the status requirement
  const bulkGenStatusUsers = new Set<string>();

  // Pending multistock entries waiting for tier selection
  const pendingMultiStock = new Map<string, string[]>(); // userId → raw entries

  client.once('ready', () => {
      console.log('Bot online');

      client.user?.setPresence({
        activities: [
          {
            name: '.𝒈𝒈/𝒄𝒐𝒐𝒍𝒈𝒆𝒏',
            type: 1
          }
        ],
        status: 'online'
      });
  });
  // Fakestock — owner can set a fake count per tier to prank users
  type StockTier = "free" | "premium" | "god" | "agegroup" | "rare" | "dump";
  const fakeStockSettings = new Map<StockTier, number>(); // tier → fake count (only present when ON)

  function fakeAmount(tier: StockTier): number | null {
    return fakeStockSettings.has(tier) ? fakeStockSettings.get(tier)! : null;
  }

  // Pending accounts for users whose DMs are off
  interface PendingAccount {
    account: Account;
    tier: "free" | "premium" | "god" | "agegroup" | "rare" | "dump";
  }
  const pendingAccounts = new Map<string, PendingAccount>();

  // Pending bulk accounts for users whose DMs are off
  interface PendingBulkAccounts {
    accounts: Account[];
    color: number;
    tierBadge: string;
    cdEnd: number;
  }
  const pendingBulkAccounts = new Map<string, PendingBulkAccounts>();

  // Pending captcha verifications
  interface PendingCaptcha {
    account: Account;
    tier: "free" | "premium" | "god" | "agegroup" | "rare" | "dump";
    correctColor: string;
    originalMessage: Message | null;
    timeoutHandle: ReturnType<typeof setTimeout>;
    panelCtx?: { channelId: string; userId: string };
    panelInteraction?: MessageComponentInteraction;
  }
  const pendingCaptchas = new Map<string, PendingCaptcha>();

  // Home guild is resolved at startup from the stock channel
  let HOME_GUILD_ID: string | null = null;

  // ── Panel ─────────────────────────────────────────────────────────────────
  const PANEL_CHANNEL_ID = "1506428139172003980";
  let panelMessageId: string | null = null;

  // ── Leaderboard: userId → { tag, count } ─────────────────────────────────
  const leaderboard = new Map<string, { tag: string; count: number }>();

  // ── Restock alert subscribers ─────────────────────────────────────────────
  const restockSubscribers = new Set<string>();

  // ── Cooldown-done notification opt-ins ────────────────────────────────────
  const cdNotifyUsers = new Set<string>();

  // ── Panel data persistence ────────────────────────────────────────────────
  const PANEL_DATA_FILE = "panel-data.json";
  const STOCK_HISTORY_FILE = "stock-history.json";

  interface StockHistoryEntry { tier: string; count: number; timestamp: number; }
  let stockHistory: StockHistoryEntry[] = [];

  function loadStockHistory(): void {
    try {
      stockHistory = JSON.parse(fs.readFileSync(STOCK_HISTORY_FILE, "utf-8")) as StockHistoryEntry[];
    } catch { stockHistory = []; }
  }

  function logStockHistory(tier: string, count: number): void {
    stockHistory.push({ tier, count, timestamp: Date.now() });
    if (stockHistory.length > 50) stockHistory = stockHistory.slice(-50);
    try { fs.writeFileSync(STOCK_HISTORY_FILE, JSON.stringify(stockHistory, null, 2), "utf-8"); } catch { /* ignore */ }
  }

  function loadPanelData(): void {
    try {
      const raw = fs.readFileSync(PANEL_DATA_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (data.panelMessageId) panelMessageId = data.panelMessageId;
      if (Array.isArray(data.restockSubscribers)) {
        for (const id of data.restockSubscribers) restockSubscribers.add(id);
      }
      if (Array.isArray(data.cdNotifyUsers)) {
        for (const id of data.cdNotifyUsers) cdNotifyUsers.add(id);
      }
      if (Array.isArray(data.whitelistedUsers)) {
        for (const id of data.whitelistedUsers) whitelistedUsers.add(id);
      }
      if (Array.isArray(data.blacklistedUsers)) {
        for (const id of data.blacklistedUsers) blacklistedUsers.add(id);
      }
      if (data.cdSkipUsage && typeof data.cdSkipUsage === "object") {
        for (const [id, entry] of Object.entries(data.cdSkipUsage)) {
          const e = entry as { date: string; count: number };
          if (e.date === new Date().toDateString()) {
            cdSkipUsage.set(id, e);
          }
        }
      }
      if (data.leaderboard && typeof data.leaderboard === "object") {
        for (const [id, entry] of Object.entries(data.leaderboard)) {
          const e = entry as { tag: string; count: number };
          if (e && typeof e.tag === "string" && typeof e.count === "number") {
            leaderboard.set(id, { tag: e.tag, count: e.count });
          }
        }
      }
    } catch { /* file doesn't exist yet, start fresh */ }
  }

  function savePanelData(): void {
    try {
      const data = {
        panelMessageId,
        restockSubscribers: [...restockSubscribers],
        cdNotifyUsers: [...cdNotifyUsers],
        whitelistedUsers: [...whitelistedUsers],
        blacklistedUsers: [...blacklistedUsers],
        cdSkipUsage: Object.fromEntries(cdSkipUsage),
        leaderboard: Object.fromEntries([...leaderboard.entries()].map(([k, v]) => [k, { ...v }])),
      };
      fs.writeFileSync(PANEL_DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch { /* ignore write errors */ }
  }

  // ── Panel helpers ─────────────────────────────────────────────────────────

  function buildPanelEmbed(): EmbedBuilder {
    const free     = fakeAmount("free")     ?? stockCount();
    const premium  = fakeAmount("premium")  ?? premiumStockCount();
    const god      = fakeAmount("god")      ?? godStockCount();
    const ageGroup = fakeAmount("agegroup") ?? ageGroupStockCount();
    const rare     = fakeAmount("rare")     ?? rareStockCount();
    const dump     = fakeAmount("dump")     ?? dumpStockCount();
    const total    = free + premium + god + ageGroup + rare + dump;

    const bar = (n: number) =>
      "█".repeat(Math.min(n, 10)) + "░".repeat(Math.max(0, 10 - Math.min(n, 10))) + ` \`${n}\``;

    return new EmbedBuilder()
      .setTitle("CoolGEN — Generator Panel")
      .setColor(0xe8192c)
      .setDescription("Use the buttons below to generate accounts, check stock, view the leaderboard, or manage your notifications.")
      .addFields(
        { name: "🟢 Free",        value: bar(free),     inline: true },
        { name: "⭐ Premium",     value: bar(premium),  inline: true },
        { name: "🌟 God",         value: bar(god),      inline: true },
        { name: "🎂 Age Group",   value: bar(ageGroup), inline: true },
        { name: "💎 Rare",        value: bar(rare),     inline: true },
        { name: "🗑️ Dump",        value: bar(dump),     inline: true },
        { name: "📊 Total Stock", value: `\`${total} account(s)\``, inline: false },
      )
      .setFooter({ text: `CoolGEN · ${new Date().toUTCString()}` })
      .setTimestamp();
  }

  function buildPanelRows(): ActionRowBuilder<ButtonBuilder>[] {
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_generate").setLabel("Generate").setEmoji("🎮").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("panel_stock").setLabel("Stock").setEmoji("📊").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_leaderboard").setLabel("Leaderboard").setEmoji("🏆").setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_restock").setLabel("Restock Alerts").setEmoji("🔔").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_cdnotify").setLabel("CD Notify").setEmoji("⏰").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_help").setLabel("Help").setEmoji("❓").setStyle(ButtonStyle.Secondary),
    );
    return [row1, row2];
  }

  async function postOrUpdatePanel(botClient: Client) {
    try {
      const ch = await botClient.channels.fetch(PANEL_CHANNEL_ID) as TextChannel | null;
      if (!ch) return;
      const embed = buildPanelEmbed();
      const rows  = buildPanelRows();
      if (panelMessageId) {
        const existing = await ch.messages.fetch(panelMessageId).catch(() => null);
        if (existing) {
          await existing.edit({ embeds: [embed], components: rows });
          return;
        }
      }
      const msg = await ch.send({ embeds: [embed], components: rows });
      panelMessageId = msg.id;
      savePanelData();
    } catch {
      // Channel not accessible — silently ignore
    }
  }

  async function notifyRestock(tier: StockTier, count: number) {
    if (restockSubscribers.size === 0) {
      await postOrUpdatePanel(client).catch(() => null);
      return;
    }
    const tierLabel =
      tier === "god"      ? "🌟 God"
      : tier === "premium"  ? "⭐ Premium"
      : tier === "agegroup" ? "🎂 Age Group"
      : tier === "rare"     ? "💎 Rare"
      : tier === "dump"     ? "🗑️ Dump"
      : "🟢 Free";
    const embed = new EmbedBuilder()
      .setColor(0x00c851)
      .setTitle("🔔 Restock Alert!")
      .setDescription(`**${count}** account(s) were added to **${tierLabel}** stock!\nHead over and generate before it runs out!`)
      .setFooter({ text: "CoolGEN Restock Alerts" })
      .setTimestamp();
    for (const uid of restockSubscribers) {
      try {
        const u = await client.users.fetch(uid);
        await u.send({ embeds: [embed] });
      } catch { /* DMs closed */ }
    }
    await postOrUpdatePanel(client).catch(() => null);
  }

  function scheduleCdNotify(userId: string, cooldownMs: number, user: User) {
    setTimeout(async () => {
      if (!cdNotifyUsers.has(userId)) return;
      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x00c851)
              .setTitle("⏰ Cooldown Ready!")
              .setDescription("Your generate cooldown has expired — you can generate again!\n\nUse `j!generate` or click **🎮 Generate** in the panel.")
              .setFooter({ text: "CoolGEN CD Notifications" })
              .setTimestamp(),
          ],
        });
      } catch { /* DMs closed */ }
    }, cooldownMs);
  }

  async function sendCaptchaFromPanel(channel: TextChannel, user: User, account: Account, tier: StockTier, panelInteraction?: MessageComponentInteraction) {
    const correct = CAPTCHA_COLORS[Math.floor(Math.random() * CAPTCHA_COLORS.length)];

    const captchaMsg = await channel.send({
      content: `${user}`,
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🛡️ Human Verification")
          .setDescription(
            `${user}, click the **${correct.emoji} ${correct.label}** button below.\n\n⏰ You have **30 seconds** to respond.`
          )
          .setFooter({ text: "Wrong answer or timeout returns the account to stock." }),
      ],
      components: [captchaRow()],
    });

    const timeoutHandle = setTimeout(async () => {
      if (!pendingCaptchas.has(user.id)) return;
      pendingCaptchas.delete(user.id);
      returnPendingToStock({ account, tier });
      await captchaMsg
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle("⏰ Verification Timed Out")
              .setDescription("You didn't respond in time. The account was returned to stock."),
          ],
          components: [],
        })
        .catch(() => null);
      setTimeout(() => captchaMsg.delete().catch(() => null), 5_000);
    }, 30_000);

    pendingCaptchas.set(user.id, {
      account,
      tier,
      correctColor: correct.id,
      originalMessage: null,
      panelCtx: { channelId: channel.id, userId: user.id },
      panelInteraction,
      timeoutHandle,
    });
  }

  async function deliverAccountFromPanelCtx(account: Account, tier: StockTier, channelId: string, userId: string, panelInteraction?: MessageComponentInteraction) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;
    const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (!channel) return;

    const profile = await getRobloxProfile(account.username);
    const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
    const createdStr = profile?.createdAt
      ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "N/A";
    const ageDaysStr = profile?.ageDays != null ? `${profile.ageDays.toLocaleString()} days` : "N/A";
    const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

    const tierLabel =
      tier === "god"      ? "🌟 Your God-Tier Roblox Account"
      : tier === "premium"  ? "⭐ Your Premium Roblox Account"
      : tier === "agegroup" ? "🎂 Your Age Group Roblox Account"
      : tier === "rare"     ? "💎 Your Rare Username Roblox Account"
      : tier === "dump"     ? "🗑️ Your Dump Roblox Account"
      : tier === "free"     ? "<:roblox:1508559403521933442> Your Roblox Account"
      : "🎮 Your Roblox Account";

    const color =
      tier === "god"      ? 0x9b59b6
      : tier === "premium"  ? 0xf5a623
      : tier === "agegroup" ? 0x00bcd4
      : tier === "rare"     ? 0xffd700
      : tier === "dump"     ? 0xe74c3c
      : 0x00c851;

    const dmEmbed = new EmbedBuilder()
      .setTitle(tierLabel)
      .setColor(color)
      .addFields(
        { name: "👤 Username",      value: `\`${account.username}\``,                         inline: true },
        { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``, inline: true },
        { name: "🆔 User ID",       value: `\`${profile?.userId ?? "N/A"}\``,                 inline: true },
        { name: "🔑 Password",      value: `\`${account.password}\``,                         inline: true },
        { name: "📅 Created",       value: `\`${createdStr}\``,                               inline: true },
        { name: "⏳ Account Age",   value: `\`${ageDaysStr}\``,                               inline: true },
        { name: "👫 Friends",       value: `\`${fmt(profile?.friends ?? null)}\``,            inline: true },
        { name: "👥 Followers",     value: `\`${fmt(profile?.followers ?? null)}\``,          inline: true },
        { name: "➡️ Following",     value: `\`${fmt(profile?.following ?? null)}\``,          inline: true },
      )
      .setFooter({ text: "CoolGEN Panel — Login at roblox.com" })
      .setTimestamp();

    if (profile?.avatarUrl) dmEmbed.setThumbnail(profile.avatarUrl);
    if (profileUrl) dmEmbed.setURL(profileUrl);

    const cooldownMs = tier === "agegroup" ? AGE_GROUP_COOLDOWN_MS : GENERATE_COOLDOWN_MS;
    if (tier === "agegroup") ageGroupCooldowns.set(userId, Date.now());
    else generateCooldowns.set(userId, Date.now());
    const cdEnd = Math.floor((Date.now() + cooldownMs) / 1000);

    // Track leaderboard
    const lbEntry = leaderboard.get(userId) ?? { tag: user.username, count: 0 };
    lbEntry.count++;
    lbEntry.tag = user.username;
    leaderboard.set(userId, lbEntry);
    savePanelData();

    // Schedule CD done notification
    if (cdNotifyUsers.has(userId)) scheduleCdNotify(userId, cooldownMs, user);

    try {
      await user.send({ embeds: [dmEmbed] });
      const cookieLine = account.cookie
        ? `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``
        : `⛔ **NO .ROBLOXSECURITY FOR THIS STOCK**`;
      await user.send(`${cookieLine}\n\n**Combo** \`${account.username}:${account.password}\`\n\n⚠️ **Warning: Change the Password**`);

      const channelEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle("✅ Account Generated")
        .setDescription(`${user} — Check your DMs for your account!\n⏳ Next generate: <t:${cdEnd}:R>`)
        .setFooter({ text: "CoolGEN Panel" })
        .setTimestamp();
      if (profile?.avatarUrl) channelEmbed.setThumbnail(profile.avatarUrl);
      if (panelInteraction) {
        await panelInteraction.followUp({ embeds: [channelEmbed], ephemeral: true }).catch(() =>
          channel.send({ embeds: [channelEmbed] })
        );
      } else {
        await channel.send({ embeds: [channelEmbed] });
      }
    } catch {
      pendingAccounts.set(userId, { account, tier });
      await channel.send({ content: `${user}`, embeds: [dmOffEmbed()], components: [dmOffRow()] });
    }

    await postStockWebhook(account.username, tier, profile?.avatarUrl ?? null, user);
    await postOrUpdatePanel(client).catch(() => null);
  }

  client.once("clientReady", async (c) => {
    console.log(`Bot is online as ${c.user.tag}`);
    console.log(`Prefix: ${PREFIX}`);

    // Resolve home guild from the stock channel
    try {
      const channel = await c.channels.fetch(STOCK_CHANNEL_ID);
      if (channel && "guildId" in channel) {
        HOME_GUILD_ID = channel.guildId;
        console.log(`Home guild ID: ${HOME_GUILD_ID}`);
      }
    } catch {
      console.error("Could not resolve home guild from stock channel.");
    }

    // Leave any guild that isn't home
    for (const guild of c.guilds.cache.values()) {
      if (HOME_GUILD_ID && guild.id !== HOME_GUILD_ID) {
        console.log(`Leaving non-home guild: ${guild.name} (${guild.id})`);
        await guild.leave().catch(() => null);
      }
    }

    // Load persisted panel data (subscribers, panelMessageId, etc.)
    loadPanelData();
    loadStockHistory();

    // Post the generator panel
    await postOrUpdatePanel(c).catch(() => null);
  });

  // Auto-leave any server the bot gets invited to that isn't home
  client.on("guildCreate", async (guild) => {
    if (!HOME_GUILD_ID || guild.id !== HOME_GUILD_ID) {
      console.log(`Invited to non-home guild: ${guild.name} (${guild.id}) — leaving.`);
      await guild.leave().catch(() => null);
    }
  });

  const STATUS_LOG_CHANNEL_ID = "1505228775217172561";

  client.on("presenceUpdate", async (_old, newPresence) => {
    if (!newPresence.guild || !newPresence.member) return;
    if (HOME_GUILD_ID && newPresence.guild.id !== HOME_GUILD_ID) return;

    const member = newPresence.member;
    const presenceStatus = newPresence.status; // "online" | "idle" | "dnd" | "offline" | "invisible"

    // If the user went offline or invisible, don't touch the role —
    // Discord clears activity data on disconnect so it would false-trigger removal.
    if (presenceStatus === "offline" || presenceStatus === "invisible") return;

    // Wait 3 seconds to let Discord fully settle the presence data
    await new Promise(resolve => setTimeout(resolve, 3000));

    const customStatus = newPresence.activities.find(a => a.type === 4)?.state ?? "";
    const hasStatus = customStatus.includes(REQUIRED_STATUS);
    const hasRole = member.roles.cache.has(STATUS_ROLE_ID);

    const logChannel = newPresence.guild.channels.cache.get(STATUS_LOG_CHANNEL_ID) as TextChannel | undefined;

    try {
      if (hasStatus && !hasRole) {
        await member.roles.add(STATUS_ROLE_ID);
        if (logChannel) {
          await logChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("✅ Status Set")
                .setDescription(`${member} has set the required status and received the role!`)
                .addFields(
                  { name: "👤 User", value: `${member} (\`${member.user.tag}\`)`, inline: true },
                  { name: "📝 Status", value: `\`${customStatus}\``, inline: false },
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp(),
            ],
          });
        }
      } else if (!hasStatus && hasRole) {
        await member.roles.remove(STATUS_ROLE_ID);

        // Apply 1-hour penalty if this user bulkgen'd using the status requirement
        let penaltyApplied = false;
        if (bulkGenStatusUsers.has(member.id)) {
          bulkGenStatusUsers.delete(member.id);
          // Set cooldown to expire 1 hour from now
          bulkGenCooldowns.set(member.id, Date.now() - BULK_GEN_COOLDOWN_MS + BULK_GEN_STATUS_PENALTY_MS);
          penaltyApplied = true;
        }

        if (logChannel) {
          const penaltyNote = penaltyApplied
            ? `\n⏳ **1-hour penalty** applied to \`j!bulkgen\` for dropping the status after using it.`
            : "";
          await logChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle("❌ Status Removed")
                .setDescription(`${member} removed the required status and lost the role.${penaltyNote}`)
                .addFields({ name: "👤 User", value: `${member} (\`${member.user.tag}\`)`, inline: true })
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp(),
            ],
          });
        }
      }
    } catch (err) {
      if (logChannel) {
        await logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff9900)
              .setTitle("⚠️ Role Assignment Error")
              .setDescription(`Failed to update role for ${member} (\`${member.user.tag}\`).`)
              .addFields({ name: "Error", value: `\`\`\`${String(err)}\`\`\`` })
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    }
  });

  client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== HOME_GUILD_ID) return;
    try {
      await member.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle("👋 Welcome to CoolGEN!")
            .setDescription(
              `Hey **${member.user.username}**, seems you're new here!\n\n` +
              `🟢 Use \`j!generate\` to get a free Roblox account.\n` +
              `🗑️ If free stock is off, try \`j!generatedump\` instead.\n\n` +
              `📋 Type \`j!help\` to see all available commands.`
            )
            .setFooter({ text: "CoolGEN · Enjoy your stay!" })
            .setTimestamp(),
        ],
      });
    } catch { /* user has DMs off — silently ignore */ }
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    // Ignore all DMs — bot only responds in servers
    if (!message.guild) return;

    // Handle active addstock session replies
    if (sessions.has(message.author.id)) {
      await handleSessionReply(message);
      return;
    }

    const VALID_COMMANDS = new Set([
      "generate","generatepremium","generategod","generatealt","generateagegroupalt","generaterare",
      "addstock","addpremiumstock","addgodstock","addagegroupaccounts","addrarestock","addmultistock",
      "stock","premiumstock","godstock","agegroupstock","rarestock","dumpstock","allstocks",
      "lockstock","unlockstock","lockallstocks","unlockallstocks",
      "showapipanel","addapikeys","user","accountdays","bulkgen","bulkgendump","snipe","bulksnipe","allsnipedaccs","setcooldown","help","fakestock","generatedumpexportaccounts",
    ]);

    const lowerContent = message.content.toLowerCase().trim();

    // Case-insensitive prefix match (handles J!generate, j!Generate, etc.)
    if (!lowerContent.startsWith("j!")) {
      // Fuzzy detection — patterns like !jgenerate, !j generate, j generate
      const fuzzyPatterns = [
        /^!j!?\s*(\w+)/,   // !jgenerate or !j generate
        /^j\s+(\w+)/,      // j generate (space instead of !)
      ];
      for (const pattern of fuzzyPatterns) {
        const match = lowerContent.match(pattern);
        if (match) {
          const guessed = match[1].toLowerCase();
          if (VALID_COMMANDS.has(guessed)) {
            await message.reply({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xff9900)
                  .setDescription(`❌ Wrong command format! The correct command is \`j!${guessed}\``),
              ],
            });
            return;
          }
        }
      }
      return;
    }

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args[0]?.toLowerCase();
    const subcommand = args[1]?.toLowerCase();

    if (command === "generate") {
      await handleGenerate(message);
    } else if (command === "generatepremium") {
      await handleGeneratePremium(message);
    } else if (command === "generategod") {
      await handleGenerateGod(message);
    } else if (command === "generatealt") {
      await handleGenerateAlt(message);
    } else if (command === "generateagegroupalt") {
      await handleGenerateAgeGroup(message);
    } else if (command === "generaterare") {
      await handleGenerateRare(message);
    } else if (command === "addstock") {
      await handleAddStock(message, "free");
    } else if (command === "addpremiumstock") {
      await handleAddStock(message, "premium");
    } else if (command === "addgodstock") {
      await handleAddStock(message, "god");
    } else if (command === "addagegroupaccounts") {
      await handleAddAgeGroupStock(message);
    } else if (command === "addrarestock") {
      await handleAddRareStock(message);
    } else if (command === "addmultistock") {
      await handleAddMultiStock(message, args.slice(1));
    } else if (command === "stock") {
      await handleStockCount(message);
    } else if (command === "premiumstock") {
      await handlePremiumStockCount(message);
    } else if (command === "godstock") {
      await handleGodStockCount(message);
    } else if (command === "agegroupstock") {
      await handleAgeGroupStockCount(message);
    } else if (command === "rarestock") {
      await handleRareStockCount(message);
    } else if (command === "dumpstock") {
      await handleDumpStockCount(message);
    } else if (command === "allstocks") {
      await handleAllStock(message);
    } else if (command === "lockstock") {
      await handleLockStock(message, args[1], true);
    } else if (command === "unlockstock") {
      await handleLockStock(message, args[1], false);
    } else if (command === "lockallstocks") {
      await handleLockAllStocks(message, true);
    } else if (command === "unlockallstocks") {
      await handleLockAllStocks(message, false);
    } else if (command === "showapipanel") {
      await handleShowApiPanel(message);
    } else if (command === "addapikeys") {
      await handleAddApiKeys(message, args.slice(1));
    } else if (command === "user") {
      await handleUser(message, args[1]);
    } else if (command === "accountdays") {
      await handleAccountDays(message, args[1]);
    } else if (command === "bulkgen") {
      await handleBulkGen(message);
    } else if (command === "bulkgendump") {
      await handleBulkGenDump(message);
    } else if (command === "snipe") {
      await handleSnipe(message);
    } else if (command === "bulksnipe") {
      await handleBulkSnipe(message);
    } else if (command === "allsnipedaccs") {
      await handleAllSnipedAccs(message);
    } else if (command === "setcooldown") {
      await handleSetCooldown(message, args[1], args[2]);
    } else if (command === "fakestock") {
      await handleFakeStock(message, args[1], args[2], args[3]);
    } else if (command === "generatedump") {
      await handleGenerateDump(message);
    } else if (command === "exportaccounts") {
      await handleExportAccounts(message, args[1]);
    } else if (command === "mystats") {
      await handleMyStats(message);
    } else if (command === "cd") {
      await handleCooldownCheck(message);
    } else if (command === "whitelist") {
      await handleWhitelist(message, args[1]?.toLowerCase(), args[2]);
    } else if (command === "announce") {
      await handleAnnounce(message, args.slice(1));
    } else if (command === "clearcd") {
      await handleClearCd(message, args[1]);
    } else if (command === "blacklist") {
      await handleBlacklist(message, args[1]?.toLowerCase(), args[2]);
    } else if (command === "stocklog") {
      await handleStockLog(message);
    } else if (command === "transferstock") {
      await handleTransferStock(message, args[1], args[2], args[3]);
    } else if (command === "stockhistory") {
      await handleStockHistory(message);
    } else if (command === "dsnipe") {
      await handleDSnipe(message, args[1]);
    } else if (command === "help") {
      if (subcommand === "generate") {
        await handleHelpGenerate(message);
      } else {
        await handleHelp(message);
      }
    }
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction.isButton()) {
      const id = interaction.customId;
      const userId = interaction.user.id;

      if (id === "skip_cooldown_main" || id === "skip_cooldown_ag" || id.startsWith("skip_panel_cd:")) {
        const member = await interaction.guild?.members.fetch(userId).catch(() => null);
        const hasGod2 = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
        const hasPremium2 = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
        const skipLimit = getSkipLimit(hasGod2, hasPremium2);
        const skipsUsed = getSkipsUsed(userId);

        if (skipsUsed >= skipLimit) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle("❌ No Skips Left")
                .setDescription(`You've used all **${skipLimit}** skip(s) for today. Your skips reset at midnight.`),
            ],
            ephemeral: true,
          });
          return;
        }

        useSkip(userId);
        const skipsLeft = Math.max(0, skipLimit - getSkipsUsed(userId));

        if (id === "skip_cooldown_main") {
          generateCooldowns.delete(userId);
        } else if (id === "skip_cooldown_ag") {
          ageGroupCooldowns.delete(userId);
        } else {
          const tier = id.replace("skip_panel_cd:", "") as StockTier;
          if (tier === "agegroup") ageGroupCooldowns.delete(userId);
          else generateCooldowns.delete(userId);
        }

        if (id.startsWith("skip_panel_cd:")) {
          const tier = id.replace("skip_panel_cd:", "") as StockTier;
          await interaction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("⚡ Cooldown Skipped!")
                .setDescription(`Your cooldown has been cleared! \`${skipsLeft}/${skipLimit}\` skip(s) left today.\n\nClick **🎮 Generate** in the panel to generate now.`),
            ],
            components: [],
          });
        } else {
          await interaction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("⚡ Cooldown Skipped!")
                .setDescription(`Your cooldown has been cleared! \`${skipsLeft}/${skipLimit}\` skip(s) left today.\n\nRun the generate command again to get your account.`),
            ],
            components: [],
          });
        }
        return;

      } else if (id === "dm_yes") {
        const pending = pendingAccounts.get(userId);
        if (!pending) {
          await interaction.reply({ content: "❌ No pending account found — it may have expired.", ephemeral: true });
          return;
        }
        pendingAccounts.delete(userId);
        generateCooldowns.set(userId, Date.now());

        const { account } = pending;
        const tierLabel = pending.tier === "god" ? "🌟 God-Tier" : pending.tier === "premium" ? "⭐ Premium" : pending.tier === "agegroup" ? "🎂 Age Group" : pending.tier === "rare" ? "💎 Rare Username" : "🎮";
        const color = pending.tier === "god" ? 0x9b59b6 : pending.tier === "premium" ? 0xf5a623 : pending.tier === "agegroup" ? 0x00bcd4 : pending.tier === "rare" ? 0xffd700 : 0x00c851;

        const profile = await getRobloxProfile(account.username);
        const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
        const createdStr = profile?.createdAt
          ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
          : "N/A";
        const ageDaysStr = profile?.ageDays != null ? `${profile.ageDays.toLocaleString()} days` : "N/A";
        const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

        const embed = new EmbedBuilder()
          .setTitle(`${tierLabel} Your Roblox Account`)
          .setColor(color)
          .addFields(
            { name: "👤 Username", value: `\`${account.username}\``, inline: true },
            { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``, inline: true },
            { name: "🆔 User ID", value: `\`${profile?.userId ?? "N/A"}\``, inline: true },
            { name: "🔑 Password", value: `\`${account.password}\``, inline: true },
            { name: "📅 Created", value: `\`${createdStr}\``, inline: true },
            { name: "⏳ Account Age", value: `\`${ageDaysStr}\``, inline: true },
            { name: "👫 Friends", value: `\`${fmt(profile?.friends ?? null)}\``, inline: true },
            { name: "👥 Followers", value: `\`${fmt(profile?.followers ?? null)}\``, inline: true },
            { name: "➡️ Following", value: `\`${fmt(profile?.following ?? null)}\``, inline: true },
          )
          .setFooter({ text: "Login at roblox.com — keep these credentials safe!" })
          .setTimestamp();

        if (profile?.avatarUrl) embed.setThumbnail(profile.avatarUrl);
        if (profileUrl) embed.setURL(profileUrl);

        const cookieText = account.cookie
          ? `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``
          : `⛔ **NO .ROBLOXSECURITY FOR THIS STOCK**`;
        await interaction.reply({
          embeds: [embed],
          content: `${cookieText}\n\n**Combo** \`${account.username}:${account.password}\`\n\n⚠️ **Warning: Change the Password**`,
          ephemeral: true,
        });
        await interaction.message.delete().catch(() => null);
        await postStockWebhook(account.username, pending.tier, profile?.avatarUrl ?? null, interaction.user);
        const cdEnd = Math.floor((Date.now() + GENERATE_COOLDOWN_MS) / 1000);
        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff9900)
              .setDescription(`⏳ ${interaction.user} can generate again <t:${cdEnd}:R>`),
          ],
          ephemeral: false,
        });
        return;

      } else if (id === "dm_no") {
        const pending = pendingAccounts.get(userId);
        if (pending) {
          pendingAccounts.delete(userId);
          returnPendingToStock(pending);
        }
        await interaction.reply({ content: "❌ Cancelled.", ephemeral: true });
        await interaction.message.delete().catch(() => null);
        return;

      } else if (id === "bulk_dm_yes") {
        const pending = pendingBulkAccounts.get(userId);
        if (!pending) {
          await interaction.reply({ content: "❌ No pending bulk accounts found — they may have expired.", ephemeral: true });
          return;
        }
        pendingBulkAccounts.delete(userId);
        await interaction.deferReply({ ephemeral: true });
        await interaction.message.delete().catch(() => null);

        for (let i = 0; i < pending.accounts.length; i++) {
          const account = pending.accounts[i];
          const profile = await getRobloxProfile(account.username);
          const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
          const createdStr = profile?.createdAt
            ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
            : "N/A";
          const ageDaysStr = profile?.ageDays != null ? `${profile.ageDays.toLocaleString()} days` : "N/A";
          const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

          const embed = new EmbedBuilder()
            .setTitle(`🎮 Bulk Account ${i + 1} of ${pending.accounts.length}`)
            .setColor(pending.color)
            .addFields(
              { name: "👤 Username",     value: `\`${account.username}\``,                         inline: true },
              { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``, inline: true },
              { name: "🆔 User ID",      value: `\`${profile?.userId ?? "N/A"}\``,                 inline: true },
              { name: "🔑 Password",     value: `\`${account.password}\``,                         inline: true },
              { name: "📅 Created",      value: `\`${createdStr}\``,                               inline: true },
              { name: "⏳ Account Age",  value: `\`${ageDaysStr}\``,                               inline: true },
              { name: "👫 Friends",      value: `\`${fmt(profile?.friends ?? null)}\``,            inline: true },
              { name: "👥 Followers",    value: `\`${fmt(profile?.followers ?? null)}\``,          inline: true },
              { name: "➡️ Following",    value: `\`${fmt(profile?.following ?? null)}\``,          inline: true },
            )
            .setFooter({ text: `${pending.tierBadge} · Only you can see this` })
            .setTimestamp();

          if (profile?.avatarUrl) embed.setThumbnail(profile.avatarUrl);
          if (profileUrl) embed.setURL(profileUrl);

          const cookieLine = account.cookie
            ? `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``
            : `⛔ **NO .ROBLOXSECURITY FOR THIS STOCK**`;
          const content = `${cookieLine}\n\n**Combo** \`${account.username}:${account.password}\`\n\n⚠️ **Warning: Change the Password**`;

          if (i === 0) {
            await interaction.editReply({ embeds: [embed], content });
          } else {
            await interaction.followUp({ embeds: [embed], content, ephemeral: true });
          }
        }

        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff9900)
              .setDescription(`⏳ ${interaction.user} can bulk gen again <t:${pending.cdEnd}:R>`),
          ],
          ephemeral: false,
        });
        return;

      } else if (id === "bulk_dm_no") {
        const pending = pendingBulkAccounts.get(userId);
        if (pending) {
          pendingBulkAccounts.delete(userId);
          for (const acc of pending.accounts) addAccount(acc);
          bulkGenCooldowns.delete(userId);
        }
        await interaction.reply({ content: "❌ Cancelled. Accounts returned to stock.", ephemeral: true });
        await interaction.message.delete().catch(() => null);
        return;

      } else if (id.startsWith("captcha_")) {
        const pending = pendingCaptchas.get(userId);
        if (!pending) {
          await interaction.reply({ content: "❌ No captcha found — it may have expired.", ephemeral: true });
          return;
        }
        clearTimeout(pending.timeoutHandle);
        pendingCaptchas.delete(userId);
        await interaction.message.delete().catch(() => null);

        if (id === pending.correctColor) {
          await interaction.deferUpdate().catch(() => null);
          if (pending.panelCtx) {
            await deliverAccountFromPanelCtx(pending.account, pending.tier, pending.panelCtx.channelId, pending.panelCtx.userId, pending.panelInteraction);
          } else {
            await deliverAccount(pending.account, pending.tier, pending.originalMessage!);
          }
        } else {
          if (pending.tier === "god") addGodAccount(pending.account);
          else if (pending.tier === "premium") addPremiumAccount(pending.account);
          else if (pending.tier === "agegroup") addAgeGroupAccount(pending.account);
          else if (pending.tier === "rare") addRareAccount(pending.account);
          else addAccount(pending.account);
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle("❌ Wrong Color!")
                .setDescription("Incorrect answer. The account was returned to stock.\n\nTry generating again."),
            ],
            ephemeral: true,
          });
        }
        return;

      } else if (id === "api_redeem") {
        const modal = new ModalBuilder()
          .setCustomId("modal_redeem_key")
          .setTitle("Redeem API Key");
        const input = new TextInputBuilder()
          .setCustomId("key_input")
          .setLabel("Enter your API key")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("XXXX-XXXX-XXXX-XXXX")
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);

      } else if (id === "api_reset_hwid") {
        const userId = interaction.user.id;
        const deleted = resetHwid(userId);
        if (deleted) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("✅ HWID Reset")
                .setDescription("Your API key and data have been deleted. You can redeem a new key."),
            ],
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setDescription("❌ You don't have an active API key to reset."),
            ],
            ephemeral: true,
          });
        }

      } else if (id === "api_set_webhook") {
        const userId = interaction.user.id;
        const data = getApiData(userId);
        if (!data) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setDescription("❌ You need to redeem an API key first before setting a webhook."),
            ],
            ephemeral: true,
          });
          return;
        }
        const modal = new ModalBuilder()
          .setCustomId("modal_set_webhook")
          .setTitle("Set Webhook URL");
        const input = new TextInputBuilder()
          .setCustomId("webhook_input")
          .setLabel("Discord Webhook URL")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("https://discord.com/api/webhooks/...")
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);

      } else if (id === "panel_generate") {
        const member = await interaction.guild?.members.fetch(userId).catch(() => null);
        const hasGod     = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
        const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
        const menu = new StringSelectMenuBuilder()
          .setCustomId("panel_tier_select")
          .setPlaceholder("🎮 Choose a tier to generate from...")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("🟢 Free").setValue("free").setDescription("Standard free account"),
            new StringSelectMenuOptionBuilder().setLabel("⭐ Premium").setValue("premium").setDescription(hasPremium || hasGod ? "Premium tier account" : "Requires Premium role"),
            new StringSelectMenuOptionBuilder().setLabel("🌟 God").setValue("god").setDescription(hasGod ? "God tier account" : "Requires God role"),
            new StringSelectMenuOptionBuilder().setLabel("🎂 Age Group").setValue("agegroup").setDescription("Age group account"),
            new StringSelectMenuOptionBuilder().setLabel("💎 Rare").setValue("rare").setDescription("Rare username account"),
            new StringSelectMenuOptionBuilder().setLabel("🗑️ Dump").setValue("dump").setDescription("Dump tier account"),
          );
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xe8192c).setTitle("🎮 Generate — Select Tier").setDescription("Pick which tier you want to generate from:")],
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
          ephemeral: true,
        });

      } else if (id === "panel_stock") {
        const free     = fakeAmount("free")     ?? stockCount();
        const premium  = fakeAmount("premium")  ?? premiumStockCount();
        const god      = fakeAmount("god")      ?? godStockCount();
        const ageGroup = fakeAmount("agegroup") ?? ageGroupStockCount();
        const rare     = fakeAmount("rare")     ?? rareStockCount();
        const dump     = fakeAmount("dump")     ?? dumpStockCount();
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("📊 Live Stock Counts")
              .addFields(
                { name: "🟢 Free",      value: `\`${free}\``,     inline: true },
                { name: "⭐ Premium",   value: `\`${premium}\``,  inline: true },
                { name: "🌟 God",       value: `\`${god}\``,      inline: true },
                { name: "🎂 Age Group", value: `\`${ageGroup}\``, inline: true },
                { name: "💎 Rare",      value: `\`${rare}\``,     inline: true },
                { name: "🗑️ Dump",      value: `\`${dump}\``,     inline: true },
                { name: "📦 Total",     value: `\`${free + premium + god + ageGroup + rare + dump}\``, inline: false },
              )
              .setTimestamp(),
          ],
          ephemeral: true,
        });

      } else if (id === "panel_leaderboard") {
        const entries = [...leaderboard.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
        if (entries.length === 0) {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle("🏆 Leaderboard").setDescription("No generates recorded yet — be the first!")], ephemeral: true });
          return;
        }
        const desc = entries.map(([, { tag, count }], i) => `**${i + 1}.** ${tag} — \`${count}\` generate(s)`).join("\n");
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xffd700)
              .setTitle("🏆 Generate Leaderboard — Top 10")
              .setDescription(desc)
              .setFooter({ text: "Resets when bot restarts" })
              .setTimestamp(),
          ],
          ephemeral: true,
        });

      } else if (id === "panel_restock") {
        if (restockSubscribers.has(userId)) {
          restockSubscribers.delete(userId);
          savePanelData();
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("🔕 **Restock Alerts OFF** — You won't be DM'd when stock is added.")], ephemeral: true });
        } else {
          restockSubscribers.add(userId);
          savePanelData();
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("🔔 **Restock Alerts ON** — You'll get a DM whenever stock is added!")], ephemeral: true });
        }

      } else if (id === "panel_cdnotify") {
        if (cdNotifyUsers.has(userId)) {
          cdNotifyUsers.delete(userId);
          savePanelData();
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("🔕 **CD Notifications OFF** — You won't be DM'd when your cooldown expires.")], ephemeral: true });
        } else {
          cdNotifyUsers.add(userId);
          savePanelData();
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("⏰ **CD Notifications ON** — You'll get a DM when your generate cooldown is ready!")], ephemeral: true });
        }

      } else if (id === "panel_help") {
        await interaction.reply({ embeds: [buildHelpTabEmbed("generate")], ephemeral: true });
      }

    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "help_tab") {
        const tab = interaction.values[0];
        const embed = buildHelpTabEmbed(tab);
        await interaction.update({ embeds: [embed] });

      } else if (interaction.customId === "panel_tier_select") {
        const tier    = interaction.values[0] as StockTier;
        const userId  = interaction.user.id;
        const member  = await interaction.guild?.members.fetch(userId).catch(() => null);
        const hasGod     = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
        const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;

        if (tier === "god" && !hasGod) {
          await interaction.update({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You need the **God** role to generate from God tier.")], components: [] });
          return;
        }
        if (tier === "premium" && !hasPremium && !hasGod) {
          await interaction.update({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You need the **Premium** role to generate from Premium tier.")], components: [] });
          return;
        }
        if (blacklistedUsers.has(userId)) {
          await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("🚫 You're Blacklisted").setDescription("You have been blacklisted and cannot use any generate commands.")],
            components: [],
          });
          return;
        }
        if (lockedStocks.has(tier)) {
          await interaction.update({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription(`${tier} stock is currently locked.`)], components: [] });
          return;
        }

        if (!whitelistedUsers.has(userId)) {
          const lastCd = tier === "agegroup" ? ageGroupCooldowns.get(userId) : generateCooldowns.get(userId);
          if (lastCd) {
            const cdMs = tier === "agegroup" ? AGE_GROUP_COOLDOWN_MS : GENERATE_COOLDOWN_MS;
            const remaining = cdMs - (Date.now() - lastCd);
            if (remaining > 0) {
              const skipsUsed = getSkipsUsed(userId);
              const skipLimit = getSkipLimit(hasGod, hasPremium);
              const skipsLeft = Math.max(0, skipLimit - skipsUsed);
              await interaction.update({
                embeds: [buildCooldownWithSkipEmbed(remaining, skipsUsed, skipLimit)],
                components: [buildSkipRow(skipsLeft, `panel:${tier}`)],
              });
              return;
            }
          }
        }

        const stockFn =
          tier === "god"      ? popGodAccount
          : tier === "premium"  ? popPremiumAccount
          : tier === "agegroup" ? popAgeGroupAccount
          : tier === "rare"     ? popRareAccount
          : tier === "dump"     ? popDumpAccount
          : popAccount;
        const account = stockFn();
        if (!account) {
          await interaction.update({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("❌ Out of Stock").setDescription(`No **${tier}** accounts in stock right now.`)], components: [] });
          return;
        }

        await interaction.update({ embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("✅ Captcha sent in the channel! Complete it to receive your account.")], components: [] });
        const channel = interaction.channel as TextChannel;
        await sendCaptchaFromPanel(channel, interaction.user, account, tier, interaction);

      } else if (interaction.customId === "multistock_tier") {
        const userId = interaction.user.id;
        if (userId !== STOCK_ALLOWED_USER_ID) {
          await interaction.reply({ content: "❌ You don't have permission.", ephemeral: true });
          return;
        }

        const entries = pendingMultiStock.get(userId);
        if (!entries || entries.length === 0) {
          await interaction.reply({ content: "❌ No pending entries found — they may have expired. Run the command again.", ephemeral: true });
          return;
        }
        pendingMultiStock.delete(userId);

        const tier = interaction.values[0] as StockTier;
        const addFn =
          tier === "god"      ? addGodAccount
          : tier === "premium"  ? addPremiumAccount
          : tier === "agegroup" ? addAgeGroupAccount
          : tier === "rare"     ? addRareAccount
          : tier === "dump"     ? addDumpAccount
          : addAccount;
        const countFn =
          tier === "god"      ? godStockCount
          : tier === "premium"  ? premiumStockCount
          : tier === "agegroup" ? ageGroupStockCount
          : tier === "rare"     ? rareStockCount
          : tier === "dump"     ? dumpStockCount
          : stockCount;

        let added = 0, noCookie = 0;
        const invalidEntries: string[] = [];

        for (const entry of entries) {
          const parts = entry.split(":");
          if (parts.length < 2 || !parts[0] || !parts[1]) { invalidEntries.push(entry); continue; }
          const cookie = parts.slice(2).join(":");
          if (!cookie) noCookie++;
          addFn({ username: parts[0], password: parts[1], cookie });
          added++;
        }

        const total = countFn();
        const tierLabel =
          tier === "god"      ? "🌟 God"
          : tier === "premium"  ? "⭐ Premium"
          : tier === "agegroup" ? "🎂 Age Group"
          : tier === "rare"     ? "💎 Rare Usernames"
          : tier === "dump"     ? "🗑️ Dump"
          : "🟢 Free";

        const lines: string[] = [];
        if (added > 0)             lines.push(`✅ **${added}** account(s) added to **${tierLabel}** stock.`);
        if (noCookie > 0)          lines.push(`⚠️ **${noCookie}** added without a .ROBLOSECURITY cookie.`);
        if (invalidEntries.length) lines.push(`❌ **${invalidEntries.length}** skipped (bad format).`);

        const embed = new EmbedBuilder()
          .setColor(added > 0 ? 0x00c851 : 0xff9900)
          .setTitle("📥 Multi-Stock Import")
          .setDescription(lines.join("\n") || "Nothing was added.")
          .addFields({ name: `${tierLabel} Stock Total`, value: `\`${total} account(s)\``, inline: true })
          .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
        if (added > 0) {
          await notifyRestock(tier, added);
          logStockHistory(tier, added);
        }
      }

    } else if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      const userId = interaction.user.id;

      if (id === "modal_redeem_key") {
        const key = interaction.fields.getTextInputValue("key_input").trim();
        const result = redeemKey(userId, key);
        if (result === "success") {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("✅ Key Redeemed!")
                .setDescription(`Your API key has been activated.\n\nUse **Set Webhook** in the panel to configure where accounts are sent when you use \`j!generatealt\`.`),
            ],
            ephemeral: true,
          });
        } else if (result === "already_has_key") {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setDescription("❌ You already have an active API key. Use **Reset HWID** to remove it first."),
            ],
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setDescription("❌ Invalid key. Double-check and try again."),
            ],
            ephemeral: true,
          });
        }

      } else if (id === "modal_set_webhook") {
        const url = interaction.fields.getTextInputValue("webhook_input").trim();
        if (!url.startsWith("https://discord.com/api/webhooks/") && !url.startsWith("https://discordapp.com/api/webhooks/")) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setDescription("❌ That doesn't look like a valid Discord webhook URL. It should start with `https://discord.com/api/webhooks/`."),
            ],
            ephemeral: true,
          });
          return;
        }
        const result = setWebhook(userId, url);
        if (result === "success") {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("✅ Webhook Set!")
                .setDescription(`Your webhook has been saved.\n\nUse \`j!generatealt\` and accounts will be delivered to your webhook channel.`),
            ],
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setDescription("❌ You need to redeem an API key first."),
            ],
            ephemeral: true,
          });
        }
      }
    }
  });

  async function postStockWebhook(
    robloxUsername: string,
    tier: "free" | "premium" | "god" | "agegroup" | "rare" | "dump",
    robloxAvatarUrl: string | null,
    discordUser: { username: string; displayAvatarURL(opts?: object): string }
  ) {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return;

    const tierLabel =
      tier === "god"      ? "🌟 God"
      : tier === "premium"  ? "⭐ Premium"
      : tier === "agegroup" ? "🎂 Age Group"
      : tier === "rare"     ? "💎 Rare Username"
      : tier === "dump"     ? "🗑️ Dump"
      : "🟢 Free";

    const free     = fakeAmount("free")     ?? stockCount();
    const premium  = fakeAmount("premium")  ?? premiumStockCount();
    const god      = fakeAmount("god")      ?? godStockCount();
    const ageGroup = fakeAmount("agegroup") ?? ageGroupStockCount();
    const rare     = fakeAmount("rare")     ?? rareStockCount();
    const dump     = fakeAmount("dump")     ?? dumpStockCount();

    const stockBar = (n: number) => {
      const filled = Math.min(n, 10);
      return "█".repeat(filled) + "░".repeat(Math.max(0, 10 - filled)) + ` \`${n}\``;
    };

    const embed: Record<string, unknown> = {
      title: "📤 Account Generated",
      color: tier === "god" ? 0x9b59b6 : tier === "premium" ? 0xf5a623 : tier === "agegroup" ? 0x00bcd4 : tier === "rare" ? 0xffd700 : tier === "dump" ? 0xe74c3c : 0x00c851,
      author: {
        name: `Generated by ${discordUser.username}`,
        icon_url: discordUser.displayAvatarURL({ size: 64 }),
      },
      fields: [
        { name: "👤 Roblox Username", value: `\`${robloxUsername}\``, inline: true },
        { name: "📦 Tier",            value: tierLabel,               inline: true },
        { name: "\u200b",             value: "\u200b",                inline: false },
        { name: "🟢 Free",           value: stockBar(free),     inline: true },
        { name: "⭐ Premium",        value: stockBar(premium),  inline: true },
        { name: "🌟 God",            value: stockBar(god),      inline: true },
        { name: "🎂 Age Group",      value: stockBar(ageGroup), inline: true },
        { name: "💎 Rare Usernames", value: stockBar(rare),     inline: true },
        { name: "🗑️ Dump",           value: stockBar(dump),     inline: true },
      ],
      footer: { text: `Total remaining: ${free + premium + god + ageGroup + rare + dump} account(s)` },
      timestamp: new Date().toISOString(),
    };

    if (robloxAvatarUrl) embed.thumbnail = { url: robloxAvatarUrl };

    await axios.post(url, { embeds: [embed] }).catch(() => null);
  }

  function dmOffEmbed() {
    return new EmbedBuilder()
      .setTitle("📵 DMs Are Off")
      .setColor(0xff9900)
      .setDescription(
        "Your DMs are disabled so I can't send you the account privately.\n\n" +
        "Would you like to receive it here instead? **Only you will see it.**"
      )
      .setTimestamp();
  }

  function dmOffRow() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("dm_yes")
        .setLabel("✅ Yes, show it here")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("dm_no")
        .setLabel("❌ No, cancel")
        .setStyle(ButtonStyle.Danger),
    );
  }

  function bulkDmOffEmbed(count: number) {
    return new EmbedBuilder()
      .setTitle("📵 DMs Are Off")
      .setColor(0xff9900)
      .setDescription(
        `Your DMs are disabled so I can't send the **${count}** account(s) privately.\n\n` +
        "Would you like to receive them here instead? **Only you will see them.**"
      )
      .setTimestamp();
  }

  function bulkDmOffRow() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("bulk_dm_yes")
        .setLabel("✅ Yes, show them here")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("bulk_dm_no")
        .setLabel("❌ No, cancel")
        .setStyle(ButtonStyle.Danger),
    );
  }

  function returnPendingToStock(pending: PendingAccount) {
    if (pending.tier === "god") addGodAccount(pending.account);
    else if (pending.tier === "premium") addPremiumAccount(pending.account);
    else if (pending.tier === "agegroup") addAgeGroupAccount(pending.account);
    else if (pending.tier === "rare") addRareAccount(pending.account);
    else addAccount(pending.account);
  }

  // ── Captcha ───────────────────────────────────────────────────────────────────

  const CAPTCHA_COLORS = [
    { id: "captcha_red",    emoji: "🔴", label: "Red",    style: ButtonStyle.Danger    },
    { id: "captcha_green",  emoji: "🟢", label: "Green",  style: ButtonStyle.Success   },
    { id: "captcha_blue",   emoji: "🔵", label: "Blue",   style: ButtonStyle.Primary   },
    { id: "captcha_yellow", emoji: "🟡", label: "Yellow", style: ButtonStyle.Secondary },
  ] as const;

  function captchaRow() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      CAPTCHA_COLORS.map((c) =>
        new ButtonBuilder().setCustomId(c.id).setLabel(`${c.emoji} ${c.label}`).setStyle(c.style)
      )
    );
  }

  async function sendCaptcha(
    message: Message,
    account: Account,
    tier: "free" | "premium" | "god" | "agegroup" | "rare" | "dump"
  ) {
    const correct = CAPTCHA_COLORS[Math.floor(Math.random() * CAPTCHA_COLORS.length)];

    const captchaMsg = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🛡️ Human Verification")
          .setDescription(
            `To receive your account, click the **${correct.emoji} ${correct.label}** button below.\n\n⏰ You have **30 seconds** to respond.`
          )
          .setFooter({ text: "Wrong answer or timeout returns the account to stock." }),
      ],
      components: [captchaRow()],
    });

    const timeoutHandle = setTimeout(async () => {
      if (pendingCaptchas.has(message.author.id)) {
        pendingCaptchas.delete(message.author.id);
        if (tier === "god") addGodAccount(account);
        else if (tier === "premium") addPremiumAccount(account);
        else if (tier === "agegroup") addAgeGroupAccount(account);
        else if (tier === "rare") addRareAccount(account);
        else addAccount(account);
        await captchaMsg
          .edit({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle("⏰ Verification Timed Out")
                .setDescription("You didn't respond in time. The account was returned to stock."),
            ],
            components: [],
          })
          .catch(() => null);
        setTimeout(() => captchaMsg.delete().catch(() => null), 5_000);
      }
    }, 30_000);

    pendingCaptchas.set(message.author.id, {
      account,
      tier,
      correctColor: correct.id,
      originalMessage: message,
      timeoutHandle,
    });
  }

  // ── Shared account delivery ───────────────────────────────────────────────────

  async function deliverAccount(
    account: Account,
    tier: "free" | "premium" | "god" | "agegroup" | "rare" | "dump",
    message: Message
  ) {
    const profile = await getRobloxProfile(account.username);
    const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
    const createdStr = profile?.createdAt
      ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "N/A";
    const ageDaysStr = profile?.ageDays != null ? `${profile.ageDays.toLocaleString()} days` : "N/A";
    const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

    const tierLabel =
      tier === "god"      ? "🌟 Your God-Tier Roblox Account"
      : tier === "premium"  ? "⭐ Your Premium Roblox Account"
      : tier === "agegroup" ? "🎂 Your Age Group Roblox Account"
      : tier === "rare"     ? "💎 Your Rare Username Roblox Account"
      : tier === "dump"     ? "🗑️ Your Dump Roblox Account"
      : "<:emoji:1508575300999581746> Your Roblox Account";

    const color =
      tier === "god"      ? 0x9b59b6
      : tier === "premium"  ? 0xf5a623
      : tier === "agegroup" ? 0x00bcd4
      : tier === "rare"     ? 0xffd700
      : tier === "dump"     ? 0xe74c3c
      : 0x00c851;

    const footer =
      tier === "god"      ? "🌟 God-Tier Account — Login at roblox.com"
      : tier === "premium"  ? "⭐ Premium Account — Login at roblox.com"
      : tier === "agegroup" ? "🎂 Age Group Account — Login at roblox.com"
      : tier === "rare"     ? "💎 Rare Username Account — Login at roblox.com"
      : tier === "dump"     ? "🗑️ Dump Account — Login at roblox.com"
      : "🟢 Login at roblox.com — keep these credentials safe!";

    const successEmoji =
      tier === "god"      ? "🌟"
      : tier === "premium"  ? "⭐"
      : tier === "agegroup" ? "🎂"
      : tier === "rare"     ? "💎"
      : tier === "dump"     ? "🗑️"
      : "<:emoji:1508575300999581746>";

    const dmEmbed = new EmbedBuilder()
      .setTitle(tierLabel)
      .setColor(color)
      .addFields(
        { name: "👤 Username",      value: `\`${account.username}\``,                          inline: true },
        { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``,  inline: true },
        { name: "🆔 User ID",       value: `\`${profile?.userId ?? "N/A"}\``,                  inline: true },
        { name: "🔑 Password",      value: `\`${account.password}\``,                          inline: true },
        { name: "📅 Created",       value: `\`${createdStr}\``,                                inline: true },
        { name: "⏳ Account Age",   value: `\`${ageDaysStr}\``,                                inline: true },
        { name: "👫 Friends",       value: `\`${fmt(profile?.friends ?? null)}\``,             inline: true },
        { name: "👥 Followers",     value: `\`${fmt(profile?.followers ?? null)}\``,           inline: true },
        { name: "➡️ Following",     value: `\`${fmt(profile?.following ?? null)}\``,           inline: true },
      )
      .setFooter({ text: footer })
      .setTimestamp();

    if (profile?.avatarUrl) dmEmbed.setThumbnail(profile.avatarUrl);
    if (profileUrl) dmEmbed.setURL(profileUrl);

    const cooldownMs = tier === "agegroup" ? AGE_GROUP_COOLDOWN_MS : GENERATE_COOLDOWN_MS;
    if (tier === "agegroup") ageGroupCooldowns.set(message.author.id, Date.now());
    else generateCooldowns.set(message.author.id, Date.now());
    const cdEnd = Math.floor((Date.now() + cooldownMs) / 1000);

    // Track leaderboard
    const lbEntry = leaderboard.get(message.author.id) ?? { tag: message.author.username, count: 0 };
    lbEntry.count++;
    lbEntry.tag = message.author.username;
    leaderboard.set(message.author.id, lbEntry);
    savePanelData();

    // Schedule CD done notification
    if (cdNotifyUsers.has(message.author.id)) scheduleCdNotify(message.author.id, cooldownMs, message.author);

    // Determine CoolGEN tier badge for the channel reply
    let member = message.member;
    if (!member && message.guild) {
      member = await message.guild.members.fetch(message.author.id).catch(() => null);
    }
    const hasGod     = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
    const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
    const tierBadge  = hasGod ? "CoolGEN God" : hasPremium ? "CoolGEN Premium" : "CoolGEN";

    try {
      await message.author.send({ embeds: [dmEmbed] });
      const cookieLine = account.cookie
        ? `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``
        : `⛔ **NO .ROBLOXSECURITY FOR THIS STOCK**`;
      await message.author.send(
        `${cookieLine}\n\n**Combo** \`${account.username}:${account.password}\`\n\n⚠️ **Warning: Change the Password**`
      );

      const channelEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle("<:green:1508573751791321138> Roblox Account Generated")
        .setDescription(`Check your DMs for your account, ${message.author}!\n⏳ You can generate again <t:${cdEnd}:R>`)
        .setFooter({ text: tierBadge })
        .setTimestamp();
      if (profile?.avatarUrl) channelEmbed.setThumbnail(profile.avatarUrl);

      await message.reply({ embeds: [channelEmbed] });
      await postStockWebhook(account.username, tier, profile?.avatarUrl ?? null, message.author);
    } catch {
      pendingAccounts.set(message.author.id, { account, tier });
      await message.reply({ embeds: [dmOffEmbed()], components: [dmOffRow()] });
    }
  }

  function checkCooldown(userId: string): number | null {
    if (whitelistedUsers.has(userId)) return null;
    const last = generateCooldowns.get(userId);
    if (!last) return null;
    const remaining = GENERATE_COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? remaining : null;
  }

  async function handleFakeStock(
    message: Message,
    toggleArg: string | undefined,
    amountArg: string | undefined,
    tierArg: string | undefined,
  ) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }

    const toggle = toggleArg?.toLowerCase();
    if (toggle !== "on" && toggle !== "off") {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle("⚙️ Fakestock Usage")
            .setDescription(
              "**Turn on:** `j!fakestock on <amount> <tier>`\n" +
              "**Turn off:** `j!fakestock off <tier>`\n\n" +
              "**Tiers:** `free` · `premium` · `god` · `agegroup` · `rare` · `dump`\n\n" +
              "**Example:** `j!fakestock on 500 free`\n" +
              "When on, stock commands show the fake amount and anyone who tries to generate gets pranked."
            ),
        ],
      });
      return;
    }

    if (toggle === "off") {
      const tier = (tierArg?.toLowerCase() ?? amountArg?.toLowerCase()) as StockTier | undefined;
      const validTiers: StockTier[] = ["free", "premium", "god", "agegroup", "rare", "dump"];
      if (!tier || !validTiers.includes(tier)) {
        await message.reply({
          embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ Specify a tier: `free`, `premium`, `god`, `agegroup`, `rare`, `dump`")],
        });
        return;
      }
      fakeStockSettings.delete(tier);
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0x00c851).setDescription(`✅ Fakestock **OFF** for **${tier}** tier. Real stock is shown again.`)],
      });
      return;
    }

    // toggle === "on"
    const amount = parseInt(amountArg ?? "", 10);
    const tier = tierArg?.toLowerCase() as StockTier | undefined;
    const validTiers: StockTier[] = ["free", "premium", "god", "agegroup", "rare", "dump"];

    if (isNaN(amount) || amount < 0) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ Provide a valid amount (number ≥ 0).")],
      });
      return;
    }
    if (!tier || !validTiers.includes(tier)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ Specify a valid tier: `free`, `premium`, `god`, `agegroup`, `rare`, `dump`")],
      });
      return;
    }

    fakeStockSettings.set(tier, amount);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("🎭 Fakestock ON")
          .setDescription(`**${tier}** tier now shows **${amount}** accounts in stock.\nAnyone who tries to generate will be pranked in their DMs.`),
      ],
    });
  }

  async function handleGenerate(message: Message) {
    const fake = fakeAmount("free");
    if (fake !== null) {
      try {
        await message.author.send(`😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** free accounts in stock`);
      } catch {
        await message.reply({ content: `😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** free accounts in stock`, flags: [4096] });
      }
      return;
    }
    if (lockedStocks.has("free")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Free stock is currently locked. Please check back later.")],
      });
      return;
    }
    if (blacklistedUsers.has(message.author.id)) { await replyBlacklisted(message); return; }
    const remaining = checkCooldown(message.author.id);
    if (remaining !== null) {
      await replyCooldownMsg(message, remaining);
      return;
    }

    const account = popAccount();
    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Out of Stock")
            .setColor(0xff4444)
            .setDescription("There are no Roblox accounts in stock right now. Check back later!")
            .setTimestamp(),
        ],
      });
      return;
    }

    await sendCaptcha(message, account, "free");
  }

  async function handleAddStock(message: Message, tier: "free" | "premium" | "god") {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ You don't have permission to use this command."),
        ],
      });
      return;
    }

    sessions.set(message.author.id, { step: "username", tier });

    const label = tier === "god" ? "🌟 Add God Stock" : tier === "premium" ? "⭐ Add Premium Stock" : "➕ Add Stock";
    const color = tier === "god" ? 0x9b59b6 : tier === "premium" ? 0xf5a623 : 0xe8192c;

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle(label)
          .setDescription("**Roblox Username?**\n\nType the username of the account below."),
      ],
    });
  }

  async function handleSessionReply(message: Message) {
    const session = sessions.get(message.author.id)!;
    const input = message.content.trim();

    if (session.step === "username") {
      session.username = input;
      session.step = "password";
      sessions.set(message.author.id, session);

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe8192c)
            .setTitle("➕ Add Stock")
            .setDescription("**Password?**\n\nType the account password below."),
        ],
      });
    } else if (session.step === "password") {
      session.password = input;
      session.step = "cookie";
      sessions.set(message.author.id, session);

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe8192c)
            .setTitle("➕ Add Stock")
            .setDescription(
              "**Roblox Security Cookie?**\n\nPaste the `.ROBLOSECURITY` cookie value below."
            ),
        ],
      });
    } else if (session.step === "cookie") {
      const cookie = input;
      const { tier } = session;
      sessions.delete(message.author.id);

      const account = { username: session.username!, password: session.password!, cookie };
      if (tier === "god") {
        addGodAccount(account);
      } else if (tier === "premium") {
        addPremiumAccount(account);
      } else if (tier === "agegroup") {
        addAgeGroupAccount(account);
      } else if (tier === "rare") {
        addRareAccount(account);
      } else {
        addAccount(account);
      }
      await notifyRestock(tier as StockTier, 1);
      logStockHistory(tier ?? "free", 1);

      const count =
        tier === "god" ? godStockCount()
        : tier === "premium" ? premiumStockCount()
        : tier === "agegroup" ? ageGroupStockCount()
        : tier === "rare" ? rareStockCount()
        : stockCount();
      const label =
        tier === "god" ? "✅ Account Added to God Stock"
        : tier === "premium" ? "✅ Account Added to Premium Stock"
        : tier === "agegroup" ? "✅ Account Added to Age Group Stock"
        : tier === "rare" ? "✅ Account Added to Rare Usernames Stock"
        : "✅ Account Added to Stock";
      const color =
        tier === "god" ? 0x9b59b6
        : tier === "premium" ? 0xf5a623
        : tier === "agegroup" ? 0x00bcd4
        : tier === "rare" ? 0xffd700
        : 0x00c851;
      const stockLabel =
        tier === "god" ? "🌟 God Stock"
        : tier === "premium" ? "⭐ Premium Stock"
        : tier === "agegroup" ? "🎂 Age Group Stock"
        : tier === "rare" ? "💎 Rare Usernames Stock"
        : "📦 Total Stock";

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setTitle(label)
            .addFields(
              { name: "👤 Username", value: `\`${session.username}\``, inline: true },
              { name: "🔑 Password", value: `\`${session.password}\``, inline: true },
              { name: stockLabel, value: `\`${count} account(s)\``, inline: true },
            )
            .setTimestamp(),
        ],
      });
    }
  }

  async function handleStockCount(message: Message) {
    const count = fakeAmount("free") ?? stockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe8192c)
          .setDescription(`📦 **Stock:** \`${count}\` account(s) available`),
      ],
    });
  }

  async function handlePremiumStockCount(message: Message) {
    const count = fakeAmount("premium") ?? premiumStockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf5a623)
          .setDescription(`⭐ **Premium Stock:** \`${count}\` account(s) available`),
      ],
    });
  }

  async function handleGodStockCount(message: Message) {
    const count = fakeAmount("god") ?? godStockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9b59b6)
          .setDescription(`🌟 **God Stock:** \`${count}\` account(s) available`),
      ],
    });
  }

  async function handleAllStock(message: Message) {
    const free     = fakeAmount("free")     ?? stockCount();
    const premium  = fakeAmount("premium")  ?? premiumStockCount();
    const god      = fakeAmount("god")      ?? godStockCount();
    const ageGroup = fakeAmount("agegroup") ?? ageGroupStockCount();
    const rare     = fakeAmount("rare")     ?? rareStockCount();
    const dump     = fakeAmount("dump")     ?? dumpStockCount();
    const total = free + premium + god + ageGroup + rare + dump;
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📦 All Stock")
          .addFields(
            { name: "🟢 Free",            value: `\`${free}\` account(s)`,     inline: true },
            { name: "⭐ Premium",         value: `\`${premium}\` account(s)`,  inline: true },
            { name: "🌟 God",             value: `\`${god}\` account(s)`,      inline: true },
            { name: "🎂 Age Group",       value: `\`${ageGroup}\` account(s)`, inline: true },
            { name: "💎 Rare Usernames",  value: `\`${rare}\` account(s)`,     inline: true },
            { name: "🗑️ Dump",            value: `\`${dump}\` account(s)`,     inline: true },
          )
          .setFooter({ text: `Total: ${total} account(s)` })
          .setTimestamp(),
      ],
    });
  }

  async function handleLockStock(message: Message, tierArg: string, lock: boolean) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }

    const tierMap: Record<string, "free" | "premium" | "god" | "agegroup" | "rare" | "dump"> = {
      free: "free", premium: "premium", god: "god", agegroup: "agegroup", rare: "rare", dump: "dump",
    };
    const tier = tierMap[tierArg?.toLowerCase()];

    if (!tier) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ Invalid tier. Use: `free`, `premium`, `god`, `agegroup`, `rare`, or `dump`"),
        ],
      });
      return;
    }

    if (lock) lockedStocks.add(tier); else lockedStocks.delete(tier);

    const tierLabel = tier === "god" ? "🌟 God" : tier === "premium" ? "⭐ Premium" : tier === "agegroup" ? "🎂 Age Group" : tier === "rare" ? "💎 Rare" : tier === "dump" ? "🗑️ Dump Account" : "🟢 Free";
    const action = lock ? "🔒 Locked" : "🔓 Unlocked";
    const color  = lock ? 0xff4444 : 0x00c851;

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setDescription(`${action} **${tierLabel}** stock — users can${lock ? " no longer" : ""} generate from this tier.`),
      ],
    });
  }

  async function handleLockAllStocks(message: Message, lock: boolean) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }

    const allTiers = ["free", "premium", "god", "agegroup", "rare", "dump"] as const;
    if (lock) allTiers.forEach((t) => lockedStocks.add(t));
    else lockedStocks.clear();

    const action = lock ? "🔒 All stocks locked" : "🔓 All stocks unlocked";
    const color  = lock ? 0xff4444 : 0x00c851;
    const detail = lock
      ? "Users can no longer generate from any tier."
      : "Users can now generate from all tiers.";

    await message.reply({
      embeds: [new EmbedBuilder().setColor(color).setTitle(action).setDescription(detail)],
    });
  }

  async function handleAgeGroupStockCount(message: Message) {
    const count = fakeAmount("agegroup") ?? ageGroupStockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00bcd4)
          .setDescription(`🔵 **Age Group Stock:** \`${count}\` account(s) available`),
      ],
    });
  }

  async function handleAddAgeGroupStock(message: Message) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ You don't have permission to use this command."),
        ],
      });
      return;
    }
    sessions.set(message.author.id, { step: "username", tier: "agegroup" });
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00bcd4)
          .setTitle("🎂 Add Age Group Stock")
          .setDescription("**Roblox Username?**\n\nType the username of the account below."),
      ],
    });
  }

  async function handleGenerateAgeGroup(message: Message) {
    const fake = fakeAmount("agegroup");
    if (fake !== null) {
      try {
        await message.author.send(`😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** age group accounts in stock`);
      } catch {
        await message.reply({ content: `😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** age group accounts in stock`, flags: [4096] });
      }
      return;
    }
    if (blacklistedUsers.has(message.author.id)) { await replyBlacklisted(message); return; }
    if (lockedStocks.has("agegroup")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Age Group stock is currently locked. Please check back later.")],
      });
      return;
    }
    if (!whitelistedUsers.has(message.author.id)) {
      const last = ageGroupCooldowns.get(message.author.id);
      if (last) {
        const remaining = AGE_GROUP_COOLDOWN_MS - (Date.now() - last);
        if (remaining > 0) {
          await replyAgCooldownMsg(message, remaining);
          return;
        }
      }
    }

    const account = popAgeGroupAccount();
    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Age Group Stock Empty")
            .setColor(0xff4444)
            .setDescription("There are no Age Group accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    await sendCaptcha(message, account, "agegroup");
  }

  async function handleRareStockCount(message: Message) {
    const count = fakeAmount("rare") ?? rareStockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffd700)
          .setDescription(`💎 **Rare Usernames Stock:** \`${count}\` account(s) available`),
      ],
    });
  }

  async function handleDumpStockCount(message: Message) {
    const count = fakeAmount("dump") ?? dumpStockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription(`🗑️ **Dump Stock:** \`${count}\` account(s) available`),
      ],
    });
  }

  async function handleAddRareStock(message: Message) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }
    sessions.set(message.author.id, { step: "username", tier: "rare" });
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle("💎 Add Rare Username Stock")
          .setDescription("**Roblox Username?**\n\nType the username of the account below."),
      ],
    });
  }

  async function handleGenerateRare(message: Message) {
    const fake = fakeAmount("rare");
    if (fake !== null) {
      try {
        await message.author.send(`😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** rare username accounts in stock`);
      } catch {
        await message.reply({ content: `😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** rare username accounts in stock`, flags: [4096] });
      }
      return;
    }
    if (blacklistedUsers.has(message.author.id)) { await replyBlacklisted(message); return; }
    if (lockedStocks.has("rare")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Rare Usernames stock is currently locked. Please check back later.")],
      });
      return;
    }

    const joinedAt = message.member?.joinedAt;
    const daysSinceJoin = joinedAt ? (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24) : 0;
    if (daysSinceJoin < 5) {
      const daysLeft = Math.ceil(5 - daysSinceJoin);
      const unlockTimestamp = Math.floor((joinedAt!.getTime() + 5 * 24 * 60 * 60 * 1000) / 1000);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Server Membership Required")
            .setDescription(
              `You must be a member of this server for **at least 5 days** to generate a Rare Username account.\n\n` +
              `You joined <t:${Math.floor(joinedAt!.getTime() / 1000)}:R> and will be eligible <t:${unlockTimestamp}:R> (**${daysLeft} day${daysLeft !== 1 ? "s" : ""} left**).`
            ),
        ],
      });
      return;
    }

    const remaining = checkCooldown(message.author.id);
    if (remaining !== null) {
      await replyCooldownMsg(message, remaining);
      return;
    }

    const account = popRareAccount();
    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Rare Usernames Stock Empty")
            .setColor(0xff4444)
            .setDescription("There are no Rare Username accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    await sendCaptcha(message, account, "rare");
  }

  async function handleGenerateGod(message: Message) {
    const fake = fakeAmount("god");
    if (fake !== null) {
      try {
        await message.author.send(`😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** god accounts in stock`);
      } catch {
        await message.reply({ content: `😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** god accounts in stock`, flags: [4096] });
      }
      return;
    }
    if (blacklistedUsers.has(message.author.id)) { await replyBlacklisted(message); return; }
    if (lockedStocks.has("god")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("God stock is currently locked. Please check back later.")],
      });
      return;
    }
    const remaining = checkCooldown(message.author.id);
    if (remaining !== null) {
      await replyCooldownMsg(message, remaining);
      return;
    }

    const member = await message.guild!.members.fetch(message.author.id).catch(() => null);
    if (!(member?.roles.cache.has(GOD_ROLE_ID) ?? false)) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🌟 God Tier Required")
            .setColor(0x9b59b6)
            .setDescription("You need the **God** role to use this command.\n\nUpgrade to God tier to access God-tier Roblox accounts!"),
        ],
      });
      return;
    }

    const account = popGodAccount();
    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ God Stock Empty")
            .setColor(0xff4444)
            .setDescription("There are no God-tier accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    await sendCaptcha(message, account, "god");
  }

  async function handleGeneratePremium(message: Message) {
    const fake = fakeAmount("premium");
    if (fake !== null) {
      try {
        await message.author.send(`😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** premium accounts in stock`);
      } catch {
        await message.reply({ content: `😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** premium accounts in stock`, flags: [4096] });
      }
      return;
    }
    if (blacklistedUsers.has(message.author.id)) { await replyBlacklisted(message); return; }
    if (lockedStocks.has("premium")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Premium stock is currently locked. Please check back later.")],
      });
      return;
    }
    const remaining = checkCooldown(message.author.id);
    if (remaining !== null) {
      await replyCooldownMsg(message, remaining);
      return;
    }

    const member = await message.guild!.members.fetch(message.author.id).catch(() => null);
    if (!(member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false)) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⭐ Premium Required")
            .setColor(0xf5a623)
            .setDescription("You need the **Premium** role to use this command.\n\nUpgrade to Premium to access premium Roblox accounts!"),
        ],
      });
      return;
    }

    const account = popPremiumAccount();
    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Premium Stock Empty")
            .setColor(0xff4444)
            .setDescription("There are no premium accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    await sendCaptcha(message, account, "premium");
  }

  async function handleShowApiPanel(message: Message) {
    const data = getApiData(message.author.id);
    const hasKey = !!data;
    const hasWebhook = !!data?.webhook;

    const statusLines = [
      `🔑 **API Key:** ${hasKey ? "✅ Active" : "❌ None"}`,
      `🔗 **Webhook:** ${hasWebhook ? "✅ Set" : "❌ Not set"}`,
    ];

    const embed = new EmbedBuilder()
      .setTitle("🛠️ API Panel")
      .setColor(0xe8192c)
      .setDescription(
        statusLines.join("\n") +
        "\n\n• **Redeem Key** — activate an API key\n" +
        "• **Reset HWID** — delete your key & data\n" +
        "• **Set Webhook** — set where `j!generatealt` delivers accounts"
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("api_redeem")
        .setLabel("🔑 Redeem Key")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("api_reset_hwid")
        .setLabel("🔄 Reset HWID")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("api_set_webhook")
        .setLabel("🔗 Set Webhook")
        .setStyle(ButtonStyle.Primary),
    );

    await message.reply({ embeds: [embed], components: [row] });
  }

  async function handleAddApiKeys(message: Message, keys: string[]) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ You don't have permission to use this command."),
        ],
      });
      return;
    }

    if (keys.length === 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ Provide at least one key. Usage: `j!addapikeys KEY1 KEY2 ...`"),
        ],
      });
      return;
    }

    const added = addApiKeys(keys);
    const total = apiKeyPoolCount();

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c851)
          .setTitle("✅ API Keys Added")
          .addFields(
            { name: "➕ Added", value: `\`${added}\``, inline: true },
            { name: "📦 Total in Pool", value: `\`${total}\``, inline: true },
          )
          .setTimestamp(),
      ],
    });
  }

  async function handleGenerateAlt(message: Message) {
    const remaining = checkCooldown(message.author.id);
    if (remaining !== null) {
      await replyCooldownMsg(message, remaining);
      return;
    }

    const data = getApiData(message.author.id);

    if (!data) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ No API Key")
            .setDescription("You need an API key to use this command. Use `j!showapipanel` to redeem one."),
        ],
      });
      return;
    }

    if (!data.webhook) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ No Webhook Set")
            .setDescription("You have a key but no webhook configured. Use `j!showapipanel` → **Set Webhook**."),
        ],
      });
      return;
    }

    const account = popAccount();

    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Out of Stock")
            .setColor(0xff4444)
            .setDescription("There are no Roblox accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    try {
      const profile = await getRobloxProfile(account.username);

      const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
      const createdStr = profile?.createdAt
        ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "N/A";
      const ageDaysStr = profile?.ageDays !== null && profile?.ageDays !== undefined
        ? `${profile.ageDays.toLocaleString()} days`
        : "N/A";
      const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

      const webhookEmbed: Record<string, unknown> = {
        title: "🎮 Roblox Account (via API)",
        color: 0xe8192c,
        fields: [
          { name: "👤 Username", value: `\`${account.username}\``, inline: true },
          { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``, inline: true },
          { name: "🆔 User ID", value: `\`${profile?.userId ?? "N/A"}\``, inline: true },
          { name: "🔑 Password", value: `\`${account.password}\``, inline: true },
          { name: "📅 Created", value: `\`${createdStr}\``, inline: true },
          { name: "⏳ Account Age", value: `\`${ageDaysStr}\``, inline: true },
          { name: "👫 Friends", value: `\`${fmt(profile?.friends ?? null)}\``, inline: true },
          { name: "👥 Followers", value: `\`${fmt(profile?.followers ?? null)}\``, inline: true },
          { name: "➡️ Following", value: `\`${fmt(profile?.following ?? null)}\``, inline: true },
          { name: "🍪 Security Cookie (.ROBLOSECURITY)", value: `\`\`\`${account.cookie}\`\`\`` },
        ],
        footer: { text: `Requested by ${message.author.tag} via j!generatealt` },
        timestamp: new Date().toISOString(),
        ...(profileUrl ? { url: profileUrl } : {}),
        ...(profile?.avatarUrl ? { thumbnail: { url: profile.avatarUrl } } : {}),
      };

      await axios.post(data.webhook, { embeds: [webhookEmbed] });
      generateCooldowns.set(message.author.id, Date.now());

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setDescription(`✅ Account delivered to your webhook channel, ${message.author}!`)
            .setTimestamp(),
        ],
      });
    } catch {
      addAccount(account);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Webhook Delivery Failed")
            .setColor(0xff4444)
            .setDescription(
              "Couldn't send to your webhook. Make sure the URL is still valid.\n\n**Account was not wasted** — try again."
            ),
        ],
      });
    }
  }

  async function handleUser(message: Message, username: string | undefined) {
    if (!username) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ Please provide a username. Usage: `j!user <username>`"),
        ],
      });
      return;
    }

    const loading = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe8192c)
          .setDescription(`🔍 Looking up **${username}**...`),
      ],
    });

    const profile = await getRobloxProfile(username);

    if (!profile) {
      await loading.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ User Not Found")
            .setDescription(`Could not find a Roblox account with the username \`${username}\`.`),
        ],
      });
      return;
    }

    const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
    const createdStr = profile.createdAt
      ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "N/A";
    const ageDaysStr = profile.ageDays !== null
      ? `${profile.ageDays.toLocaleString()} days`
      : "N/A";
    const profileUrl = `https://www.roblox.com/users/${profile.userId}/profile`;

    const robloxPlusBadge = profile.hasRobloxPlus
    ? " <:RblxPlusLogo:1508632956124794981>"
    : "";

    const titlePrefix = profile.hasVerifiedBadge
      ? "<:verified:1508628397884969100>"
      : "👤";

    // ✅ Now build the embed normally
    const embed = new EmbedBuilder()
                .setTitle(
                  `${titlePrefix} ${profile.displayName}${robloxPlusBadge} (@${username}${robloxPlusBadge})`
                )
      .setURL(profileUrl)
      .setColor(0xe8192c)
      .addFields(
        { name: "🆔 User ID", value: `\`${profile.userId}\``, inline: true },
        { name: "🏷️ Display Name", value: `\`${profile.displayName}\``, inline: true },
        { name: "📅 Created", value: `\`${createdStr}\``, inline: true },
        { name: "⏳ Account Age", value: `\`${ageDaysStr}\``, inline: true },
        { name: "👫 Friends", value: `\`${fmt(profile.friends)}\``, inline: true },
        { name: "👥 Followers", value: `\`${fmt(profile.followers)}\``, inline: true },
        { name: "➡️ Following", value: `\`${fmt(profile.following)}\``, inline: true },
        { name: "🔨 Banned", value: `\`${profile.isBanned ? "Yes" : "No"}\``, inline: true },
      )
      .setFooter({ text: "Roblox User Lookup" })
      .setTimestamp();

    if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);


    if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);

    await loading.edit({ embeds: [embed] });
  }

  async function handleAccountDays(message: Message, username: string | undefined) {
    if (!username) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription("❌ Please provide a username. Usage: `j!accountdays <username>`"),
        ],
      });
      return;
    }

    const loading = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe8192c)
          .setDescription(`🔍 Checking age of **${username}**...`),
      ],
    });

    const profile = await getRobloxProfile(username);

    if (!profile) {
      await loading.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ User Not Found")
            .setDescription(`Could not find a Roblox account with the username \`${username}\`.`),
        ],
      });
      return;
    }

    const createdStr = profile.createdAt
      ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "N/A";
    const ageDaysStr = profile.ageDays !== null
      ? `${profile.ageDays.toLocaleString()} days`
      : "N/A";
    const years = profile.ageDays !== null ? (profile.ageDays / 365).toFixed(1) : null;

    const embed = new EmbedBuilder()
      .setTitle(`⏳ Account Age — ${username}`)
      .setColor(0xe8192c)
      .addFields(
        { name: "📅 Created On", value: `\`${createdStr}\``, inline: true },
        { name: "⏳ Days Old", value: `\`${ageDaysStr}\``, inline: true },
        { name: "📆 Years Old", value: `\`${years !== null ? `${years} years` : "N/A"}\``, inline: true },
      )
      .setTimestamp();

    if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);

    await loading.edit({ embeds: [embed] });
  }

  async function handleBulkGen(message: Message) {
    if (lockedStocks.has("free")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Free stock is currently locked. Please check back later.")],
      });
      return;
    }

    const last = bulkGenCooldowns.get(message.author.id);
    if (last) {
      const remaining = BULK_GEN_COOLDOWN_MS - (Date.now() - last);
      if (remaining > 0) {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.ceil((remaining % 60000) / 1000);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle("⏳ Cooldown Active")
              .setDescription(`You must wait **${mins}m ${secs}s** before using \`j!bulkgen\` again.`),
          ],
        });
        return;
      }
    }

    const member = await message.guild!.members.fetch(message.author.id).catch(() => null);
    const hasGod     = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
    const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;

    const limit    = hasGod ? 10 : hasPremium ? 6 : 4;
    const tierLabel = hasGod ? "🌟 God" : hasPremium ? "⭐ Premium" : "🟢 Free";
    const color     = hasGod ? 0x9b59b6 : hasPremium ? 0xf5a623 : 0x00c851;

    // Free-tier users must have the required status and be online
    if (!hasGod && !hasPremium) {
      const presence = member?.presence;
      const isOnline = presence?.status === "online";
      const customStatus = presence?.activities.find(a => a.type === 4)?.state ?? "";
      const hasStatus = customStatus.includes(REQUIRED_STATUS);

      if (!isOnline || !hasStatus) {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle("❌ Status Requirement Not Met ")
              .setDescription(
                "To use `j!bulkgen` on the **Free** tier you must:\n\n" +
                `**1.** Set your Discord custom status to:\n\`\`\`${REQUIRED_STATUS}\`\`\`` +
                "**2.** Be **Online** (not idle, DND, or offline)\n\n" +
                "⭐ Upgrade to **Premium** or **God** to skip this requirement."
              ),
          ],
        });
        return;
      }
    }

    const available = stockCount();
    if (available === 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Out of Stock")
            .setColor(0xff4444)
            .setDescription("There are no free accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    const toSend = Math.min(limit, available);
    const accounts: Account[] = [];
    for (let i = 0; i < toSend; i++) {
      const acc = popAccount();
      if (acc) accounts.push(acc);
    }

    bulkGenCooldowns.set(message.author.id, Date.now());
    const cdEnd = Math.floor((Date.now() + BULK_GEN_COOLDOWN_MS) / 1000);
    // Track that this free-tier user bulkgen'd using the status requirement
    if (!hasGod && !hasPremium) bulkGenStatusUsers.add(message.author.id);

    const tierBadge = hasGod ? "CoolGEN God" : hasPremium ? "CoolGEN Premium" : "CoolGEN";

    try {
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const profile = await getRobloxProfile(account.username);
        const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
        const createdStr = profile?.createdAt
          ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
          : "N/A";
        const ageDaysStr = profile?.ageDays != null ? `${profile.ageDays.toLocaleString()} days` : "N/A";
        const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

        const dmEmbed = new EmbedBuilder()
          .setTitle(`<:emoji:1508575300999581746> Bulk Account ${i + 1} of ${accounts.length}`)
          .setColor(color)
          .addFields(
            { name: "👤 Username",     value: `\`${account.username}\``,                         inline: true },
            { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``, inline: true },
            { name: "🆔 User ID",      value: `\`${profile?.userId ?? "N/A"}\``,                 inline: true },
            { name: "🔑 Password",     value: `\`${account.password}\``,                         inline: true },
            { name: "📅 Created",      value: `\`${createdStr}\``,                               inline: true },
            { name: "⏳ Account Age",  value: `\`${ageDaysStr}\``,                               inline: true },
            { name: "👫 Friends",      value: `\`${fmt(profile?.friends ?? null)}\``,            inline: true },
            { name: "👥 Followers",    value: `\`${fmt(profile?.followers ?? null)}\``,          inline: true },
            { name: "➡️ Following",    value: `\`${fmt(profile?.following ?? null)}\``,          inline: true },
          )
          .setFooter({ text: "CoolGEN Bulk Gen — Login at roblox.com" })
          .setTimestamp();

        if (profile?.avatarUrl) dmEmbed.setThumbnail(profile.avatarUrl);
        if (profileUrl) dmEmbed.setURL(profileUrl);

        await message.author.send({ embeds: [dmEmbed] });

        const cookieLine = account.cookie
          ? `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``
          : `⛔ **NO .ROBLOXSECURITY FOR THIS STOCK**`;
        await message.author.send(`${cookieLine}\n\n**Combo** \`${account.username}:${account.password}\`\n\n⚠️ **Warning: Change the Password**`);
      }

      const channelEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle("<:green:1508573751791321138> Bulk Generate Complete")
        .setDescription(
          `${message.author} — **${accounts.length}** account(s) sent to your DMs!\n` +
          `${tierLabel} tier · ⏳ You can bulk gen again <t:${cdEnd}:R>`
        )
        .setFooter({ text: tierBadge })
        .setTimestamp();

      await message.reply({ embeds: [channelEmbed] });
    } catch {
      // DMs closed — hold accounts and offer to show here
      pendingBulkAccounts.set(message.author.id, { accounts, color, tierBadge, cdEnd });
      await message.reply({ embeds: [bulkDmOffEmbed(accounts.length)], components: [bulkDmOffRow()] });
    }
  }

  async function handleBulkGenDump(message: Message) {
    if (lockedStocks.has("dump")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Dump stock is currently locked. Please check back later.")],
      });
      return;
    }

    const last = bulkGenDumpCooldowns.get(message.author.id);
    if (last) {
      const remaining = BULK_GEN_DUMP_COOLDOWN_MS - (Date.now() - last);
      if (remaining > 0) {
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle("⏳ Cooldown Active")
              .setDescription(`You must wait before using \`j!bulkgendump\` again.`),
          ],
        });
        return;
      }
    }

    // Require custom status to use j!bulkgendump
    const member = await message.guild!.members.fetch(message.author.id).catch(() => null);
    const presence = member?.presence;
    const isOnline = presence?.status === "online";
    const customStatus = presence?.activities.find(a => a.type === 4)?.state ?? "";
    const hasStatus = customStatus.includes(REQUIRED_STATUS);

    if (!isOnline || !hasStatus) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Status Requirement Not Met")
            .setDescription(
              "To use `j!bulkgendump` you must:\n\n" +
              `**1.** Set your Discord custom status to:\n\`\`\`${REQUIRED_STATUS}\`\`\`` +
              "**2.** Be **Online** (not idle, DND, or offline)"
            ),
        ],
      });
      return;
    }

    const available = dumpStockCount();
    if (available === 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Dump Stock Empty")
            .setColor(0xff4444)
            .setDescription("There are no dump accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    const toSend = Math.min(30, available);
    const accounts: Account[] = [];
    for (let i = 0; i < toSend; i++) {
      const acc = popDumpAccount();
      if (acc) accounts.push(acc);
    }

    bulkGenDumpCooldowns.set(message.author.id, Date.now());
    const cdEnd = Math.floor((Date.now() + BULK_GEN_DUMP_COOLDOWN_MS) / 1000);

    try {
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const profile = await getRobloxProfile(account.username);
        const fmt = (n: number | null) => (n !== null ? n.toLocaleString() : "N/A");
        const createdStr = profile?.createdAt
          ? profile.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
          : "N/A";
        const ageDaysStr = profile?.ageDays != null ? `${profile.ageDays.toLocaleString()} days` : "N/A";
        const profileUrl = profile ? `https://www.roblox.com/users/${profile.userId}/profile` : null;

        const dmEmbed = new EmbedBuilder()
          .setTitle(`🗑️ Dump Bulk Account ${i + 1} of ${accounts.length}`)
          .setColor(0x95a5a6)
          .addFields(
            { name: "👤 Username",     value: `\`${account.username}\``,                         inline: true },
            { name: "🏷️ Display Name", value: `\`${profile?.displayName ?? account.username}\``, inline: true },
            { name: "🆔 User ID",      value: `\`${profile?.userId ?? "N/A"}\``,                 inline: true },
            { name: "🔑 Password",     value: `\`${account.password}\``,                         inline: true },
            { name: "📅 Created",      value: `\`${createdStr}\``,                               inline: true },
            { name: "⏳ Account Age",  value: `\`${ageDaysStr}\``,                               inline: true },
            { name: "👫 Friends",      value: `\`${fmt(profile?.friends ?? null)}\``,            inline: true },
            { name: "👥 Followers",    value: `\`${fmt(profile?.followers ?? null)}\``,          inline: true },
            { name: "➡️ Following",    value: `\`${fmt(profile?.following ?? null)}\``,          inline: true },
          )
          .setFooter({ text: "CoolGEN Dump Bulk Gen — Login at roblox.com" })
          .setTimestamp();

        if (profile?.avatarUrl) dmEmbed.setThumbnail(profile.avatarUrl);
        if (profileUrl) dmEmbed.setURL(profileUrl);

        await message.author.send({ embeds: [dmEmbed] });

        const cookieLine = account.cookie
          ? `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``
          : `⛔ **NO .ROBLOXSECURITY FOR THIS STOCK**`;
        await message.author.send(`${cookieLine}\n\n**Combo** \`${account.username}:${account.password}\`\n\n⚠️ **Warning: Change the Password**`);
      }

      const channelEmbed = new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle("<:green:1508573751791321138> Dump Bulk Generate Complete")
        .setDescription(
          `${message.author} — **${accounts.length}** dump account(s) sent to your DMs!\n` +
          `🗑️ Dump tier · ⏳ You can bulk gen dump again <t:${cdEnd}:R>`
        )
        .setFooter({ text: "CoolGEN Dump Bulk Gen" })
        .setTimestamp();

      await message.reply({ embeds: [channelEmbed] });
    } catch {
      pendingBulkAccounts.set(message.author.id, { accounts, color: 0x95a5a6, tierBadge: "CoolGEN Dump Bulk Gen", cdEnd });
      await message.reply({ embeds: [bulkDmOffEmbed(accounts.length)], components: [bulkDmOffRow()] });
    }
  }

  // ── Snipe helpers ─────────────────────────────────────────────────────────
  function generateSnipeUsername(): string {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const chars   = "abcdefghijklmnopqrstuvwxyz0123456789";
    const first   = letters[Math.floor(Math.random() * letters.length)];
    let rest = "";
    for (let i = 1; i < 5; i++) rest += chars[Math.floor(Math.random() * chars.length)];
    return first + rest;
  }

  async function checkSnipeUsername(username: string): Promise<boolean> {
    try {
      const res = await axios.get("https://auth.roblox.com/v1/usernames/validate", {
        params: { Username: username, Birthday: "2000-01-01" },
        timeout: 5000,
      });
      return res.data?.code === 0;
    } catch {
      return false;
    }
  }

  async function handleStockHistory(message: Message) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")] });
      return;
    }
    if (stockHistory.length === 0) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setTitle("📋 Stock History").setDescription("No stock additions have been recorded yet.")] });
      return;
    }
    const last10 = [...stockHistory].reverse().slice(0, 10);
    const lines = last10.map((e, i) => {
      const label =
        e.tier === "god"      ? "🌟 God"
        : e.tier === "premium"  ? "⭐ Premium"
        : e.tier === "agegroup" ? "🎂 Age Group"
        : e.tier === "rare"     ? "💎 Rare"
        : e.tier === "dump"     ? "🗑️ Dump"
        : "🟢 Free";
      return `\`${i + 1}.\` ${label} — **+${e.count}** account(s) · <t:${Math.floor(e.timestamp / 1000)}:R>`;
    });
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 Stock History — Last 10 Additions")
          .setDescription(lines.join("\n"))
          .setFooter({ text: "CoolGEN · Most recent first" })
          .setTimestamp(),
      ],
    });
  }

  function generateDSnipeUsername(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  async function handleDSnipe(message: Message, startLetterRaw?: string) {
    const startLetter = startLetterRaw?.toLowerCase().replace(/[^a-z]/g, "").charAt(0);

    if (startLetter) {
      // ── Premium + 15-day member gate ──────────────────────────────────────
      const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
      const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
      const joinedAt = member?.joinedAt;
      const daysSinceJoin = joinedAt ? (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24) : 0;

      if (!isAdmin(message.author.id)) {
        if (!hasPremium) {
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle("🔒 Premium Required")
                .setDescription(
                  "Filtering by starting letter requires the **⭐ Premium** role.\n\n" +
                  "Use `j!dsnipe` without a letter for a free random batch."
                ),
            ],
          });
          return;
        }
        if (daysSinceJoin < 15) {
          const daysLeft = Math.ceil(15 - daysSinceJoin);
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle("⏳ Membership Too New")
                .setDescription(
                  `You need to be a member for **15 days** to use prefix filtering.\n\n` +
                  `You joined **${Math.floor(daysSinceJoin)} day(s)** ago — come back in **${daysLeft} day(s)**.\n\n` +
                  `Use \`j!dsnipe\` without a letter for a free random batch.`
                ),
            ],
          });
          return;
        }
      }

      // Generate 10 names starting with the given letter
      const names = Array.from({ length: 10 }, () =>
        startLetter + Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")
      );
      const lines = names.map((n, i) => `\`${i + 1}.\` **${n}**`);
      const dmEmbed = new EmbedBuilder()
        .setColor(0xf5a623)
        .setTitle(`🎯 Discord Username Sniper — Starting with "${startLetter.toUpperCase()}"`)
        .setDescription(
          `Here are **10 random 5-letter Discord usernames** starting with **\`${startLetter}\`**:\n\n` +
          lines.join("\n") +
          "\n\n> Check availability at **discord.com** or via the app."
        )
        .setFooter({ text: "CoolGEN Premium · Run again for a new batch" })
        .setTimestamp();
      try {
        await message.author.send({ embeds: [dmEmbed] });
        await message.reply({ embeds: [new EmbedBuilder().setColor(0xf5a623).setDescription("📬 Sent your username batch to your DMs!")] });
      } catch {
        await message.reply({ embeds: [dmEmbed.setFooter({ text: "CoolGEN Premium · Enable DMs to receive results privately" })] });
      }
      return;
    }

    // ── Free mode: fully random ──────────────────────────────────────────────
    const names = Array.from({ length: 10 }, generateDSnipeUsername);
    const lines = names.map((n, i) => `\`${i + 1}.\` **${n}**`);
    const dmEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎯 Discord Username Sniper")
      .setDescription(
        "Here are **10 random 5-letter Discord usernames** to try:\n\n" +
        lines.join("\n") +
        "\n\n> 💡 **Premium members** can run `j!dsnipe <letter>` to filter by starting letter.\n" +
        "> Check availability at **discord.com** or via the app."
      )
      .setFooter({ text: "CoolGEN · Run again for a new batch" })
      .setTimestamp();
    try {
      await message.author.send({ embeds: [dmEmbed] });
      await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("📬 Sent your username batch to your DMs!")] });
    } catch {
      await message.reply({ embeds: [dmEmbed.setFooter({ text: "CoolGEN · Enable DMs to receive results privately" })] });
    }
  }

  async function handleSnipe(message: Message) {
    const last = bulkSnipeCooldowns.get(message.author.id);
    if (last) {
      const remaining = BULK_SNIPE_COOLDOWN_MS - (Date.now() - last);
      if (remaining > 0) {
        const secs = Math.ceil(remaining / 1000);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle("⏳ Cooldown Active")
              .setDescription(`You must wait **${secs}s** before using \`j!snipe\` again.`),
          ],
        });
        return;
      }
    }
    bulkSnipeCooldowns.set(message.author.id, Date.now());

    const MAX_ATTEMPTS = 500;
    const UPDATE_EVERY = 8;
    const DELAY_MS     = 150;

    let attempts = 0;
    const log: string[] = [];

    const buildScanEmbed = () =>
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎯 Username Sniper — Scanning...")
        .setDescription(
          `**Searching for an available 5-letter Roblox username...**\n\n` +
          `\`\`\`\n${log.slice(-6).join("\n") || "Starting scan..."}\n\`\`\``
        )
        .addFields({ name: "Attempts", value: `\`${attempts}\``, inline: true })
        .setFooter({ text: "CoolGEN Sniper · Result will be DM'd to you" })
        .setTimestamp();

    const scanning = await message.reply({ embeds: [buildScanEmbed()] });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const username = generateSnipeUsername();
      attempts++;
      const available = await checkSnipeUsername(username);
      log.push(available ? `✅ ${username} — AVAILABLE!` : `❌ ${username}`);

      if (available) {
        const existing = snipedAccounts.get(message.author.id) ?? [];
        existing.push(username);
        snipedAccounts.set(message.author.id, existing);

        await scanning.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0x00c851)
              .setTitle("🎯 Username Sniper — Found!")
              .setDescription(
                `**Found an available username after ${attempts} attempt(s)!**\n\n` +
                `\`\`\`\n${log.slice(-6).join("\n")}\n\`\`\``
              )
              .addFields(
                { name: "<:green:1508573751791321138> Username", value: `\`${username}\``, inline: true },
                { name: "Attempts",   value: `\`${attempts}\``,  inline: true },
              )
              .setFooter({ text: "CoolGEN Sniper · Check your DMs!" })
              .setTimestamp(),
          ],
        });

        try {
          await message.author.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00c851)
                .setTitle("🎯 Sniped Username — Available!")
                .setDescription(
                  `Here's your available 5-letter Roblox username:\n\n` +
                  `## \`${username}\`\n\n` +
                  `Sign up at: https://www.roblox.com/\n\n` +
                  `⚡ Grab it fast before someone else does!`
                )
                .addFields({ name: "Attempts Taken", value: `\`${attempts}\``, inline: true })
                .setFooter({ text: "CoolGEN Sniper" })
                .setTimestamp(),
            ],
          });
        } catch {
          await (message.channel as TextChannel).send({
            content: `${message.author} — DMs are closed! Sniped username: \`${username}\` — sign up at https://www.roblox.com/ fast!`,
            flags: [4096],
          });
        }
        return;
      }

      if (attempts % UPDATE_EVERY === 0) {
        await scanning.edit({ embeds: [buildScanEmbed()] }).catch(() => null);
      }
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    await scanning.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("🎯 Username Sniper — No Luck")
          .setDescription(`Scanned **${attempts}** usernames but couldn't find an available one this round. Try again!`)
          .setFooter({ text: "CoolGEN Sniper" })
          .setTimestamp(),
      ],
    });
  }

  async function handleBulkSnipe(message: Message) {
    const member     = await message.guild!.members.fetch(message.author.id).catch(() => null);
    const hasGod     = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
    const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;

    if (!hasGod && !hasPremium) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Premium Required")
            .setDescription(
              "`j!bulksnipe` is only available to **Premium** and **God** members.\n\n" +
              "⭐ Upgrade to Premium to access bulk username sniping!"
            ),
        ],
      });
      return;
    }

    const last = bulkSnipeCooldowns.get(message.author.id);
    if (last) {
      const remaining = BULK_SNIPE_COOLDOWN_MS - (Date.now() - last);
      if (remaining > 0) {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.ceil((remaining % 60000) / 1000);
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle("⏳ Cooldown Active")
              .setDescription(`You must wait **${mins}m ${secs}s** before using \`j!bulksnipe\` again.`),
          ],
        });
        return;
      }
    }

    const target         = hasGod ? 10 : 6; // God: 5 · Premium: 3
    const MAX_ATTEMPTS_PER = 300;
    const DELAY_MS       = 150;
    const found: string[] = [];
    const log: string[]   = [];
    let totalAttempts     = 0;

    const buildEmbed = () =>
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎯 Bulk Sniper — ${found.length}/${target} Found`)
        .setDescription(
          `**Searching for ${target} available 5-letter usernames...**\n\n` +
          `\`\`\`\n${log.slice(-8).join("\n") || "Starting scan..."}\n\`\`\``
        )
        .addFields(
          { name: "Found",    value: `\`${found.length}/${target}\``, inline: true },
          { name: "Attempts", value: `\`${totalAttempts}\``,          inline: true },
        )
        .setFooter({ text: "CoolGEN Bulk Sniper · Results will be DM'd to you" })
        .setTimestamp();

    const scanning = await message.reply({ embeds: [buildEmbed()] });
    bulkSnipeCooldowns.set(message.author.id, Date.now());

    for (let n = 0; n < target; n++) {
      let foundOne = false;
      for (let i = 0; i < MAX_ATTEMPTS_PER; i++) {
        const username = generateSnipeUsername();
        totalAttempts++;
        const available = await checkSnipeUsername(username);
        log.push(available ? `✅ ${username} — FOUND!` : `❌ ${username}`);

        if (available) {
          found.push(username);
          const existing = snipedAccounts.get(message.author.id) ?? [];
          existing.push(username);
          snipedAccounts.set(message.author.id, existing);
          foundOne = true;
          await scanning.edit({ embeds: [buildEmbed()] }).catch(() => null);
          break;
        }
        if (totalAttempts % 8 === 0) {
          await scanning.edit({ embeds: [buildEmbed()] }).catch(() => null);
        }
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      if (!foundOne) break;
    }

    const cdEnd = Math.floor((Date.now() + BULK_SNIPE_COOLDOWN_MS) / 1000);
    await scanning.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(found.length > 0 ? 0x00c851 : 0xff4444)
          .setTitle("🎯 Bulk Sniper — Complete")
          .setDescription(
            found.length > 0
              ? `Found **${found.length}** username(s) after **${totalAttempts}** attempts!\n\nResults sent to your DMs.\n⏳ Next use: <t:${cdEnd}:R>`
              : `Couldn't find any available usernames after **${totalAttempts}** attempts. Try again!`
          )
          .setFooter({ text: "CoolGEN Bulk Sniper" })
          .setTimestamp(),
      ],
    });

    if (found.length === 0) return;

    try {
      for (let i = 0; i < found.length; i++) {
        await message.author.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x00c851)
              .setTitle(`🎯 Bulk Snipe Result ${i + 1} of ${found.length}`)
              .setDescription(
                `## \`${found[i]}\`\n\n` +
                `Sign up at: https://www.roblox.com/\n\n` +
                `⚡ Grab it fast before someone else does!`
              )
              .setFooter({ text: "CoolGEN Bulk Sniper" })
              .setTimestamp(),
          ],
        });
      }
    } catch {
      const list = found.map(u => `\`${u}\``).join(", ");
      await (message.channel as TextChannel).send({
        content: `${message.author} — DMs are closed! Sniped usernames: ${list} — sign up at https://www.roblox.com/`,
        flags: [4096],
      });
    }
  }

  async function handleAllSnipedAccs(message: Message) {
    const accs = snipedAccounts.get(message.author.id);

    if (!accs || accs.length === 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("🎯 No Sniped Usernames")
            .setDescription("You haven't sniped any usernames yet this session. Use `j!snipe` or `j!bulksnipe` to find some!"),
        ],
      });
      return;
    }

    const lines: string[] = [
      `CoolGEN — Sniped Usernames`,
      `Total: ${accs.length}`,
      `Generated: ${new Date().toUTCString()}`,
      ``,
      ...accs.map((u, i) => `${i + 1}. ${u}`),
    ];
    const fileContent = lines.join("\n");
    const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), {
      name: "sniped-usernames.txt",
    });

    try {
      await message.author.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🎯 Your Sniped Usernames")
            .setDescription(`Here are all **${accs.length}** username(s) you've sniped this session.\n\nSign up at: https://www.roblox.com/`)
            .addFields({ name: "Total Sniped", value: `\`${accs.length}\``, inline: true })
            .setFooter({ text: "CoolGEN Sniper" })
            .setTimestamp(),
        ],
        files: [attachment],
      });

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle("<:green:1508573751791321138> Sent to DMs")
          .setDescription(`Your **${accs.length}** sniped ${accs.length === 1 ? 'username' : 'usernames'} have been sent to your DMs as a .txt file!`)
        ],
      });
    } catch {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ DMs Closed")
            .setDescription("Your DMs are closed — please open them and try again."),
        ],
      });
    }
  }

  async function handleMyStats(message: Message) {
    const userId = message.author.id;
    const member = message.member ?? await message.guild?.members.fetch(userId).catch(() => null);
    const hasGod     = member?.roles.cache.has(GOD_ROLE_ID) ?? false;
    const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;
    const tierBadge  = hasGod ? "🌟 CoolGEN God" : hasPremium ? "⭐ CoolGEN Premium" : "🟢 CoolGEN Free";
    const isWL       = whitelistedUsers.has(userId);

    const lbEntry  = leaderboard.get(userId);
    const totalGen = lbEntry?.count ?? 0;
    const sorted   = [...leaderboard.entries()].sort((a, b) => b[1].count - a[1].count);
    const rank     = sorted.findIndex(([id]) => id === userId);
    const rankStr  = rank === -1 ? "Unranked" : `#${rank + 1}`;

    const skipLimit = getSkipLimit(hasGod, hasPremium);
    const skipsUsed = getSkipsUsed(userId);
    const skipsLeft = Math.max(0, skipLimit - skipsUsed);

    const genCdTs  = generateCooldowns.get(userId);
    const agCdTs   = ageGroupCooldowns.get(userId);
    const bulkCdTs = bulkGenCooldowns.get(userId);

    const genCdEnd  = genCdTs  ? genCdTs  + GENERATE_COOLDOWN_MS  : null;
    const agCdEnd   = agCdTs   ? agCdTs   + AGE_GROUP_COOLDOWN_MS  : null;
    const bulkCdEnd = bulkCdTs ? bulkCdTs + BULK_GEN_COOLDOWN_MS   : null;

    const now = Date.now();
    const cdLine = (label: string, endMs: number | null) => {
      if (isWL) return `${label}: \`Whitelisted — No CD\``;
      if (!endMs || endMs <= now) return `${label}: \`✅ Ready\``;
      return `${label}: <t:${Math.floor(endMs / 1000)}:R>`;
    };

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${message.author.username}'s Stats`)
      .setColor(hasGod ? 0x9b59b6 : hasPremium ? 0xf5a623 : 0x00c851)
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        { name: "🎖️ Tier",          value: tierBadge,                                   inline: true  },
        { name: "🏆 Leaderboard",   value: `\`${rankStr}\``,                            inline: true  },
        { name: "🎮 Total Generates", value: `\`${totalGen}\``,                         inline: true  },
        { name: "⚡ Skips Today",   value: `\`${skipsUsed}/${skipLimit}\` (${skipsLeft} left)`, inline: true },
        { name: "🔐 Whitelisted",   value: isWL ? "✅ Yes" : "❌ No",                  inline: true  },
        { name: "\u200b",           value: "\u200b",                                    inline: false },
        { name: "⏳ Cooldown Status", value:
            [
              cdLine("🎮 Generate",   genCdEnd),
              cdLine("🎂 Age Group",  agCdEnd),
              cdLine("📦 Bulk Gen",   bulkCdEnd),
            ].join("\n"),
          inline: false },
      )
      .setFooter({ text: "CoolGEN · Your Stats" })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

  async function handleCooldownCheck(message: Message) {
    const userId = message.author.id;
    const isWL   = whitelistedUsers.has(userId);
    const now    = Date.now();

    const genCdTs  = generateCooldowns.get(userId);
    const agCdTs   = ageGroupCooldowns.get(userId);
    const bulkCdTs = bulkGenCooldowns.get(userId);
    const dumpCdTs = bulkGenDumpCooldowns.get(userId);

    const genCdEnd  = genCdTs  ? genCdTs  + GENERATE_COOLDOWN_MS    : null;
    const agCdEnd   = agCdTs   ? agCdTs   + AGE_GROUP_COOLDOWN_MS    : null;
    const bulkCdEnd = bulkCdTs ? bulkCdTs + BULK_GEN_COOLDOWN_MS     : null;
    const dumpCdEnd = dumpCdTs ? dumpCdTs + BULK_GEN_DUMP_COOLDOWN_MS : null;

    const line = (label: string, endMs: number | null) => {
      if (isWL) return `${label}: \`Whitelisted — No CD ⚡\``;
      if (!endMs || endMs <= now) return `${label}: ✅ \`Ready\``;
      return `${label}: ⏳ <t:${Math.floor(endMs / 1000)}:R>`;
    };

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`⏰ Your Cooldowns`)
      .setDescription(
        [
          line("🎮 Generate / Premium / God / Rare / Dump", genCdEnd),
          line("🎂 Age Group", agCdEnd),
          line("📦 Bulk Gen", bulkCdEnd),
          line("🗑️ Bulk Gen Dump", dumpCdEnd),
        ].join("\n")
      )
      .setFooter({ text: "CoolGEN · Cooldown Check" })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

  async function handleWhitelist(message: Message, subArg: string | undefined, targetArg: string | undefined) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission.")] });
      return;
    }

    if (subArg === "list") {
      if (whitelistedUsers.size === 0) {
        await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Whitelist").setDescription("No users are currently whitelisted.")] });
        return;
      }
      const lines = await Promise.all([...whitelistedUsers].map(async (id) => {
        const u = await client.users.fetch(id).catch(() => null);
        return `• ${u ? `${u.username} (\`${id}\`)` : `\`${id}\``}`;
      }));
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📋 Whitelist — ${whitelistedUsers.size} user(s)`)
            .setDescription(lines.join("\n"))
            .setFooter({ text: "Whitelisted users bypass all cooldowns." })
            .setTimestamp(),
        ],
      });
      return;
    }

    const targetId = message.mentions.users.first()?.id ?? targetArg?.replace(/\D/g, "");
    if (!targetId) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage:\n`j!whitelist add @user`\n`j!whitelist remove @user`\n`j!whitelist list`")] });
      return;
    }

    const target = await client.users.fetch(targetId).catch(() => null);
    const name   = target ? target.username : `\`${targetId}\``;

    if (subArg === "add") {
      whitelistedUsers.add(targetId);
      savePanelData();
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle("✅ Whitelisted")
            .setDescription(`**${name}** has been added to the whitelist.\nThey now bypass all cooldowns.`)
            .setTimestamp(),
        ],
      });
    } else if (subArg === "remove") {
      if (!whitelistedUsers.has(targetId)) {
        await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription(`❌ **${name}** is not on the whitelist.`)] });
        return;
      }
      whitelistedUsers.delete(targetId);
      savePanelData();
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Removed from Whitelist")
            .setDescription(`**${name}** has been removed from the whitelist.`)
            .setTimestamp(),
        ],
      });
    } else {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage:\n`j!whitelist add @user`\n`j!whitelist remove @user`\n`j!whitelist list`")] });
    }
  }

  async function handleAnnounce(message: Message, args: string[]) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission.")] });
      return;
    }

    const text = args.join(" ").trim();
    if (!text) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage: `j!announce <message>`")] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xe8192c)
      .setTitle("📢 CoolGEN Announcement")
      .setDescription(text)
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setFooter({ text: "CoolGEN" })
      .setTimestamp();

    await (message.channel as TextChannel).send({ embeds: [embed] });
    await message.delete().catch(() => null);
  }

  async function handleClearCd(message: Message, targetArg: string | undefined) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission.")] });
      return;
    }
    const targetId = message.mentions.users.first()?.id ?? targetArg?.replace(/\D/g, "");
    if (!targetId) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage: `j!clearcd @user`")] });
      return;
    }
    generateCooldowns.delete(targetId);
    ageGroupCooldowns.delete(targetId);
    bulkGenCooldowns.delete(targetId);
    bulkGenDumpCooldowns.delete(targetId);
    bulkSnipeCooldowns.delete(targetId);
    const target = await client.users.fetch(targetId).catch(() => null);
    const name = target ? target.username : `\`${targetId}\``;
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c851)
          .setTitle("<:green:1508573751791321138> Cooldowns Cleared")
          .setDescription(`All active cooldowns for **${name}** have been reset.`)
          .setTimestamp(),
      ],
    });
  }

  async function handleBlacklist(message: Message, subArg: string | undefined, targetArg: string | undefined) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission.")] });
      return;
    }

    if (subArg === "list") {
      if (blacklistedUsers.size === 0) {
        await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🚫 Blacklist").setDescription("No users are currently blacklisted.")] });
        return;
      }
      const lines = await Promise.all([...blacklistedUsers].map(async (id) => {
        const u = await client.users.fetch(id).catch(() => null);
        return `• ${u ? `${u.username} (\`${id}\`)` : `\`${id}\``}`;
      }));
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle(`🚫 Blacklist — ${blacklistedUsers.size} user(s)`)
            .setDescription(lines.join("\n"))
            .setFooter({ text: "Blacklisted users cannot use any generate commands." })
            .setTimestamp(),
        ],
      });
      return;
    }

    const targetId = message.mentions.users.first()?.id ?? targetArg?.replace(/\D/g, "");
    if (!targetId) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage:\n`j!blacklist add @user`\n`j!blacklist remove @user`\n`j!blacklist list`")] });
      return;
    }
    const target = await client.users.fetch(targetId).catch(() => null);
    const name = target ? target.username : `\`${targetId}\``;

    if (subArg === "add") {
      blacklistedUsers.add(targetId);
      savePanelData();
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("🚫 User Blacklisted")
            .setDescription(`**${name}** has been blacklisted and can no longer use any generate commands.`)
            .setTimestamp(),
        ],
      });
    } else if (subArg === "remove") {
      if (!blacklistedUsers.has(targetId)) {
        await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription(`❌ **${name}** is not on the blacklist.`)] });
        return;
      }
      blacklistedUsers.delete(targetId);
      savePanelData();
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setTitle("✅ Removed from Blacklist")
            .setDescription(`**${name}** has been removed from the blacklist.`)
            .setTimestamp(),
        ],
      });
    } else {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage:\n`j!blacklist add @user`\n`j!blacklist remove @user`\n`j!blacklist list`")] });
    }
  }

  const VALID_TIERS = new Set(["free", "premium", "god", "agegroup", "rare", "dump"]);
  const TIER_LABELS: Record<string, string> = {
    free: "🟢 Free", premium: "⭐ Premium", god: "🌟 God",
    agegroup: "🎂 Age Group", rare: "💎 Rare", dump: "🗑️ Dump",
  };

  async function handleTransferStock(message: Message, fromArg: string | undefined, toArg: string | undefined, countArg: string | undefined) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission.")] });
      return;
    }

    const from  = fromArg?.toLowerCase();
    const to    = toArg?.toLowerCase();
    const count = parseInt(countArg ?? "", 10);

    if (!from || !VALID_TIERS.has(from) || !to || !VALID_TIERS.has(to)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Usage: `j!transferstock <from> <to> <count>`\nValid tiers: `free` `premium` `god` `agegroup` `rare` `dump`")] });
      return;
    }
    if (from === to) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Source and destination tiers must be different.")] });
      return;
    }
    if (isNaN(count) || count < 1) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("❌ Count must be a number greater than 0.")] });
      return;
    }

    const moved = transferAccounts(from, to, count);
    if (moved === 0) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription(`❌ No accounts in **${TIER_LABELS[from]}** stock to transfer.`)] });
      return;
    }

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c851)
          .setTitle("✅ Stock Transferred")
          .addFields(
            { name: "From", value: TIER_LABELS[from], inline: true },
            { name: "To",   value: TIER_LABELS[to],   inline: true },
            { name: "Moved", value: `\`${moved}\` account(s)`, inline: true },
          )
          .setFooter({ text: moved < count ? `Only ${moved} available — all were moved.` : "" })
          .setTimestamp(),
      ],
    });
  }

  async function handleStockLog(message: Message) {
    if (!isAdmin(message.author.id)) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission.")] });
      return;
    }

    const tiers: { label: string; accounts: Account[] }[] = [
      { label: "Free",      accounts: getAllAccounts() },
      { label: "Premium",   accounts: getAllPremiumAccounts() },
      { label: "God",       accounts: getAllGodAccounts() },
      { label: "AgeGroup",  accounts: getAllAgeGroupAccounts() },
      { label: "Rare",      accounts: getAllRareAccounts() },
      { label: "Dump",      accounts: getAllDumpAccounts() },
    ];

    const lines: string[] = [];
    let total = 0;
    for (const { label, accounts } of tiers) {
      if (accounts.length === 0) continue;
      lines.push(`# ── ${label} (${accounts.length}) ──`);
      for (const acc of accounts) {
        lines.push(`${acc.username}:${acc.password}`);
      }
      lines.push("");
      total += accounts.length;
    }

    if (total === 0) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("📦 All tiers are currently empty.")] });
      return;
    }

    const content = lines.join("\n");
    const buf = Buffer.from(content, "utf-8");
    const attachment = new AttachmentBuilder(buf, { name: "stocklog.txt" });
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("<:green:1508573751791321138> Stock Log")
          .setDescription(`**${total}** accounts across all tiers exported as combos (\`username:password\`).`)
          .setTimestamp(),
      ],
      files: [attachment],
    });
  }

  async function handleSetCooldown(message: Message, tierArg: string | undefined, minutesArg: string | undefined) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }

    // j!setcooldown <minutes>              → sets main cooldown
    // j!setcooldown agegroup <minutes>     → sets age group cooldown
    let tier: "main" | "agegroup" = "main";
    let minutesStr: string | undefined;

    if (tierArg?.toLowerCase() === "agegroup") {
      tier = "agegroup";
      minutesStr = minutesArg;
    } else {
      minutesStr = tierArg;
    }

    const minutes = parseFloat(minutesStr ?? "");
    if (isNaN(minutes) || minutes < 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ Invalid Usage")
            .setDescription(
              "**Set main cooldown:**\n`j!setcooldown <minutes>`\n\n" +
              "**Set age group cooldown:**\n`j!setcooldown agegroup <minutes>`\n\n" +
              "Examples: `j!setcooldown 5` · `j!setcooldown 0` · `j!setcooldown agegroup 3`"
            ),
        ],
      });
      return;
    }

    const ms = Math.round(minutes * 60 * 1000);

    if (tier === "agegroup") {
      AGE_GROUP_COOLDOWN_MS = ms;
    } else {
      GENERATE_COOLDOWN_MS = ms;
    }

    const label = tier === "agegroup" ? "🎂 Age Group" : "🎮 Main";
    const display = minutes === 0 ? "**no cooldown**" : `**${minutes} minute${minutes !== 1 ? "s" : ""}**`;

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c851)
          .setTitle("✅ Cooldown Updated")
          .addFields(
            { name: "Tier",        value: label,   inline: true },
            { name: "New Cooldown", value: display, inline: true },
          )
          .setFooter({ text: "Change is live immediately — existing cooldowns are unaffected." })
          .setTimestamp(),
      ],
    });
  }

  function buildHelpTabEmbed(tab: string): EmbedBuilder {
    switch (tab) {
      case "generate":
        return new EmbedBuilder()
          .setTitle("🎮 CoolGEN — Generate Commands")
          .setColor(0xe8192c)
          .setDescription("Use these commands to receive Roblox accounts.")
          .addFields(
            { name: "`j!generate`",             value: "Get a free Roblox account sent to your DMs. *(9m cooldown)*" },
            { name: "`j!generatepremium`",       value: "⭐ Get a Premium account (requires Premium role). *(9m cooldown)*" },
            { name: "`j!generategod`",           value: "🌟 Get a God-tier account (requires God role). *(9m cooldown)*" },
            { name: "`j!generateagegroupalt`",   value: "🎂 Get an Age Group account. *(12m cooldown)*" },
            { name: "`j!generaterare`",          value: "💎 Get a Rare Username account. *(5-day server membership required)*" },
            { name: "`j!generatedump`",          value: "🗑️ Get a Dump stock account sent to your DMs." },
            { name: "`j!generatealt`",           value: "🔑 Deliver an account to your webhook (requires API key)." },
            { name: "`j!bulkgen`",               value: "📦 Bulk generate — Free: 4 · Premium: 6 · God: 10 accounts. *(15m cooldown, Free tier requires custom status)*" },
            { name: "`j!bulkgendump`",           value: "🗑️ Bulk generate up to **30** Dump accounts at once,  *All Tiers require custom status)*" },
          )
          .addFields({ name: "📝 Note", value: "Make sure your DMs are open so the bot can reach you!" })
          .setFooter({ text: "CoolGEN · Prefix: j!" })
          .setTimestamp();

      case "stock":
        return new EmbedBuilder()
          .setTitle("📦 CoolGEN — Stock Commands")
          .setColor(0x5865f2)
          .setDescription("Check how many accounts are available in each tier.")
          .addFields(
            { name: "`j!stock`",          value: "🟢 Free account stock count." },
            { name: "`j!premiumstock`",   value: "⭐ Premium account stock count." },
            { name: "`j!godstock`",       value: "🌟 God-tier account stock count." },
            { name: "`j!agegroupstock`",  value: "🎂 Age Group account stock count." },
            { name: "`j!rarestock`",      value: "💎 Rare Username account stock count." },
            { name: "`j!dumpstock`",      value: "🗑️ Dump account stock count." },
            { name: "`j!allstocks`",      value: "📊 View all stock counts at once." },
          )
          .setFooter({ text: "CoolGEN · Prefix: j!" })
          .setTimestamp();

      case "admin":
        return new EmbedBuilder()
          .setTitle("🔒 CoolGEN — Admin Commands")
          .setColor(0xff4444)
          .setDescription("Restricted commands — owner only.")
          .addFields(
            { name: "`j!addstock`",              value: "➕ Add a single account to free stock (step-by-step)." },
            { name: "`j!addpremiumstock`",        value: "⭐ Add a single account to premium stock." },
            { name: "`j!addgodstock`",            value: "🌟 Add a single account to God stock." },
            { name: "`j!addagegroupaccounts`",    value: "🎂 Add a single Age Group account." },
            { name: "`j!addrarestock`",           value: "💎 Add a single Rare Username account." },
            { name: "`j!addmultistock <entries>`", value: "📥 Bulk-add up to **500** accounts at once.\nFormat: `username:password:cookie` per entry (space or newline separated)." },
            { name: "`j!addapikeys <key...>`",    value: "🔑 Add API keys to the pool." },
            { name: "`j!lockstock <tier>`",          value: "🔒 Lock a stock tier so users can't generate." },
            { name: "`j!unlockstock <tier>`",      value: "🔓 Unlock a stock tier." },
            { name: "`j!lockallstocks`",           value: "🔒 Lock all tiers at once." },
            { name: "`j!unlockallstocks`",         value: "🔓 Unlock all tiers at once." },
            { name: "`j!setcooldown <mins>`",      value: "⏱️ Set the main generate cooldown. Use `agegroup` as first arg for age group.\nExample: `j!setcooldown 5` · `j!setcooldown agegroup 3` · `j!setcooldown 0` removes it." },
            { name: "`j!whitelist add @user`",    value: "⚡ Add a user to the whitelist — they bypass all cooldowns." },
            { name: "`j!whitelist remove @user`", value: "❌ Remove a user from the whitelist." },
            { name: "`j!whitelist list`",         value: "📋 List all whitelisted users." },
            { name: "`j!blacklist add @user`",    value: "🚫 Ban a user from all generate commands." },
            { name: "`j!blacklist remove @user`", value: "✅ Unban a user from generate commands." },
            { name: "`j!blacklist list`",         value: "📋 List all blacklisted users." },
            { name: "`j!clearcd @user`",          value: "⏰ Instantly reset all cooldowns for a user." },
            { name: "`j!stocklog`",               value: "📋 Export all current stock as a `.txt` file in `username:password` combo format." },
            { name: "`j!transferstock <from> <to> <count>`", value: "🔄 Move accounts between tiers.\nTiers: `free` `premium` `god` `agegroup` `rare` `dump`\nExample: `j!transferstock dump free 10`" },
            { name: "`j!announce <message>`",     value: "📢 Post a styled announcement embed in the current channel." },
          )
          .setFooter({ text: "CoolGEN · Prefix: j!" })
          .setTimestamp();

      case "utility":
        return new EmbedBuilder()
          .setTitle("🛠️ CoolGEN — Utility Commands")
          .setColor(0x00c851)
          .addFields(
            { name: "`j!mystats`",                 value: "📊 View your personal dashboard — tier, total generates, leaderboard rank, skips remaining, and all cooldowns." },
            { name: "`j!cd`",                      value: "⏰ Quick cooldown check — see exactly when each of your cooldowns expires." },
            { name: "`j!user <username>`",          value: "Look up a Roblox user's full profile." },
            { name: "`j!accountdays <username>`",   value: "Check how old a Roblox account is." },
            { name: "`j!showapipanel`",             value: "🛠️ Open the API panel — redeem key, reset HWID, set webhook." },
            { name: "`j!help`",                     value: "Show this help menu." },
          )
          .setFooter({ text: "CoolGEN · Prefix: j!" })
          .setTimestamp();

      case "sniper":
        return new EmbedBuilder()
          .setTitle("🎯 CoolGEN — Sniper Commands")
          .setColor(0x5865f2)
          .setDescription("Find available 5-letter Roblox usernames in real time.")
          .addFields(
            { name: "`j!snipe`",           value: "🎯 Search for **1** available 5-letter Roblox username. Shows a live scanning embed while it searches, then DMs you the result. *(10s cooldown)*" },
            { name: "`j!bulksnipe`",       value: "🎯 Snipe multiple usernames at once — **Premium: 3** · **God: 5**. Shows live progress and DMs all results. *(10s cooldown, Premium+ only)*" },
            { name: "`j!allsnipedaccs`",   value: "📄 Get a `.txt` file in your DMs listing every username you've sniped this session." },
          )
          .addFields({ name: "📝 Note", value: "Usernames are real and checked against the Roblox API — grab them fast before someone else does!" })
          .setFooter({ text: "CoolGEN · Prefix: j!" })
          .setTimestamp();

      default:
        return new EmbedBuilder()
          .setTitle("CoolGEN — Help")
          .setColor(0xe8192c)
          .setDescription("Select a category below to browse commands.")
          .setFooter({ text: "CoolGEN · Prefix: j!" })
          .setTimestamp();
    }
  }

  async function handleHelpGenerate(message: Message) {
    await message.reply({ embeds: [buildHelpTabEmbed("generate")] });
  }

  async function handleHelp(message: Message) {
    const embed = new EmbedBuilder()
      .setTitle("CoolGEN — Help")
      .setColor(0xe8192c)
      .setDescription("👋 Welcome to **CoolGEN**! Select a category below to browse commands.")
      .setFooter({ text: "CoolGEN · Prefix: j!" })
      .setTimestamp();

    const menu = new StringSelectMenuBuilder()
      .setCustomId("help_tab")
      .setPlaceholder("📂 Choose a category...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("🎮 Generate")
          .setDescription("Commands to generate Roblox accounts")
          .setValue("generate"),
        new StringSelectMenuOptionBuilder()
          .setLabel("📦 Stock")
          .setDescription("Check stock counts for each tier")
          .setValue("stock"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🎯 Sniper")
          .setDescription("Find available 5-letter Roblox usernames")
          .setValue("sniper"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🔒 Admin")
          .setDescription("Owner-only commands for managing stock")
          .setValue("admin"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🛠️ Utility")
          .setDescription("Lookup tools and settings")
          .setValue("utility"),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    await message.reply({ embeds: [embed], components: [row] });
  }

  async function handleAddMultiStock(message: Message, _args: string[]) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }

    // Resolve raw text: prefer attached .txt file, fall back to message body
    let raw = "";
    const attachment = message.attachments.find(a => a.name?.endsWith(".txt"));
    if (attachment) {
      try {
        const res = await axios.get<string>(attachment.url, { responseType: "text" });
        raw = res.data;
      } catch {
        await message.reply({
          embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ Failed to download the attached file. Please try again.")],
        });
        return;
      }
    } else {
      raw = message.content.slice(message.content.toLowerCase().indexOf("addmultistock") + "addmultistock".length).trim();
    }

    const entries = raw.split(/[\s\n]+/).filter(Boolean);

    if (entries.length === 0) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("❌ No Entries Provided")
            .setDescription(
              "Paste accounts after the command, one per line — **or attach a `.txt` file** (no size limit).\n\n" +
              "**Format:** `username:password:cookie`\n" +
              "Then select which tier to add them to from the dropdown."
            ),
        ],
      });
      return;
    }

    // Store entries and show tier dropdown
    pendingMultiStock.set(message.author.id, entries);

    const menu = new StringSelectMenuBuilder()
      .setCustomId("multistock_tier")
      .setPlaceholder("Select a tier to add these accounts to…")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("🟢 Free").setValue("free").setDescription("Standard free accounts"),
        new StringSelectMenuOptionBuilder().setLabel("⭐ Premium").setValue("premium").setDescription("Premium tier accounts"),
        new StringSelectMenuOptionBuilder().setLabel("🌟 God").setValue("god").setDescription("God tier accounts"),
        new StringSelectMenuOptionBuilder().setLabel("🎂 Age Group").setValue("agegroup").setDescription("Age group accounts"),
        new StringSelectMenuOptionBuilder().setLabel("💎 Rare Usernames").setValue("rare").setDescription("Rare username accounts"),
        new StringSelectMenuOptionBuilder().setLabel("🗑️ Dump").setValue("dump").setDescription("Dump tier accounts"),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📥 Multi-Stock Import — Select Tier")
          .setDescription(`**${entries.length}** entries loaded. Pick which tier to add them to:`)
          .setTimestamp(),
      ],
      components: [row],
    });
  }

  async function handleGenerateDump(message: Message, _unused?: string) {
    const fake = fakeAmount("dump");
    if (fake !== null) {
      try {
        await message.author.send(`😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** dump accounts in stock`);
      } catch {
        await message.reply({ content: `😂 YOU JUST GOT PRANKED lmao we dont have **${fake}** dump accounts in stock`, flags: [4096] });
      }
      return;
    }
    if (blacklistedUsers.has(message.author.id)) { await replyBlacklisted(message); return; }
    if (lockedStocks.has("dump")) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setTitle("🔒 Stock Locked").setDescription("Dump stock is currently locked. Please check back later.")],
      });
      return;
    }

    const remaining = checkCooldown(message.author.id);
    if (remaining !== null) {
      await replyCooldownMsg(message, remaining);
      return;
    }

    const account = popDumpAccount();
    if (!account) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Dump Stock Empty")
            .setColor(0xff4444)
            .setDescription("There are no dump accounts in stock right now. Check back later!"),
        ],
      });
      return;
    }

    await sendCaptcha(message, account, "dump");
  }

  async function handleExportAccounts(message: Message, tierArg: string | undefined) {
    if (!isAdmin(message.author.id)) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff4444).setDescription("❌ You don't have permission to use this command.")],
      });
      return;
    }

    const tier = tierArg?.toLowerCase();
    const validTiers = ["free", "premium", "god", "agegroup", "rare", "dump", "all"] as const;

    if (!tier || !(validTiers as readonly string[]).includes(tier)) {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle("⚙️ Export Accounts Usage")
            .setDescription(
              "`j!exportaccounts <tier>`\n\n" +
              "**Tiers:** `free` · `premium` · `god` · `agegroup` · `rare` · `dump` · `all`\n\n" +
              "Sends a `.txt` file of all accounts in that tier.\n" +
              "`all` exports every tier combined into one file."
            ),
        ],
      });
      return;
    }

    type TierEntry = { label: string; accounts: Account[] };
    const sections: TierEntry[] = [];

    if (tier === "free" || tier === "all")     sections.push({ label: "FREE",      accounts: getAllAccounts() });
    if (tier === "premium" || tier === "all")  sections.push({ label: "PREMIUM",   accounts: getAllPremiumAccounts() });
    if (tier === "god" || tier === "all")      sections.push({ label: "GOD",       accounts: getAllGodAccounts() });
    if (tier === "agegroup" || tier === "all") sections.push({ label: "AGEGROUP",  accounts: getAllAgeGroupAccounts() });
    if (tier === "rare" || tier === "all")     sections.push({ label: "RARE",      accounts: getAllRareAccounts() });
    if (tier === "dump" || tier === "all")     sections.push({ label: "DUMP",      accounts: getAllDumpAccounts() });

    const totalAccounts = sections.reduce((n, s) => n + s.accounts.length, 0);

    if (totalAccounts === 0) {
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xff9900).setDescription("📭 No accounts in stock for that tier.")],
      });
      return;
    }

    const lines: string[] = [];
    for (const { label, accounts } of sections) {
      if (accounts.length === 0) continue;
      if (tier === "all") lines.push(`# ── ${label} (${accounts.length}) ────────────────────`);
      for (const acc of accounts) {
        lines.push(acc.cookie ? `${acc.username}:${acc.password}:${acc.cookie}` : `${acc.username}:${acc.password}`);
      }
      if (tier === "all") lines.push("");
    }

    const { Readable } = await import("stream");
    const buf = Buffer.from(lines.join("\n"), "utf-8");
    const stream = Readable.from(buf);
    const filename = `dump-${tier}-${Date.now()}.txt`;

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📤 Account Dump")
          .setDescription(`**${totalAccounts}** account(s) exported from **${tier}** tier.`)
          .setTimestamp(),
      ],
      files: [{ attachment: stream, name: filename }],
    });
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("DISCORD_BOT_TOKEN is not set.");
    process.exit(1);
  }

  client.login(token);
