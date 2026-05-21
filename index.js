require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const dbFile = './database.json';
let guildSettings = {};

if (fs.existsSync(dbFile)) {
    try { 
        guildSettings = JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch (e) {}
}

const saveDatabase = () => fs.writeFileSync(dbFile, JSON.stringify(guildSettings, null, 4));

const getSettings = (guildId) => {
    if (!guildSettings[guildId]) {
        guildSettings[guildId] = {
            masterSwitch: true, 
            linksEnabled: true,
            linkTimeout: 30,
            linkAvoids: [], 
            allowedAccess: [],
            imagesEnabled: true,
            maxImages: 1,
            imageTimeout: 4320,
            raidEnabled: true,
            fileShieldEnabled: true,
            logDeletedEnabled: false,
            logChannelId: null,
            history: []
        };
        saveDatabase();
    }
    return guildSettings[guildId];
};

const INDIGO_BLUE = 0x4f46e5;

const buildMainMenu = (settings) => {
    const embed = new EmbedBuilder()
        .setTitle('❖ ServSecurity Command Matrix')
        .setDescription('Select a module from the menu below to configure your defensive perimeters.')
        .setColor(INDIGO_BLUE)
        .addFields(
            { 
                name: '🌐 Core System', 
                value: `>>> **Master Shield:** ${settings.masterSwitch ? '🟢 ACTIVE' : '🔴 OFFLINE'}`,
                inline: false
            },
            { 
                name: '🔗 Link Shield', 
                value: `>>> **Status:** ${settings.linksEnabled ? '🟢' : '🔴'}\n**Timeout:** ${settings.linkTimeout}m\n**Avoids:** ${settings.linkAvoids.length}`,
                inline: true
            },
            { 
                name: '🖼️ Image Shield', 
                value: `>>> **Status:** ${settings.imagesEnabled ? '🟢' : '🔴'}\n**Limit:** ${settings.maxImages} imgs\n**Timeout:** ${settings.imageTimeout}m`,
                inline: true
            },
            { 
                name: '⚔️ Structural Defenses', 
                value: `>>> **Raid Matrix:** ${settings.raidEnabled ? '🟢' : '🔴'}\n**Exec Sandbox:** ${settings.fileShieldEnabled ? '🟢' : '🔴'}\n**Log Deletions:** ${settings.logDeletedEnabled ? '🟢' : '🔴'}`,
                inline: false
            },
            {
                name: '📡 System Logs',
                value: `>>> **Channel:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not Set'}`,
                inline: false
            }
        )
        .setFooter({ text: 'ServSecurity • Advanced Operations' })
        .setTimestamp();

    const selectMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('config_menu')
            .setPlaceholder('Configure Defense Modules...')
            .addOptions([
                { label: 'Core System', description: 'Toggle the master shield override', value: 'menu_core', emoji: '🌐' },
                { label: 'Link Shield', description: 'Configure URL anti-spam filters', value: 'menu_links', emoji: '🔗' },
                { label: 'Image Shield', description: 'Configure media containment limits', value: 'menu_images', emoji: '🖼️' },
                { label: 'Structural Defenses', description: 'Toggle raid, file, and log modules', value: 'menu_structural', emoji: '⚔️' },
                { label: 'System Logs', description: 'Configure the active logging channel', value: 'menu_logs', emoji: '📡' },
            ])
    );

    return { embeds: [embed], components: [selectMenu] };
};

const buildLinkMenu = (settings) => {
    const embed = new EmbedBuilder()
        .setTitle('🔗 Link Shield Configuration')
        .setDescription('Purges unauthorized invites and domains matching prohibited definitions.')
        .setColor(INDIGO_BLUE)
        .addFields(
            { name: 'Current Status', value: settings.linksEnabled ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
            { name: 'Timeout Duration', value: `${settings.linkTimeout} Minutes`, inline: true },
            { name: 'Avoids List', value: settings.linkAvoids.length > 0 ? `\`${settings.linkAvoids.join(', ')}\`` : 'None', inline: false }
        );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_links').setLabel(settings.linksEnabled ? 'Disable Shield' : 'Enable Shield').setStyle(settings.linksEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_links').setLabel('Edit Parameters').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_main').setLabel('Back to Matrix').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttons] };
};

