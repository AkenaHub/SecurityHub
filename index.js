const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize the bot client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, // Required to timeout members
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// CRUCIAL: Storing state in-memory will NOT persist on Railway restarts.
// For a production bot, you must use a database (like Redis) here.
let protectionEnabled = false;

// Regex to detect common discord invite links
const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discord\.com\/invite\/.+)/i;

// --- Helper Functions ---

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();
};

// --- Bot Events ---

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Protection Status:', protectionEnabled ? 'ENABLED' : 'DISABLED (Run /startprotecting)');
});

// Handle Slash Commands (/startprotecting, /stopprotecting)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'startprotecting') {
        if (protectionEnabled) {
            return interaction.reply({ content: 'Protection is already active.', ephemeral: true });
        }
        protectionEnabled = true;
        await interaction.reply('✅ Protection system is now **ENABLED**. Invite spam and hacked account detection are active.');
        console.log('Protection status changed: ENABLED');
    }

    if (interaction.commandName === 'stopprotecting') {
        if (!protectionEnabled) {
            return interaction.reply({ content: 'Protection is already inactive.', ephemeral: true });
        }
        protectionEnabled = false;
        await interaction.reply('⚠️ Protection system is now **DISABLED**.');
        console.log('Protection status changed: DISABLED');
    }
});

// Handle incoming messages (The Core Protection Logic)
client.on('messageCreate', async message => {
    // Ignore bots and webhooks
    if (message.author.bot || message.webhookId) return;

    // Ignore messages outside of guilds (DMs)
    if (!message.guild) return;

    // If protection is disabled, do nothing
    if (!protectionEnabled) return;

    const member = message.member;

    // Optional: Ignore staff members who have Manage Messages permission
    // if (member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

    // --- FEATURE 1: Invite Link Protection ---
    if (inviteRegex.test(message.content)) {
        try {
            // 1. Delete the link
            await message.delete();

            // 2. Timeout the user for 30 minutes
            // Duration is in milliseconds: 30 mins * 60 secs * 1000 ms
            const timeoutDuration = 30 * 60 * 1000;
            await member.timeout(timeoutDuration, 'Spamming Discord Invite Links');

            // 3. Log to the channel
            const logEmbed = createLogEmbed(
                '🛡️ Invite Spam Detected',
                `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted & timed out for 30 minutes.`,
                '#ffcc00' // Yellow/Orange
            );
            await message.channel.send({ embeds: [logEmbed] });

        } catch (error) {
            console.error('Error handling invite spam:', error);
            // Often bots lack permissions to timeout specific users (e.g., those above them in hierarchy)
        }
    }

    // --- FEATURE 2: "Hacked Account" (Image Burst) Detection ---
    // You described "images like 4 in a group of 1". The best way a bot can detect
    // this without complex AI is by checking the number of attachments (images/files)
    // present in a single message.

    if (message.attachments.size >= 4) {
        try {
            // 1. Delete the message immediately
            await message.delete();

            // 2. Timeout the user for 3 days
            // Duration: 3 days * 24 hours * 60 mins * 60 secs * 1000 ms
            const hackedTimeoutDuration = 3 * 24 * 60 * 60 * 1000;
            await member.timeout(hackedTimeoutDuration, 'Compromised/Hacked account detected');

            // 3. DM the User (MUST use .catch() in case their DMs are closed)
            const ownerId = process.env.SERVER_OWNER_ID || 'the server owner';
            await message.author.send(`⚠️ Your account has been temporarily timed out in **${message.guild.name}** for 3 days because it appears to be compromised (sending suspicious image groups). Please secure your account immediately and contact <@${ownerId}> once you have control to be untimed.`)
                .catch(err => console.log(`Could not DM user ${message.author.tag} (DMs closed).`));

            // 4. Log to the channel
            const logEmbed = createLogEmbed(
                '🚨 Hacked Account Detected',
                `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted, timed out for 3 days, and sent a DM warning.`,
                '#ff0000' // Red
            );
            await message.channel.send({ embeds: [logEmbed] });

        } catch (error) {
            console.error('Error handling hacked account detection:', error);
        }
    }
});

// Login using the token from Railway Variables
client.login(process.env.DISCORD_TOKEN);
