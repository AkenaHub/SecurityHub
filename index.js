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

const dbFile = './database.json';
let guildSettings = {};

if (fs.existsSync(dbFile)) {
    try {
        guildSettings = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch (e) {
        console.error("Failed to load database. Starting fresh.");
    }
}

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
            fileShieldEnabled: true,
            logDeletedEnabled: false,
            logChannelId: null
        };
        saveDatabase();
    }
    return guildSettings[guildId];
};

const updateSetting = (guildId, key, value) => {
    const settings = getSettings(guildId);
    settings[key] = value;
    saveDatabase();
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
                { name: '🔗 Link Shield', value: `> **State:** ${settings.linksEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Timeout:** \`${formatDuration(settings.linkTimeout)}\``, inline: true },
                { name: '🖼️ Image Shield', value: `> **State:** ${settings.imagesEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Limit:** \`${settings.maxImages} Image(s)\`\n> **Timeout:** \`${formatDuration(settings.imageTimeout)}\``, inline: true },
                { name: '⚔️ Raid Shield', value: `> **State:** ${settings.raidEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Action:** \`Auto-Delete & 24h Timeout\``, inline: true },
                { name: '📁 Malware/File Shield', value: `> **State:** ${settings.fileShieldEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> **Action:** \`Blocks .exe, .bat, etc.\``, inline: true }
            )
            .setFooter({ text: 'Settings automatically save to the database.' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_master').setLabel(settings.masterSwitch ? 'SHUTDOWN' : 'BOOT UP').setStyle(settings.masterSwitch ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji('🔌')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_links').setLabel('Link').setStyle(settings.linksEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🔗'),
            new ButtonBuilder().setCustomId('toggle_images').setLabel('Image').setStyle(settings.imagesEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🖼️'),
            new ButtonBuilder().setCustomId('toggle_raid').setLabel('Raid').setStyle(settings.raidEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('toggle_files').setLabel('Files').setStyle(settings.fileShieldEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('📁')
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
                { name: '🗑️ Deleted Message Logs', value: `> **State:** ${settings.logDeletedEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> *Tracks deleted texts, images, and videos.*`, inline: false },
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
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];

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

        if (interaction.customId === 'nav_page1') return interaction.update(generateDashboard(interaction.guildId, 1));
        if (interaction.customId === 'nav_page2') return interaction.update(generateDashboard(interaction.guildId, 2));

        if (['toggle_master', 'toggle_links', 'toggle_images', 'toggle_raid', 'toggle_files'].includes(interaction.customId)) {
            if (interaction.customId === 'toggle_master') updateSetting(interaction.guildId, 'masterSwitch', !settings.masterSwitch);
            if (interaction.customId === 'toggle_links') updateSetting(interaction.guildId, 'linksEnabled', !settings.linksEnabled);
            if (interaction.customId === 'toggle_images') updateSetting(interaction.guildId, 'imagesEnabled', !settings.imagesEnabled);
            if (interaction.customId === 'toggle_raid') updateSetting(interaction.guildId, 'raidEnabled', !settings.raidEnabled);
            if (interaction.customId === 'toggle_files') updateSetting(interaction.guildId, 'fileShieldEnabled', !settings.fileShieldEnabled);
            return interaction.update(generateDashboard(interaction.guildId, 1));
        }

        if (interaction.customId === 'toggle_deleted') {
            updateSetting(interaction.guildId, 'logDeletedEnabled', !settings.logDeletedEnabled);
            return interaction.update(generateDashboard(interaction.guildId, 2));
        }

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
        await interaction.update(generateDashboard(interaction.guildId, 2)); 
    }
});

client.on('messageDelete', async message => {
    if (!message.guild || !message.author || message.author.bot) return; 

    const settings = getSettings(message.guild.id);
    if (!settings.masterSwitch || !settings.logDeletedEnabled || !settings.logChannelId) return;

    try {
        const logChannel = await message.guild.channels.fetch(settings.logChannelId);
        if (!logChannel) return;

        let content = message.content ? message.content : '*No text.*';
        let attachmentInfo = '';
        let displayImageUrl = null;

        if (message.attachments.size > 0) {
            attachmentInfo = '\n\n**📎 Attached Media:**\n' + message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
            const imageFile = message.attachments.find(a => a.contentType && a.contentType.startsWith('image/'));
            if (imageFile) displayImageUrl = imageFile.url;
        }

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Message Deleted')
            .setColor('#ff9900')
            .setDescription(`**Author:** <@${message.author.id}>\n**Channel:** <#${message.channel.id}>\n\n**Content:**\n>>> ${content}${attachmentInfo}`)
            .setTimestamp()
            .setFooter({ text: `User ID: ${message.author.id}` });

        if (displayImageUrl) embed.setImage(displayImageUrl);

        await logChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {}
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
                if (targetMember && targetMember.timeout) await targetMember.timeout(86400000, 'Using Malicious Raid App Commands').catch(() => {});

                await message.channel.send(`🚨 **RAID BLOCKED:** <@${culpritId}> tried to use a malicious raid app!`);

                const log = createLogEmbed('🛡️ Raid App Blocked', `**Culprit:** <@${culpritId}>\n**Action:** Message Deleted & User Timed Out for 24h.`, '#800080');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (message.author.bot || message.webhookId) return;

    if (settings.fileShieldEnabled && message.attachments.size > 0) {
        const hasDangerousFile = message.attachments.some(attachment => {
            const fileName = attachment.name.toLowerCase();
            return dangerousExtensions.some(ext => fileName.endsWith(ext));
        });

        if (hasDangerousFile) {
            try {
                await message.delete();
                if (message.member) await message.member.timeout(1440 * 60000, 'Uploading dangerous/malicious files');
                await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for uploading a prohibited file type (Executable/Script).`).catch(() => {});
                const log = createLogEmbed('📁 Dangerous File Blocked', `**User:** <@${message.author.id}>\n**Action:** Message Deleted & Timed out (1 Day)\n**Reason:** Uploaded an executable or script file.`, '#ff0000');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

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