const buildImageMenu = (settings) => {
    const embed = new EmbedBuilder()
        .setTitle('🖼️ Image Shield Configuration')
        .setDescription('Filters mass-media and restricts high frequency image spam.')
        .setColor(INDIGO_BLUE)
        .addFields(
            { name: 'Current Status', value: settings.imagesEnabled ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
            { name: 'Max Burst Limit', value: `${settings.maxImages} Images`, inline: true },
            { name: 'Timeout Duration', value: `${settings.imageTimeout} Minutes`, inline: false }
        );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_images').setLabel(settings.imagesEnabled ? 'Disable Shield' : 'Enable Shield').setStyle(settings.imagesEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_images').setLabel('Edit Parameters').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_main').setLabel('Back to Matrix').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttons] };
};

const buildStructuralMenu = (settings) => {
    const embed = new EmbedBuilder()
        .setTitle('⚔️ Structural Defenses')
        .setDescription('Manage core perimeter defenses against raids and malicious files.')
        .setColor(INDIGO_BLUE)
        .addFields(
            { name: 'Raid Matrix Blocker', value: settings.raidEnabled ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
            { name: 'Executable Sandbox', value: settings.fileShieldEnabled ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
            { name: 'Log Deleted Transmissions', value: settings.logDeletedEnabled ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: false }
        );

    const buttons1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_raid').setLabel('Toggle Raid').setStyle(settings.raidEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('toggle_file').setLabel('Toggle Sandbox').setStyle(settings.fileShieldEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('toggle_logdel').setLabel('Toggle Del Logs').setStyle(settings.logDeletedEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    const buttons2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_main').setLabel('Back to Matrix').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttons1, buttons2] };
};

const buildLogsMenu = (settings) => {
    const embed = new EmbedBuilder()
        .setTitle('📡 System Logs Configuration')
        .setDescription('Set the destination for security alerts and transmission logs.')
        .setColor(INDIGO_BLUE)
        .addFields(
            { name: 'Current Target Channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not Configured', inline: false }
        );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_log_channel').setLabel('Set to Current Channel').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_main').setLabel('Back to Matrix').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttons] };
};

