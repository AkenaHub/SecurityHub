const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

let protectionEnabled = false;

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discord\.com\/invite\/.+)/i;

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();
};

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'startprotecting') {
        if (protectionEnabled) {
            return interaction.reply({ content: 'Protection is already active.', ephemeral: true });
        }
        protectionEnabled = true;
        await interaction.reply('✅ Protection system is now **ENABLED**.');
    }

    if (interaction.commandName === 'stopprotecting') {
        if (!protectionEnabled) {
            return interaction.reply({ content: 'Protection is already inactive.', ephemeral: true });
        }
        protectionEnabled = false;
        await interaction.reply('⚠️ Protection system is now **DISABLED**.');
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || message.webhookId) return;
    if (!message.guild) return;
    if (!protectionEnabled) return;

    const member = message.member;

    // --- Invite Spam Protection ---
    if (inviteRegex.test(message.content)) {
        try {
            await message.delete();
            await member.timeout(1800000, 'Spamming Discord Invite Links');
            
            const logEmbed = createLogEmbed(
                '🛡️ Invite Spam Detected',
                `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted & timed out for 30 minutes.`,
                '#ffcc00'
            );
            await message.channel.send({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
        }
    }

    // --- Hacked Account Protection ---
    if (message.attachments.size >= 4) {
        try {
            await message.delete();
            await member.timeout(259200000, 'Compromised/Hacked account detected');
            
            // 🔥 THIS IS THE MAGIC NEW LINE 🔥
            // It automatically gets the Discord ID of whoever owns the server the message was sent in!
            const ownerId = message.guild.ownerId; 
            
            await message.author.send(`⚠️ Your account has been temporarily timed out in **${message.guild.name}** for 3 days because it appears to be compromised (sending suspicious image groups). Please secure your account immediately and contact <@${ownerId}> once you have control to be untimed.`).catch(() => {});
            
            const logEmbed = createLogEmbed(
                '🚨 Hacked Account Detected',
                `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted, timed out for 3 days, and sent a DM warning.`,
                '#ff0000'
            );
            await message.channel.send({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
        }
    }
});

// Using the safe Railway Variable method!
client.login(process.env.DISCORD_TOKEN);
