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
} from "discord.js";
import axios from "axios";
import {
  Account,
  addAccount, popAccount, stockCount,
  addGodAccount, popGodAccount, godStockCount,
  addPremiumAccount, popPremiumAccount, premiumStockCount,
  addAgeGroupAccount, popAgeGroupAccount, ageGroupStockCount,
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
    };
  } catch {
    return null;
  }
}

const PREFIX = "j!";
const STOCK_CHANNEL_ID = "1495195376590786720";
const STOCK_ALLOWED_USER_ID = "1230660770749087796";
const PREMIUM_ROLE_ID = "1495200351710613566";
const GOD_ROLE_ID = "1499806905697042492";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Track active addstock sessions: userId -> step + collected data
interface Session {
  step: "username" | "password" | "cookie";
  tier: "free" | "premium" | "god" | "agegroup";
  username?: string;
  password?: string;
}
const sessions = new Map<string, Session>();

// 9-minute cooldown for generate commands (per user)
const GENERATE_COOLDOWN_MS = 9 * 60 * 1000;
const generateCooldowns = new Map<string, number>();

// 12-minute cooldown for age group generate (per user)
const AGE_GROUP_COOLDOWN_MS = 12 * 60 * 1000;
const ageGroupCooldowns = new Map<string, number>();

// Pending accounts for users whose DMs are off
interface PendingAccount {
  account: Account;
  tier: "free" | "premium" | "god" | "agegroup";
}
const pendingAccounts = new Map<string, PendingAccount>();

// Pending captcha verifications
interface PendingCaptcha {
  account: Account;
  tier: "free" | "premium" | "god" | "agegroup";
  correctColor: string;
  originalMessage: Message;
  timeoutHandle: ReturnType<typeof setTimeout>;
}
const pendingCaptchas = new Map<string, PendingCaptcha>();

// Home guild is resolved at startup from the stock channel
let HOME_GUILD_ID: string | null = null;

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
});

// Auto-leave any server the bot gets invited to that isn't home
client.on("guildCreate", async (guild) => {
  if (!HOME_GUILD_ID || guild.id !== HOME_GUILD_ID) {
    console.log(`Invited to non-home guild: ${guild.name} (${guild.id}) — leaving.`);
    await guild.leave().catch(() => null);
  }
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  // Ignore all DMs — bot only responds in servers
  if (!message.guild) return;

  // Handle active addstock session replies (only in the stock channel)
  if (
    sessions.has(message.author.id) &&
    message.channel.id === STOCK_CHANNEL_ID
  ) {
    await handleSessionReply(message);
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

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
  } else if (command === "addstock") {
    await handleAddStock(message, "free");
  } else if (command === "addpremiumstock") {
    await handleAddStock(message, "premium");
  } else if (command === "addgodstock") {
    await handleAddStock(message, "god");
  } else if (command === "addagegroupaccounts") {
    await handleAddAgeGroupStock(message);
  } else if (command === "stock") {
    await handleStockCount(message);
  } else if (command === "premiumstock") {
    await handlePremiumStockCount(message);
  } else if (command === "godstock") {
    await handleGodStockCount(message);
  } else if (command === "agegroupstock") {
    await handleAgeGroupStockCount(message);
  } else if (command === "allstocks") {
    await handleAllStock(message);
  } else if (command === "showapipanel") {
    await handleShowApiPanel(message);
  } else if (command === "addapikeys") {
    await handleAddApiKeys(message, args.slice(1));
  } else if (command === "user") {
    await handleUser(message, args[1]);
  } else if (command === "accountdays") {
    await handleAccountDays(message, args[1]);
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

    if (id === "dm_yes") {
      const pending = pendingAccounts.get(userId);
      if (!pending) {
        await interaction.reply({ content: "❌ No pending account found — it may have expired.", ephemeral: true });
        return;
      }
      pendingAccounts.delete(userId);
      generateCooldowns.set(userId, Date.now());

      const { account } = pending;
      const tierLabel = pending.tier === "god" ? "🌟 God-Tier" : pending.tier === "premium" ? "⭐ Premium" : "🎮";
      const color = pending.tier === "god" ? 0x9b59b6 : pending.tier === "premium" ? 0xf5a623 : 0x00c851;

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

      await interaction.reply({
        embeds: [embed],
        content: `🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``,
        ephemeral: true,
      });
      await interaction.message.delete().catch(() => null);
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
        await deliverAccount(pending.account, pending.tier, pending.originalMessage);
      } else {
        if (pending.tier === "god") addGodAccount(pending.account);
        else if (pending.tier === "premium") addPremiumAccount(pending.account);
        else if (pending.tier === "agegroup") addAgeGroupAccount(pending.account);
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

function returnPendingToStock(pending: PendingAccount) {
  if (pending.tier === "god") addGodAccount(pending.account);
  else if (pending.tier === "premium") addPremiumAccount(pending.account);
  else if (pending.tier === "agegroup") addAgeGroupAccount(pending.account);
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
  tier: "free" | "premium" | "god"
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
  tier: "free" | "premium" | "god" | "agegroup",
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
    tier === "god" ? "🌟 Your God-Tier Roblox Account"
    : tier === "premium" ? "⭐ Your Premium Roblox Account"
    : tier === "agegroup" ? "🎂 Your Age Group Roblox Account"
    : "🎮 Your Roblox Account";
  const color =
    tier === "god" ? 0x9b59b6
    : tier === "premium" ? 0xf5a623
    : tier === "agegroup" ? 0x00bcd4
    : 0x00c851;
  const footer =
    tier === "god" ? "🌟 God-Tier Account — Login at roblox.com"
    : tier === "premium" ? "⭐ Premium Account — Login at roblox.com"
    : tier === "agegroup" ? "🎂 Age Group Account — Login at roblox.com"
    : "Login at roblox.com — keep these credentials safe!";
  const successEmoji = tier === "god" ? "🌟" : tier === "premium" ? "⭐" : tier === "agegroup" ? "🎂" : "✅";

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

  try {
    await message.author.send({ embeds: [dmEmbed] });
    await message.author.send(`🍪 **.ROBLOSECURITY Cookie:**\n\`\`\`${account.cookie}\`\`\``);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setDescription(
            `${successEmoji} Check your DMs, ${message.author}! Your account has been sent.\n⏳ You can generate again <t:${cdEnd}:R>`
          )
          .setTimestamp(),
      ],
    });
  } catch {
    pendingAccounts.set(message.author.id, { account, tier });
    await message.reply({ embeds: [dmOffEmbed()], components: [dmOffRow()] });
  }
}

