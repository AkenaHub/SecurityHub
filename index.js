const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelSelectMenuBuilder, ChannelType, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');

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

const parseDuration = (input) => {
    const val = input.toLowerCase().trim();
    const num = parseInt(val);
    if (isNaN(num)) return null;
    if (val.endsWith('d')) return num * 1440;
    return num; 
};

const formatDuration = (mins) => {
    if (mins >= 1440 && mins % 1440 === 0) return `${mins / 1440} Days`;
    return `${mins} Minutes`;
};

const toShortFormat = (mins) => {
    if (mins >= 1440 && mins % 1440 === 0) return `${mins / 1440}d`;
    return `${mins}m`;
};

const generateDashboard = (guildId) => {
    const settings = getSettings(guildId);
    
    const embed = new EmbedBuilder()
        .setTitle('🛡️ Master Security Setup Panel')
        .setColor(settings.masterSwitch ? '#00ff00' : '#ff0000')
        .setDescription('Welcome to the control center. Configure your server\'s automated protection below.')
        .addFields(
            { name: '🤖 Bot Status', value: settings.masterSwitch ? '✅ **ONLINE AND PROTECTING**' : '❌ **OFFLINE (Sleeping)**', inline: false },
            { name: '🔗 Invite Link Shield', value: `**Status:** ${settings.linksEnabled ? '✅ Enabled' : '❌ Disabled'}\n**Timeout:** ${formatDuration(settings.linkTimeout)}`, inline: true },
            { name: '🖼️ Image Spam Shield', value: `**Status:** ${settings.imagesEnabled ? '✅ Enabled' : '❌ Disabled'}\n**Limit:** ${settings.maxImages} Images\n**Timeout:** ${formatDuration(settings.imageTimeout)}`, inline: true },
            { name: '📝 Action Log Channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : '*Currently logging in the channel where the spam happens.*', inline: false }
        )
        .setFooter({ text: 'Only server administrators can view and interact with this panel.' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_master').setLabel(settings.masterSwitch ? 'TURN BOT OFF' : 'TURN BOT ON').setStyle(settings.masterSwitch ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('toggle_links').setLabel(settings.linksEnabled ? 'Disable Links' : 'Enable Links').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('toggle_images').setLabel(settings.imagesEnabled ? 'Disable Images' : 'Enable Images').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('edit_links').setLabel('Edit Link Timeout').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_images').setLabel('Edit Image Limits').setStyle(ButtonStyle.Primary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Choose where to send the action logs...').addChannelTypes(ChannelType.GuildText)
    );

    return { embeds: [embed], components: [row1, row2, row3], ephemeral: true };
};

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discord\.com\/invite\/.+)/i;

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
};

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup') {
            await interaction.reply(generateDashboard(interaction.guildId));
        }
    }

    if (interaction.isButton()) {
        const settings = getSettings(interaction.guildId);

        if (interaction.customId === 'toggle_master') {
            settings.masterSwitch = !settings.masterSwitch;
            await interaction.update(generateDashboard(interaction.guildId));
        }

        if (interaction.customId === 'toggle_links') {
            settings.linksEnabled = !settings.linksEnabled;
            await interaction.update(generateDashboard(interaction.guildId));
        }

        if (interaction.customId === 'toggle_images') {
            settings.imagesEnabled = !settings.imagesEnabled;
            await interaction.update(generateDashboard(interaction.guildId));
        }

        if (interaction.customId === 'edit_links') {
            const modal = new ModalBuilder().setCustomId('modal_links').setTitle('Link Shield Setup');
            const input = new TextInputBuilder()
                .setCustomId('input_link_timeout')
                .setLabel('Timeout Duration (e.g. 30m, 3d)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(toShortFormat(settings.linkTimeout));
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'edit_images') {
            const modal = new ModalBuilder().setCustomId('modal_images').setTitle('Image Shield Setup');
            const inputMax = new TextInputBuilder()
                .setCustomId('input_image_max')
                .setLabel('Max images allowed per message')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(settings.maxImages.toString());
            const inputTimeout = new TextInputBuilder()
                .setCustomId('input_image_timeout')
                .setLabel('Timeout Duration (e.g. 60m, 7d)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(toShortFormat(settings.imageTimeout));
            modal.addComponents(new ActionRowBuilder().addComponents(inputMax), new ActionRowBuilder().addComponents(inputTimeout));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        const settings = getSettings(interaction.guildId);

        if (interaction.customId === 'modal_links') {
            const parsed = parseDuration(interaction.fields.getTextInputValue('input_link_timeout'));
            if (parsed) settings.linkTimeout = parsed;
            await interaction.update(generateDashboard(interaction.guildId));
        }

        if (interaction.customId === 'modal_images') {
            const max = parseInt(interaction.fields.getTextInputValue('input_image_max'));
            const parsedTimeout = parseDuration(interaction.fields.getTextInputValue('input_image_timeout'));
            if (!isNaN(max) && max > 0) settings.maxImages = max;
            if (parsedTimeout) settings.imageTimeout = parsedTimeout;
            await interaction.update(generateDashboard(interaction.guildId));
        }
    }

    if (interaction.isChannelSelectMenu() && interaction.customId === 'select_log') {
        const settings = getSettings(interaction.guildId);
        settings.logChannelId = interaction.values;
        await interaction.update(generateDashboard(interaction.guildId));
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
        try {
            const configuredChannel = await message.guild.channels.fetch(settings.logChannelId);
            if (configuredChannel) targetLogChannel = configuredChannel;
        } catch (error) {
            console.error('Could not fetch the designated log channel. Falling back to the current channel.');
        }
    }

    if (settings.linksEnabled && inviteRegex.test(message.content)) {
        try {
            await message.delete();
            await member.timeout(settings.linkTimeout * 60000, 'Spamming Discord Invite Links');
            const logEmbed = createLogEmbed('🛡️ Invite Spam Detected', `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted & timed out for ${formatDuration(settings.linkTimeout)}.`, '#ffcc00');
            await targetLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
        } catch (error) {
            console.error(error);
        }
    }

    if (settings.imagesEnabled && message.attachments.size >= settings.maxImages) {
        try {
            await message.delete();
            await member.timeout(settings.imageTimeout * 60000, 'Compromised/Hacked account detected');
            await message.author.send(`⚠️ Your account has been temporarily timed out in **${message.guild.name}** for ${formatDuration(settings.imageTimeout)} because it appears to be compromised. Please secure your account immediately and contact <@${message.guild.ownerId}> once you have control.`).catch(() => {});
            const logEmbed = createLogEmbed('🚨 Hacked Account Detected', `**User:** ${message.author.tag} (<@${message.author.id}>)\n**Action:** Message deleted, timed out for ${formatDuration(settings.imageTimeout)}, and sent a DM.`, '#ff0000');
            await targetLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
        } catch (error) {
            console.error(error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
