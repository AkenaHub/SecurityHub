const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelSelectMenuBuilder, ChannelType, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// 💾 DATABASE SYSTEM
const dbFile = './database.json';
let guildSettings = {};

// Load existing database if it exists
if (fs.existsSync(dbFile)) {
    try {
        guildSettings = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch (e) {
        console.error("Failed to load database. Starting fresh.");
    }
}

// Function to save to hard drive
const saveDatabase = () => {
    fs.writeFileSync(dbFile, JSON.stringify(guildSettings, null, 4));
};

const getSettings = (guildId) => {
    if (!guildSettings[guildId]) {
        guildSettings[guildId] = {
            masterSwitch: false,
            linksEnabled: true,
            linkTimeout: 30,
            imagesEnabled: true,
            maxImages: 1,
            imageTimeout: 4320,
            raidEnabled: true,
            logDeletedEnabled: false, // New Setting!
            logChannelId: null
        };
        saveDatabase(); // Save defaults immediately
    }
    return guildSettings[guildId];
};

// Update setting helper
const updateSetting = (guildId, key, value) => {
    const settings = getSettings(guildId);
    settings[key] = value;
    saveDatabase(); // Save to file immediately
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

// 🎨 MULTI-PAGE DASHBOARD DESIGN
const generateDashboard = (guildId, page = 1) => {
    const settings = getSettings(guildId);
    
    const statusColor = settings.masterSwitch ? '#58b9ff' : '#2b2d31';
    const statusEmoji = settings.masterSwitch ? '🟢' : '🔴';
    const statusText = settings.masterSwitch ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE';

    if (page === 1) {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Security Control Center (Page 1/2)')
            .setColor(statusColor)
            .setDescription(`**Master Status:** ${statusEmoji} \`${statusText}\`\nUse the modules below to configure your active defenses.`)
            .addFields(
                { name: '🔗 Invite Link Shield', value: `> **State:** ${settings.linksEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Timeout:** \`${formatDuration(settings.linkTimeout)}\``, inline: true },
                { name: '🖼️ Image Spam Shield', value: `> **State:** ${settings.imagesEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Limit:** \`${settings.maxImages} Image(s)\`\n> **Timeout:** \`${formatDuration(settings.imageTimeout)}\``, inline: true },
                { name: '⚔️ Raid App Shield', value: `> **State:** ${settings.raidEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Action:** \`Auto-Delete & 24h Timeout\``, inline: false }
            )
            .setFooter({ text: 'Settings automatically save to the database.' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_master').setLabel(settings.masterSwitch ? 'SHUTDOWN' : 'BOOT UP').setStyle(settings.masterSwitch ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji('🔌')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_links').setLabel('Link Shield').setStyle(settings.linksEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🔗'),
            new ButtonBuilder().setCustomId('toggle_images').setLabel('Image Shield').setStyle(settings.imagesEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🖼️'),
            new ButtonBuilder().setCustomId('toggle_raid').setLabel('Raid Shield').setStyle(settings.raidEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('⚔️')
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('nav_page2').setLabel('Log Settings & Config ➡️').setStyle(ButtonStyle.Primary)
        );

        return { embeds: [embed], components: [row1, row2, row3], ephemeral: true };
    } 
    
    if (page === 2) {
        const embed = new EmbedBuilder()
            .setTitle('📝 Log & Configuration Panel (Page 2/2)')
            .setColor(statusColor)
            .setDescription(`**Master Status:** ${statusEmoji} \`${statusText}\`\nConfigure your channel logs and adjust punishment durations.`)
            .addFields(
                { name: '🗑️ Deleted Message Logs', value: `> **State:** ${settings.logDeletedEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> *Tracks messages deleted by users.*`, inline: false },
                { name: '📝 Primary Action Log Channel', value: settings.logChannelId ? `> **Channel:** <#${settings.logChannelId}>` : '> **Channel:** `Not Set (Sends to source)`', inline: false }
            )
            .setFooter({ text: 'Settings automatically save to the database.' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_deleted').setLabel('Deleted Msg Logs').setStyle(settings.logDeletedEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('edit_links').setLabel('Config Links').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
            new ButtonBuilder().setCustomId('edit_images').setLabel('Config Images').setStyle(ButtonStyle.Secondary).setEmoji('⚙️')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('🗂️ Select a channel for security logs...').addChannelTypes(ChannelType.GuildText)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('nav_page1').setLabel('⬅️ Back to Main Defenses').setStyle(ButtonStyle.Primary)
        );

        return { embeds: [embed], components: [row1, row2, row3], ephemeral: true };
    }
};

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discord\.com\/invite\/.+)/i;

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
};

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Database Loaded Successfully.');
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        await interaction.reply(generateDashboard(interaction.guildId, 1));
    }

    if (interaction.isButton()) {
        const settings = getSettings(interaction.guildId);

        // Navigation
        if (interaction.customId === 'nav_page1') return interaction.update(generateDashboard(interaction.guildId, 1));
        if (interaction.customId === 'nav_page2') return interaction.update(generateDashboard(interaction.guildId, 2));

        // Page 1 Toggles
        if (['toggle_master', 'toggle_links', 'toggle_images', 'toggle_raid'].includes(interaction.customId)) {
            if (interaction.customId === 'toggle_master') updateSetting(interaction.guildId, 'masterSwitch', !settings.masterSwitch);
            if (interaction.customId === 'toggle_links') updateSetting(interaction.guildId, 'linksEnabled', !settings.linksEnabled);
            if (interaction.customId === 'toggle_images') updateSetting(interaction.guildId, 'imagesEnabled', !settings.imagesEnabled);
            if (interaction.customId === 'toggle_raid') updateSetting(interaction.guildId, 'raidEnabled', !settings.raidEnabled);
            return interaction.update(generateDashboard(interaction.guildId, 1));
        }

        // Page 2 Toggles
        if (interaction.customId === 'toggle_deleted') {
            updateSetting(interaction.guildId, 'logDeletedEnabled', !settings.logDeletedEnabled);
            return interaction.update(generateDashboard(interaction.guildId, 2));
        }

        // Modals (Triggered from Page 2)
        if (interaction.customId === 'edit_links') {
            const modal = new ModalBuilder().setCustomId('modal_links').setTitle('Link Shield Settings');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_link_timeout').setLabel('Timeout (e.g. 30m, 1d)').setStyle(TextInputStyle.Short).setRequired(true).setValue(toShortFormat(settings.linkTimeout))));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'edit_images') {
            const modal = new ModalBuilder().setCustomId('modal_images').setTitle('Image Shield Settings');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_image_max').setLabel('Trigger limit (e.g. 1, 3, 5)').setStyle(TextInputStyle.Short).setRequired(true).setValue(settings.maxImages.toString())),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_image_timeout').setLabel('Timeout (e.g. 60m, 7d)').setStyle(TextInputStyle.Short).setRequired(true).setValue(toShortFormat(settings.imageTimeout)))
            );
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        const settings = getSettings(interaction.guildId);

        if (interaction.customId === 'modal_links') {
            const parsed = parseDuration(interaction.fields.getTextInputValue('input_link_timeout'));
            if (parsed) updateSetting(interaction.guildId, 'linkTimeout', parsed);
            await interaction.update(generateDashboard(interaction.guildId, 2));
        }

        if (interaction.customId === 'modal_images') {
            const max = parseInt(interaction.fields.getTextInputValue('input_image_max'));
            const parsedTimeout = parseDuration(interaction.fields.getTextInputValue('input_image_timeout'));
            if (!isNaN(max) && max > 0) updateSetting(interaction.guildId, 'maxImages', max);
            if (parsedTimeout) updateSetting(interaction.guildId, 'imageTimeout', parsedTimeout);
            await interaction.update(generateDashboard(interaction.guildId, 2));
        }
    }

    if (interaction.isChannelSelectMenu() && interaction.customId === 'select_log') {
        updateSetting(interaction.guildId, 'logChannelId', interaction.values);
        await interaction.update(generateDashboard(interaction.guildId, 2)); // Stays on Page 2
    }
});

