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
  addAccount, popAccount, stockCount,
  addPremiumAccount, popPremiumAccount, premiumStockCount,
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
  isPremium: boolean;
  username?: string;
  password?: string;
}
const sessions = new Map<string, Session>();

// 9-minute cooldown for generate commands (per user)
const GENERATE_COOLDOWN_MS = 9 * 60 * 1000;
const generateCooldowns = new Map<string, number>();

client.once("clientReady", (c) => {
  console.log(`Bot is online as ${c.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
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
  } else if (command === "generatealt") {
    await handleGenerateAlt(message);
  } else if (command === "addstock") {
    await handleAddStock(message, false);
  } else if (command === "addpremiumstock") {
    await handleAddStock(message, true);
  } else if (command === "stock") {
    await handleStockCount(message);
  } else if (command === "premiumstock") {
    await handlePremiumStockCount(message);
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

    if (id === "api_redeem") {
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
    const emptyEmbed = new EmbedBuilder()
      .setTitle("❌ Out of Stock")
      .setColor(0xff4444)
      .setDescription("There are no Roblox accounts in stock right now. Check back later!")
      .setTimestamp();
    await message.reply({ embeds: [emptyEmbed] });
    return;
  }

  // Try to DM the user
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

    const dmEmbed = new EmbedBuilder()
      .setTitle("🎮 Your Roblox Account")
      .setColor(0x00c851)
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
        {
          name: "🍪 Security Cookie (.ROBLOSECURITY)",
          value: `\`\`\`${account.cookie}\`\`\``,
        },
      )
      .setFooter({ text: "Login at roblox.com — keep these credentials safe!" })
      .setTimestamp();

    if (profile?.avatarUrl) dmEmbed.setThumbnail(profile.avatarUrl);
    if (profileUrl) dmEmbed.setURL(profileUrl);

    await message.author.send({ embeds: [dmEmbed] });
    generateCooldowns.set(message.author.id, Date.now());

    const successEmbed = new EmbedBuilder()
      .setColor(0x00c851)
      .setDescription(`✅ Check your DMs, ${message.author}! Your account has been sent.`)
      .setTimestamp();
    await message.reply({ embeds: [successEmbed] });
  } catch {
    const failEmbed = new EmbedBuilder()
      .setTitle("❌ Could Not DM You")
      .setColor(0xff4444)
      .setDescription(
        "I couldn't send you a DM. Please enable DMs from server members and try again.\n\n**Your account was not wasted** — please try `j!generate` again."
      )
      .setTimestamp();
    addAccount(account);
    await message.reply({ embeds: [failEmbed] });
  }
}

async function handleAddStock(message: Message, isPremium: boolean) {
  // Restrict to allowed user only
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

  // Restrict to the stock channel
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

  // Start a session for this user
  sessions.set(message.author.id, { step: "username", isPremium });

  const label = isPremium ? "⭐ Add Premium Stock" : "➕ Add Stock";
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(isPremium ? 0xf5a623 : 0xe8192c)
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
    const isPremium = session.isPremium;
    sessions.delete(message.author.id);

    const account = { username: session.username!, password: session.password!, cookie };
    if (isPremium) {
      addPremiumAccount(account);
    } else {
      addAccount(account);
    }

    const count = isPremium ? premiumStockCount() : stockCount();
    const label = isPremium ? "✅ Account Added to Premium Stock" : "✅ Account Added to Stock";
    const color = isPremium ? 0xf5a623 : 0x00c851;
    const stockLabel = isPremium ? "⭐ Premium Stock" : "📦 Total Stock";

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

  // Check for Premium role
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  const hasPremium = member?.roles.cache.has(PREMIUM_ROLE_ID) ?? false;

  if (!hasPremium) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("⭐ Premium Required")
          .setColor(0xf5a623)
          .setDescription(
            "You need the **Premium** role to use this command.\n\nUpgrade to Premium to access premium Roblox accounts!"
          ),
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

    const dmEmbed = new EmbedBuilder()
      .setTitle("⭐ Your Premium Roblox Account")
      .setColor(0xf5a623)
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
        {
          name: "🍪 Security Cookie (.ROBLOSECURITY)",
          value: `\`\`\`${account.cookie}\`\`\``,
        },
      )
      .setFooter({ text: "⭐ Premium Account — Login at roblox.com" })
      .setTimestamp();

    if (profile?.avatarUrl) dmEmbed.setThumbnail(profile.avatarUrl);
    if (profileUrl) dmEmbed.setURL(profileUrl);

    await message.author.send({ embeds: [dmEmbed] });
    generateCooldowns.set(message.author.id, Date.now());

    const successEmbed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setDescription(`⭐ Check your DMs, ${message.author}! Your premium account has been sent.`)
      .setTimestamp();
    await message.reply({ embeds: [successEmbed] });
  } catch {
    addPremiumAccount(account);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ Could Not DM You")
          .setColor(0xff4444)
          .setDescription(
            "I couldn't send you a DM. Please enable DMs from server members and try again.\n\n**Your account was not wasted** — please try `j!generatepremium` again."
          ),
      ],
    });
  }
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
  const data = getApiData(message.author.id);

  if (!data) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("❌ No API Key")
          .setDescription("You need to redeem an API key first. Use `j!showapipanel` to get started."),
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
          .setDescription("You have an API key but no webhook configured. Use `j!showapipanel` → **Set Webhook**."),
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
            "Couldn't send to your webhook. Make sure the URL is valid and the webhook still exists.\n\n**Account was not wasted** — try again."
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
      { name: "`j!generatealt`", value: "🔑 Deliver an account to your configured webhook (requires API key)." },
      { name: "`j!showapipanel`", value: "🛠️ Open the API panel — redeem key, reset HWID, set webhook." },
      { name: "`j!addstock`", value: "Add an account to free stock (restricted)." },
      { name: "`j!addpremiumstock`", value: "⭐ Add an account to premium stock (restricted)." },
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