function checkCooldown(userId: string): number | null {
  const last = generateCooldowns.get(userId);
  if (!last) return null;
  const remaining = GENERATE_COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : null;
}

async function handleGenerate(message: Message) {
  const remaining = checkCooldown(message.author.id);
  if (remaining !== null) {
    const mins = Math.floor(remaining / 60000);
    const secs = Math.ceil((remaining % 60000) / 1000);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("⏳ Cooldown Active")
          .setDescription(`You must wait **${mins}m ${secs}s** before generating again.`),
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
          .setDescription("There are no Roblox accounts in stock right now. Check back later!")
          .setTimestamp(),
      ],
    });
    return;
  }

  await sendCaptcha(message, account, "free");
}

async function handleAddStock(message: Message, tier: "free" | "premium" | "god") {
  if (message.author.id !== STOCK_ALLOWED_USER_ID) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setDescription("❌ You don't have permission to use this command."),
      ],
    });
    return;
  }

  if (message.channel.id !== STOCK_CHANNEL_ID) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setDescription("❌ This command can only be used in the designated stock channel."),
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
    } else {
      addAccount(account);
    }

    const count =
      tier === "god" ? godStockCount()
      : tier === "premium" ? premiumStockCount()
      : tier === "agegroup" ? ageGroupStockCount()
      : stockCount();
    const label =
      tier === "god" ? "✅ Account Added to God Stock"
      : tier === "premium" ? "✅ Account Added to Premium Stock"
      : tier === "agegroup" ? "✅ Account Added to Age Group Stock"
      : "✅ Account Added to Stock";
    const color =
      tier === "god" ? 0x9b59b6
      : tier === "premium" ? 0xf5a623
      : tier === "agegroup" ? 0x00bcd4
      : 0x00c851;
    const stockLabel =
      tier === "god" ? "🌟 God Stock"
      : tier === "premium" ? "⭐ Premium Stock"
      : tier === "agegroup" ? "🔵 Age Group Stock"
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
  const count = stockCount();
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe8192c)
        .setDescription(`📦 **Stock:** \`${count}\` account(s) available`),
    ],
  });
}

async function handlePremiumStockCount(message: Message) {
  const count = premiumStockCount();
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf5a623)
        .setDescription(`⭐ **Premium Stock:** \`${count}\` account(s) available`),
    ],
  });
}

async function handleGodStockCount(message: Message) {
  const count = godStockCount();
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x9b59b6)
        .setDescription(`🌟 **God Stock:** \`${count}\` account(s) available`),
    ],
  });
}

async function handleAllStock(message: Message) {
  const free = stockCount();
  const premium = premiumStockCount();
  const god = godStockCount();
  const ageGroup = ageGroupStockCount();
  const total = free + premium + god + ageGroup;
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📦 All Stock")
        .addFields(
          { name: "🟢 Free",       value: `\`${free}\` account(s)`,     inline: true },
          { name: "🟡 Premium",    value: `\`${premium}\` account(s)`,  inline: true },
          { name: "🟣 God",        value: `\`${god}\` account(s)`,      inline: true },
          { name: "🔵 Age Group",  value: `\`${ageGroup}\` account(s)`, inline: true },
        )
        .setFooter({ text: `Total: ${total} account(s)` })
        .setTimestamp(),
    ],
  });
}

