import { Client, GatewayIntentBits, Message, EmbedBuilder } from "discord.js";
import { createRobloxAccount } from "./generator.js";

const PREFIX = "j!";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("clientReady", (c) => {
  console.log(`Bot is online as ${c.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();
  const subcommand = args[1]?.toLowerCase();

  if (command === "generate") {
    await handleGenerate(message);
  } else if (command === "help") {
    if (subcommand === "generate") {
      await handleHelpGenerate(message);
    } else {
      await handleHelp(message);
    }
  }
});

async function handleGenerate(message: Message) {
  const loading = await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe8192c)
        .setDescription("⏳ Creating your Roblox account... Please wait."),
    ],
  });

  try {
    const account = await createRobloxAccount();

    const profileUrl = `https://www.roblox.com/users/${account.userId}/profile`;

    const embed = new EmbedBuilder()
      .setTitle("✅ Roblox Account Created!")
      .setColor(0x00c851)
      .setURL(profileUrl)
      .setThumbnail("https://i.imgur.com/Rnmzm4z.png")
      .addFields(
        { name: "👤 Username", value: `\`${account.username}\``, inline: true },
        { name: "🔑 Password", value: `\`${account.password}\``, inline: true },
        { name: "🎂 Birthday", value: `\`${account.birthday}\``, inline: true },
        { name: "🚻 Gender", value: `\`${account.gender}\``, inline: true },
        { name: "🆔 User ID", value: `\`${account.userId}\``, inline: true },
        { name: "🔗 Profile", value: `[Click here](${profileUrl})`, inline: true },
      )
      .setFooter({ text: "Login at roblox.com with the credentials above" })
      .setTimestamp();

    await loading.edit({ embeds: [embed] });
  } catch (err: any) {
    console.error("Account creation error:", err?.response?.data ?? err?.message ?? err);

    const errData = err?.response?.data;
    let reason = "Unknown error";

    if (errData?.errors?.length) {
      reason = errData.errors.map((e: any) => e.message ?? e.code).join(", ");
    } else if (err?.message) {
      reason = err.message;
    }

    const errEmbed = new EmbedBuilder()
      .setTitle("❌ Account Creation Failed")
      .setColor(0xff4444)
      .setDescription(`**Reason:** ${reason}\n\nRoblox may be rate limiting or blocking signups. Try again in a moment.`)
      .setTimestamp();

    await loading.edit({ embeds: [errEmbed] });
  }
}

async function handleHelpGenerate(message: Message) {
  const embed = new EmbedBuilder()
    .setTitle("j!generate — Help")
    .setColor(0xe8192c)
    .setDescription(
      "Creates a **real** Roblox account and gives you the login credentials instantly."
    )
    .addFields(
      { name: "Usage", value: "`j!generate`" },
      {
        name: "What you get",
        value:
          "• **Username** — The Roblox username\n" +
          "• **Password** — The account password\n" +
          "• **Birthday** — Date of birth used for signup\n" +
          "• **Gender** — Chosen gender\n" +
          "• **User ID** — The actual Roblox user ID\n" +
          "• **Profile Link** — Direct link to the Roblox profile",
      },
      {
        name: "Notes",
        value:
          "• The account is created **for real** on Roblox — you can log in immediately\n" +
          "• Save the credentials right away as they won't be shown again\n" +
          "• Roblox may rate limit if you generate too many accounts quickly",
      }
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

async function handleHelp(message: Message) {
  const embed = new EmbedBuilder()
    .setTitle("Jelly Bot — Help")
    .setColor(0xe8192c)
    .setDescription("Here are all available commands:")
    .addFields(
      {
        name: "`j!generate`",
        value: "Create a real Roblox account and get the login credentials.",
      },
      {
        name: "`j!help generate`",
        value: "Show detailed help for the generate command.",
      },
      {
        name: "`j!help`",
        value: "Show this help message.",
      }
    )
    .setFooter({ text: "Prefix: j!" })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

client.login(token);
