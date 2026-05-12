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

const guildSettings = new Map();

const getSettings = (guildId) => {
    if (!guildSettings.has(guildId)) {
        guildSettings.set(guildId, {
            masterSwitch: false,
            linksEnabled: true,
            linkTimeout: 30,
            imagesEnabled: true,
            maxImages: 4,
            imageTimeout: 4320,
            logChannelId: null
        });
    }
    return guildSettings.get(guildId);
};

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

    const settings = getSettings(interaction.guildId);

    if (interaction.commandName === 'startprotecting') {
        settings.masterSwitch = true;
        await interaction.reply('✅ Master Protection system is now **ENABLED**.');
    }

    if (interaction.commandName === 'stopprotecting') {
        settings.masterSwitch = false;
        await interaction.reply('⚠️ Master Protection system is now **DISABLED**.');
    }

    if (interaction.commandName === 'settings') {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'links') {
            settings.linksEnabled = interaction.options.getBoolean('enabled');
            const timeout = interaction.options.getInteger('timeout');
            if (timeout) settings.linkTimeout = timeout;
            
            await interaction.reply({ content: `✅ Link Protection updated!\n**Enabled:** ${settings.linksEnabled}\n**Timeout:** ${settings.linkTimeout} minutes`, ephemeral: true });
        }

        if (subcommand === 'images') {
            settings.imagesEnabled = interaction.options.getBoolean('enabled');
            const max = interaction.options.getInteger('max_amount');
            const timeout = interaction.options.getInteger('timeout');
            if (max) settings.maxImages = max;
            if (timeout) settings.imageTimeout = timeout;
            
            await interaction.reply({ content: `✅ Image Protection updated!\n**Enabled:** ${settings.imagesEnabled}\n**Max Images:** ${settings.maxImages}\n**Timeout:** ${settings.imageTimeout} minutes`, ephemeral: true });
        }

        if (subcommand === 'logs') {
            const channel = interaction.options.getChannel('channel');
            settings.logChannelId = channel.id;
            
            await interaction.reply({ content: `✅ Log channel successfully set to <#${channel.id}>`, ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || message.webhookId) return;
    if (!message.guild) return;

    const settings = getSettings(message.guild.id);
    if (!settings.masterSwitch) return;

    const member = message.member;

    let targetLogChannel = message.channel;
    if (settings.logChannelId) {
        const configuredChannel = message.guild.channels.cache.get(settings.logChannelId);
        if (configuredChannel) targetLogChannel = configuredChannel;
    }

    if (settings.linksEnabled && inviteRegex.test(message.content)) {
        try {
            await message.delete();
            const msTimeout = settings.linkTimeout * 60 * 1000;
            await member.timeout(msTimeout, 'Spamming Discord Invite Links');
            
            const logEmbed = createLogEmbed(
                '🛡️ Invite Spam Detected',
                `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted & timed out for ${settings.linkTimeout} minutes.`,
                '#ffcc00'
            );
            await targetLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
        } catch (error) {
            console.error(error);
        }
    }

    if (settings.imagesEnabled && message.attachments.size >= settings.maxImages) {
        try {
            await message.delete();
            const msTimeout = settings.imageTimeout * 60 * 1000;
            await member.timeout(msTimeout, 'Compromised/Hacked account detected');
            
            const ownerId = message.guild.ownerId; 
            
            await message.author.send(`⚠️ Your account has been temporarily timed out in **${message.guild.name}** for ${settings.imageTimeout} minutes because it appears to be compromised. Please secure your account immediately and contact <@${ownerId}> once you have control to be untimed.`).catch(() => {});
            
            const logEmbed = createLogEmbed(
                '🚨 Hacked Account Detected',
                `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted, timed out for ${settings.imageTimeout} minutes, and sent a DM warning.`,
                '#ff0000'
            );
            await targetLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
        } catch (error) {
            console.error(error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