async function handleAgeGroupStockCount(message: Message) {
  const count = ageGroupStockCount();
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00bcd4)
        .setDescription(`🔵 **Age Group Stock:** \`${count}\` account(s) available`),
    ],
  });
}

async function handleAddAgeGroupStock(message: Message) {
  if (message.author.id !== STOCK_ALLOWED_USER_ID) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setDescription("❌ You don't have permission to use this command."),
      ],
    });
    return;
  }
  if (message.channel.id !== STOCK_CHANNEL_ID) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setDescription("❌ This command can only be used in the designated stock channel."),
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
  const last = ageGroupCooldowns.get(message.author.id);
  if (last) {
    const remaining = AGE_GROUP_COOLDOWN_MS - (Date.now() - last);
    if (remaining > 0) {
      const mins = Math.floor(remaining / 60000);
      const secs = Math.ceil((remaining % 60000) / 1000);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle("⏳ Cooldown Active")
            .setDescription(`You must wait **${mins}m ${secs}s** before generating again.`),
        ],
      });
      return;
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

async function handleGenerateGod(message: Message) {
  const remaining = checkCooldown(message.author.id);
  if (remaining !== null) {
    const mins = Math.floor(remaining / 60000);
    const secs = Math.ceil((remaining % 60000) / 1000);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("⏳ Cooldown Active")
          .setDescription(`You must wait **${mins}m ${secs}s** before generating again.`),
      ],
    });
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
  const remaining = checkCooldown(message.author.id);
  if (remaining !== null) {
    const mins = Math.floor(remaining / 60000);
    const secs = Math.ceil((remaining % 60000) / 1000);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("⏳ Cooldown Active")
          .setDescription(`You must wait **${mins}m ${secs}s** before generating again.`),
      ],
    });
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
  if (message.author.id !== STOCK_ALLOWED_USER_ID) {
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
    const mins = Math.floor(remaining / 60000);
    const secs = Math.ceil((remaining % 60000) / 1000);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("⏳ Cooldown Active")
          .setDescription(`You must wait **${mins}m ${secs}s** before generating again.`),
      ],
    });
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

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${profile.displayName} (@${username})`)
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

async function handleHelpGenerate(message: Message) {
  const embed = new EmbedBuilder()
    .setTitle("j!generate — Help")
    .setColor(0xe8192c)
    .setDescription("Get a free Roblox account from the stock, delivered straight to your DMs.")
    .addFields(
      { name: "Usage", value: "`j!generate`" },
      {
        name: "What you get (via DM)",
        value:
          "• **Username** — The Roblox username\n" +
          "• **Password** — The account password\n" +
          "• **Security Cookie** — The `.ROBLOSECURITY` cookie for instant login",
      },
      {
        name: "Note",
        value: "Make sure your DMs are open from server members or the bot can't reach you.",
      }
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

async function handleHelp(message: Message) {
  const embed = new EmbedBuilder()
    .setTitle("Jelly Bot — Help")
    .setColor(0xe8192c)
    .addFields(
      { name: "`j!generate`", value: "Get a free Roblox account sent to your DMs. *(9m cooldown)*" },
      { name: "`j!stock`", value: "Check how many free accounts are in stock." },
      { name: "`j!generatepremium`", value: "⭐ Get a premium account (requires Premium role). *(9m cooldown)*" },
      { name: "`j!premiumstock`", value: "⭐ Check how many premium accounts are in stock." },
      { name: "`j!generategod`", value: "🌟 Get a God-tier account (requires God role). *(9m cooldown)*" },
      { name: "`j!godstock`", value: "🌟 Check how many God-tier accounts are in stock." },
      { name: "`j!generatealt`", value: "🔑 Deliver an account to your configured webhook (requires API key)." },
      { name: "`j!showapipanel`", value: "🛠️ Open the API panel — redeem key, reset HWID, set webhook." },
      { name: "`j!addstock`", value: "Add an account to free stock (restricted)." },
      { name: "`j!addpremiumstock`", value: "⭐ Add an account to premium stock (restricted)." },
      { name: "`j!addgodstock`", value: "🌟 Add an account to God stock (restricted)." },
      { name: "`j!addapikeys <key...>`", value: "🔑 Add API keys to the pool (restricted)." },
      { name: "`j!user <username>`", value: "Look up a Roblox user's full profile." },
      { name: "`j!accountdays <username>`", value: "Check how old a Roblox account is." },
      { name: "`j!help`", value: "Show this help message." },
    )
    .setFooter({ text: "Prefix: j!" })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is not set.");
  process.exit(1);
}

client.login(token);
