import {
  Client,
  GatewayIntentBits,
  Message,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { addAccount, popAccount, stockCount } from "./stock.js";

const PREFIX = "j!";
const STOCK_CHANNEL_ID = "1495195376590786720";

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
    const dmEmbed = new EmbedBuilder()
      .setTitle("🎮 Your Roblox Account")
      .setColor(0x00c851)
      .setThumbnail("https://i.imgur.com/Rnmzm4z.png")
      .addFields(
        { name: "👤 Username", value: `\`${account.username}\`` },
        { name: "🔑 Password", value: `\`${account.password}\`` },
        {
          name: "🍪 Security Cookie (.ROBLOSECURITY)",
          value: `\`\`\`${account.cookie}\`\`\``,
        },
      )
      .setFooter({ text: "Login at roblox.com — keep these credentials safe!" })
      .setTimestamp();

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