// 🗑️ NEW: DELETED MESSAGE LOGGER
client.on('messageDelete', async message => {
    if (!message.guild || !message.author || message.author.bot) return; // Ignore bots and system messages

    const settings = getSettings(message.guild.id);
    if (!settings.masterSwitch || !settings.logDeletedEnabled || !settings.logChannelId) return;

    try {
        const logChannel = await message.guild.channels.fetch(settings.logChannelId);
        if (!logChannel) return;

        const content = message.content ? message.content : '*Message contained no text (likely an image or attachment).*';

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Message Deleted')
            .setColor('#ff9900')
            .setDescription(`**Author:** <@${message.author.id}>\n**Channel:** <#${message.channel.id}>\n\n**Content:**\n>>> ${content}`)
            .setTimestamp()
            .setFooter({ text: `User ID: ${message.author.id}` });

        await logChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        // Suppress errors if channel is missing
    }
});

client.on('messageCreate', async message => {
    if (!message.guild || message.author.id === client.user.id) return; 

    const settings = getSettings(message.guild.id);
    if (!settings.masterSwitch) return;

    let targetLogChannel = message.channel;
    
    if (settings.logChannelId) {
        try {
            const chan = await message.guild.channels.fetch(settings.logChannelId);
            if (chan) targetLogChannel = chan;
        } catch (e) {}
    }

    if (settings.raidEnabled) {
        const content = message.content.toLowerCase();
        const isRaid = content.includes('﷽') || 
                       (content.includes('@everyone') && inviteRegex.test(content)) ||
                       (content.includes('@here') && inviteRegex.test(content));

        if (isRaid) {
            try {
                await message.delete().catch(() => {});
                let culpritId = message.author.id;
                
                if (message.interactionMetadata) {
                    culpritId = message.interactionMetadata.user.id;
                } else if (message.interaction) {
                    culpritId = message.interaction.user.id;
                }

                const targetMember = await message.guild.members.fetch(culpritId).catch(() => null);

                if (targetMember && targetMember.timeout) {
                    await targetMember.timeout(86400000, 'Using Malicious Raid App Commands').catch(() => {});
                }

                await message.channel.send(`🚨 **RAID BLOCKED:** <@${culpritId}> tried to use a malicious raid app!`);

                const log = createLogEmbed('🛡️ Raid App Blocked', `**Culprit:** <@${culpritId}>\n**Action:** Message Deleted & User Timed Out for 24h.`, '#800080');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (message.author.bot || message.webhookId) return;

    if (settings.linksEnabled && inviteRegex.test(message.content)) {
        try {
            await message.delete();
            if (message.member) await message.member.timeout(settings.linkTimeout * 60000, 'Invite Link Spam');
            const log = createLogEmbed('🛡️ Link Blocked', `**User:** <@${message.author.id}>\n**Action:** Deleted & Timed out (${formatDuration(settings.linkTimeout)})`, '#ffcc00');
            await targetLogChannel.send({ embeds: [log] }).catch(() => {});
        } catch (e) {}
    }

    if (settings.imagesEnabled && message.attachments.size >= settings.maxImages) {
        try {
            await message.delete();
            if (message.member) await message.member.timeout(settings.imageTimeout * 60000, 'Image Spam/Hacked Account');
            await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for sending too many images at once.`).catch(() => {});
            const log = createLogEmbed('🚨 Image Spam Blocked', `**User:** <@${message.author.id}>\n**Action:** Deleted & Timed out (${formatDuration(settings.imageTimeout)})`, '#ff0000');
            await targetLogChannel.send({ embeds: [log] }).catch(() => {});
        } catch (e) {}
    }
});

client.login(process.env.DISCORD_TOKEN);