client.once('ready', () => {
    console.log(`Ready: ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction.isChatInputCommand() && !interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

        const allowedUserId = '1284247278957367337';
        const isServerOwner = interaction.guild && interaction.user.id === interaction.guild.ownerId;
        const isWhitelistedUser = interaction.user.id === allowedUserId;
        const isAdmin = interaction.member?.permissions?.has('Administrator');

        if (!isServerOwner && !isWhitelistedUser && !isAdmin) {
            if (interaction.isRepliable()) {
                return interaction.reply({
                    content: '❌ **Access Denied:** You lack the clearance to access the terminal.',
                    ephemeral: true
                });
            }
            return;
        }

        const settings = getSettings(interaction.guildId);

        if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
            await interaction.reply({
                ...buildMainMenu(settings),
                ephemeral: true 
            });
            return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'config_menu') {
            const choice = interaction.values;
            
            if (choice === 'menu_core') {
                settings.masterSwitch = !settings.masterSwitch;
                saveDatabase();
                await interaction.update(buildMainMenu(settings));
            } else if (choice === 'menu_links') {
                await interaction.update(buildLinkMenu(settings));
            } else if (choice === 'menu_images') {
                await interaction.update(buildImageMenu(settings));
            } else if (choice === 'menu_structural') {
                await interaction.update(buildStructuralMenu(settings));
            } else if (choice === 'menu_logs') {
                await interaction.update(buildLogsMenu(settings));
            }
            return;
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'back_main') {
                await interaction.update(buildMainMenu(settings));
            } else if (id === 'toggle_links') {
                settings.linksEnabled = !settings.linksEnabled;
                saveDatabase();
                await interaction.update(buildLinkMenu(settings));
            } else if (id === 'toggle_images') {
                settings.imagesEnabled = !settings.imagesEnabled;
                saveDatabase();
                await interaction.update(buildImageMenu(settings));
            } else if (id === 'toggle_raid') {
                settings.raidEnabled = !settings.raidEnabled;
                saveDatabase();
                await interaction.update(buildStructuralMenu(settings));
            } else if (id === 'toggle_file') {
                settings.fileShieldEnabled = !settings.fileShieldEnabled;
                saveDatabase();
                await interaction.update(buildStructuralMenu(settings));
            } else if (id === 'toggle_logdel') {
                settings.logDeletedEnabled = !settings.logDeletedEnabled;
                saveDatabase();
                await interaction.update(buildStructuralMenu(settings));
            } else if (id === 'set_log_channel') {
                settings.logChannelId = interaction.channelId;
                saveDatabase();
                await interaction.update(buildLogsMenu(settings));
            } else if (id === 'edit_links') {
                const modal = new ModalBuilder().setCustomId('modal_links').setTitle('Link Shield Parameters');
                const timeoutInput = new TextInputBuilder().setCustomId('input_timeout').setLabel('Timeout (Minutes)').setStyle(TextInputStyle.Short).setValue(settings.linkTimeout.toString());
                const avoidsInput = new TextInputBuilder().setCustomId('input_avoids').setLabel('Avoids List (Comma Separated)').setStyle(TextInputStyle.Paragraph).setValue(settings.linkAvoids.join(', ')).setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(timeoutInput), new ActionRowBuilder().addComponents(avoidsInput));
                await interaction.showModal(modal);
            } else if (id === 'edit_images') {
                const modal = new ModalBuilder().setCustomId('modal_images').setTitle('Image Shield Parameters');
                const burstInput = new TextInputBuilder().setCustomId('input_limit').setLabel('Max Images').setStyle(TextInputStyle.Short).setValue(settings.maxImages.toString());
                const timeoutInput = new TextInputBuilder().setCustomId('input_timeout').setLabel('Timeout (Minutes)').setStyle(TextInputStyle.Short).setValue(settings.imageTimeout.toString());
                modal.addComponents(new ActionRowBuilder().addComponents(burstInput), new ActionRowBuilder().addComponents(timeoutInput));
                await interaction.showModal(modal);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_links') {
                const timeout = parseInt(interaction.fields.getTextInputValue('input_timeout')) || 30;
                const avoidsRaw = interaction.fields.getTextInputValue('input_avoids');
                const avoids = avoidsRaw ? avoidsRaw.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0) : [];
                
                settings.linkTimeout = timeout;
                settings.linkAvoids = avoids;
                saveDatabase();
                await interaction.update(buildLinkMenu(settings));
            } else if (interaction.customId === 'modal_images') {
                const limit = parseInt(interaction.fields.getTextInputValue('input_limit')) || 1;
                const timeout = parseInt(interaction.fields.getTextInputValue('input_timeout')) || 4320;
                
                settings.maxImages = limit;
                settings.imageTimeout = timeout;
                saveDatabase();
                await interaction.update(buildImageMenu(settings));
            }
            return;
        }
    } catch (err) {
        console.error("Interaction Handle Error:", err);
    }
});

client.on(Events.GuildAuditLogEntryCreate, async (auditLog, guild) => {
    if (!guild) return;
    const settings = getSettings(guild.id);
    if (!settings.masterSwitch) return;
    if (auditLog.executorId === client.user.id) return;

    const target = auditLog.target;
    const executor = auditLog.executor;
    if (!target || !executor) return;

    let actionType = null;
    let color = '#000000';
    const reason = auditLog.reason || `Action by admin: ${executor.username}`;

    if (auditLog.action === AuditLogEvent.MemberKick) {
        actionType = 'KICK';
        color = '#ff5500';
    } else if (auditLog.action === AuditLogEvent.MemberBanAdd) {
        actionType = 'BAN';
        color = '#ff0000';
    } else if (auditLog.action === AuditLogEvent.MemberUpdate) {
        const timeoutChange = auditLog.changes.find(c => c.key === 'communication_disabled_until');
        if (timeoutChange && timeoutChange.new) {
            actionType = 'TIMEOUT';
            color = '#ffcc00';
        }
    }

    if (actionType) {
        logAction(guild.id, actionType, target.username || target.tag, target.id, reason);
        if (settings.logChannelId) {
            try {
                const logChannel = await guild.channels.fetch(settings.logChannelId);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`🔨 Manual ${actionType} Executed`)
                        .setDescription(`**Target User:** <@${target.id}> (${target.id})\n**Moderator:** <@${executor.id}>\n**Reason:** ${reason}`)
                        .setColor(color)
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}
        }
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

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discord\.com\/invite\/.+)/i;
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];

client.on('messageCreate', async message => {
    if (!message.guild || message.author.id === client.user.id) return; 
    if (message.author.id === '1284247278957367337') return;

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
                let culpritTag = message.author.username;
                
                if (message.interactionMetadata) {
                    culpritId = message.interactionMetadata.user.id;
                    culpritTag = message.interactionMetadata.user.username;
                } else if (message.interaction) {
                    culpritId = message.interaction.user.id;
                    culpritTag = message.interaction.user.username;
                }

                const targetMember = await message.guild.members.fetch(culpritId).catch(() => null);
                if (targetMember && targetMember.timeout) await targetMember.timeout(86400000, 'Using Malicious Raid App Commands').catch(() => {});

                logAction(message.guild.id, 'TIMEOUT', culpritTag, culpritId, 'Malicious Raid App Activity');
                await message.channel.send(`🚨 **RAID BLOCKED:** <@${culpritId}> tried to use a malicious raid app!`);

                const log = new EmbedBuilder()
                    .setTitle('🛡️ Raid App Blocked')
                    .setDescription(`**Culprit:** <@${culpritId}>\n**Action:** Message Deleted & User Timed Out for 24h.`)
                    .setColor('#800080')
                    .setTimestamp();
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
                
                logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Dangerous File Upload');
                await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for uploading a prohibited file type (Executable/Script).`).catch(() => {});
                
                const log = new EmbedBuilder()
                    .setTitle('📁 Dangerous File Blocked')
                    .setDescription(`**User:** <@${message.author.id}>\n**Action:** Message Deleted & Timed out (1 Day)\n**Reason:** Uploaded an executable or script file.`)
                    .setColor('#ff0000')
                    .setTimestamp();
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (settings.linksEnabled) {
        const messageContentLower = message.content.toLowerCase();
        const isDiscordInvite = inviteRegex.test(message.content);
        const isAvoided = settings.linkAvoids && settings.linkAvoids.some(domain => messageContentLower.includes(domain));

        if (isDiscordInvite && !isAvoided) {
            try {
                await message.delete();
                if (message.member) await message.member.timeout(settings.linkTimeout * 60000, 'Prohibited Invite Link');
                
                logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Invite Link Spam');
                
                const log = new EmbedBuilder()
                    .setTitle('🛡️ Link Blocked')
                    .setDescription(`**User:** <@${message.author.id}>\n**Trigger:** \`Discord Invite Link\`\n**Action:** Deleted & Timed out (${settings.linkTimeout} Minutes)`)
                    .setColor('#ffcc00')
                    .setTimestamp();
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
            } catch (e) {}
        }
    }

    if (settings.imagesEnabled && message.attachments.size >= settings.maxImages) {
        try {
            await message.delete();
            if (message.member) await message.member.timeout(settings.imageTimeout * 60000, 'Image Spam/Hacked Account');
            
            logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Image Spam/Mass Upload');
            await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for sending too many images at once.`).catch(() => {});
            
            const log = new EmbedBuilder()
                .setTitle('🚨 Image Spam Blocked')
                .setDescription(`**User:** <@${message.author.id}>\n**Action:** Deleted & Timed out (${settings.imageTimeout} Minutes)`)
                .setColor('#ff0000')
                .setTimestamp();
            await targetLogChannel.send({ embeds: [log] }).catch(() => {});
        } catch (e) {}
    }
});

const logAction = (guildId, type, username, userId, reason) => {
    const settings = getSettings(guildId);
    if (!settings.history) settings.history = [];
    
    settings.history.unshift({
        type,
        username,
        userId,
        reason,
        timestamp: Math.floor(Date.now() / 1000)
    });

    if (settings.history.length > 10) {
        settings.history = settings.history.slice(0, 10);
    }
    saveDatabase();
};

if (!process.env.DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN");
} else {
    client.login(process.env.DISCORD_TOKEN).catch(err => {});
}
