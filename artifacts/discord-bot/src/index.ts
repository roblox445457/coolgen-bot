import {
  Client,
  GatewayIntentBits,
  Message,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import axios from "axios";
import { addAccount, popAccount, stockCount } from "./stock.js";

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
  username?: string;
  password?: string;
}
const sessions = new Map<string, Session>();

client.once("clientReady", (c) => {
  console.log(`Bot is online as ${c.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;

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
  } else if (command === "addstock") {
    await handleAddStock(message);
  } else if (command === "stock") {
    await handleStockCount(message);
  } else if (command === "help") {
    if (subcommand === "generate") {
      await handleHelpGenerate(message);
    } else {
      await handleHelp(message);
    }
  }
});

async function handleGenerate(message: Message) {
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

    const successEmbed = new EmbedBuilder()
      .setColor(0x00c851)
      .setDescription(`✅ Check your DMs, ${message.author}! Your account has been sent.`)
      .setTimestamp();
    await message.reply({ embeds: [successEmbed] });
  } catch {
    // DMs are closed — put the account back? No, just warn them.
    const failEmbed = new EmbedBuilder()
      .setTitle("❌ Could Not DM You")
      .setColor(0xff4444)
      .setDescription(
        "I couldn't send you a DM. Please enable DMs from server members and try again.\n\n**Your account was not wasted** — please try `j!generate` again."
      )
      .setTimestamp();
    // Put account back since we couldn't deliver it
    addAccount(account);
    await message.reply({ embeds: [failEmbed] });
  }
}

async function handleAddStock(message: Message) {
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
  sessions.set(message.author.id, { step: "username" });

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe8192c)
        .setTitle("➕ Add Stock")
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
    sessions.delete(message.author.id);

    addAccount({
      username: session.username!,
      password: session.password!,
      cookie,
    });

    const count = stockCount();
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c851)
          .setTitle("✅ Account Added to Stock")
          .addFields(
            { name: "👤 Username", value: `\`${session.username}\``, inline: true },
            { name: "🔑 Password", value: `\`${session.password}\``, inline: true },
            { name: "📦 Total Stock", value: `\`${count} account(s)\``, inline: true },
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
      { name: "`j!generate`", value: "Get a free Roblox account sent to your DMs." },
      { name: "`j!stock`", value: "Check how many accounts are currently in stock." },
      { name: "`j!addstock`", value: "Add an account to stock (restricted channel only)." },
      { name: "`j!help generate`", value: "Detailed help for the generate command." },
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
