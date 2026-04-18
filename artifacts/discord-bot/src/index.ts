import { Client, GatewayIntentBits, Message, EmbedBuilder } from "discord.js";
import { generateRobloxAccount } from "./generator.js";

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
  const loading = await message.reply("Generating your Roblox account...");

  try {
    const account = generateRobloxAccount();

    const embed = new EmbedBuilder()
      .setTitle("Roblox Account Generated")
      .setColor(0xe8192c)
      .setThumbnail("https://i.imgur.com/Rnmzm4z.png")
      .addFields(
        { name: "Username", value: `\`${account.username}\``, inline: true },
        { name: "Password", value: `\`${account.password}\``, inline: true },
        { name: "Email", value: `\`${account.email}\``, inline: true },
        { name: "Display Name", value: `\`${account.displayName}\``, inline: true },
        { name: "Date of Birth", value: `\`${account.dateOfBirth}\``, inline: true },
        { name: "Gender", value: `\`${account.gender}\``, inline: true },
        { name: "Country", value: `\`${account.country}\``, inline: true },
        { name: "PIN", value: `\`${account.pin}\``, inline: true },
        { name: "Recovery Phrase", value: `\`${account.recoveryPhrase}\`` },
      )
      .setFooter({
        text: "Use these credentials to register at roblox.com/account/signupredir",
      })
      .setTimestamp();

    await loading.delete();
    await message.reply({ embeds: [embed] });
  } catch (err) {
    await loading.edit("An error occurred while generating the account.");
    console.error(err);
  }
}

async function handleHelpGenerate(message: Message) {
  const embed = new EmbedBuilder()
    .setTitle("j!generate — Help")
    .setColor(0xe8192c)
    .setDescription(
      "Generates a random Roblox account with all the information you need to register."
    )
    .addFields(
      { name: "Usage", value: "`j!generate`" },
      {
        name: "What you get",
        value:
          "• **Username** — A valid Roblox-style username\n" +
          "• **Password** — A strong random password\n" +
          "• **Email** — A random email address\n" +
          "• **Display Name** — A random display name\n" +
          "• **Date of Birth** — A random date of birth (18+)\n" +
          "• **Gender** — Male or Female\n" +
          "• **Country** — Random country\n" +
          "• **PIN** — A 4-digit account PIN\n" +
          "• **Recovery Phrase** — A 12-word recovery phrase",
      },
      {
        name: "How to use",
        value:
          "1. Run `j!generate`\n" +
          "2. Go to [roblox.com/account/signupredir](https://www.roblox.com/account/signupredir)\n" +
          "3. Enter the username, password, date of birth, and gender shown\n" +
          "4. Complete sign-up and save your credentials!",
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
        value: "Generate a random Roblox account with all credentials.",
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
