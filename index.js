require('dotenv').config();

const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelSelectMenuBuilder, ChannelType, 
    ModalBuilder, TextInputBuilder, TextInputStyle,
    REST, Routes, SlashCommandBuilder,
    AuditLogEvent, Events, PermissionFlagsBits
} = require('discord.js');
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

const loadLocalDatabase = () => {
    if (fs.existsSync(dbFile)) {
        try {
            guildSettings = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        } catch (e) {
            guildSettings = {};
        }
    }
};

const saveLocalDatabase = () => {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(guildSettings, null, 4));
    } catch (e) {}
};

const syncWithDiscord = async (guild) => {
    try {
        const channel = guild.channels.cache.find(c => c.name === 'servsecurity-database' && c.type === ChannelType.GuildText);
        if (!channel) return; 

        const messages = await channel.messages.fetch({ limit: 10 });
        const dbMessage = messages.find(m => m.author.id === client.user.id && m.content.startsWith('```json'));
        
        if (dbMessage) {
            const rawJson = dbMessage.content.replace(/```json|```/g, '').trim();
            guildSettings[guild.id] = JSON.parse(rawJson);
            saveLocalDatabase();
        }
    } catch (e) {}
};

const saveToCloud = async (guild, settings) => {
    try {
        let channel = guild.channels.cache.find(c => c.name === 'servsecurity-database' && c.type === ChannelType.GuildText);
        
        if (!channel) {
            channel = await guild.channels.create({
                name: 'servsecurity-database',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                    }
                ]
            });
        }

        const messages = await channel.messages.fetch({ limit: 10 });
        const dbMessage = messages.find(m => m.author.id === client.user.id && m.content.startsWith('```json'));
        
        let payload = `\`\`\`json\n${JSON.stringify(settings)}\n\`\`\``;
        
        if (payload.length > 1950) {
            settings.history = settings.history.slice(0, 4); 
            payload = `\`\`\`json\n${JSON.stringify(settings)}\n\`\`\``;
        }

        if (dbMessage) {
            await dbMessage.edit(payload);
        } else {
            await channel.send(payload);
        }
    } catch (e) {}
};

const getSettings = async (guildId) => {
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
        saveLocalDatabase();
    }
    return guildSettings[guildId];
};

const updateSetting = async (guild, key, value) => {
    const settings = await getSettings(guild.id);
    settings[key] = value;
    guildSettings[guild.id] = settings;
    saveLocalDatabase();
    await saveToCloud(guild, settings);
};

const logAction = async (guild, type, username, userId, reason) => {
    const settings = await getSettings(guild.id);
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
    
    guildSettings[guild.id] = settings;
    saveLocalDatabase();
    await saveToCloud(guild, settings);
};

const parseDuration = (input) => {
    const val = input.toLowerCase().trim();
    const num = parseInt(val);
    if (isNaN(num)) return null;
    if (val.endsWith('d')) return num * 1440;
    if (val.endsWith('h')) return num * 60;
    return num; 
};

const formatDuration = (mins) => {
    if (mins >= 1440 && mins % 1440 === 0) return `${mins / 1440} Days`;
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60} Hours`;
    return `${mins} Minutes`;
};

const toShortFormat = (mins) => {
    if (mins >= 1440 && mins % 1440 === 0) return `${mins / 1440}d`;
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    return `${mins}m`;
};

const INDIGO_BLUE = 0x4f46e5;

const generateDashboard = async (guildId, page = 1) => {
    const settings = await getSettings(guildId);
    
    const statusEmoji = settings.masterSwitch ? '🟢' : '🔴';
    const statusText = settings.masterSwitch ? 'CORE DEFENSES ARMED' : 'CORE DEFENSES DISARMED';

    if (page === 1) {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ ServSecurity Control Center')
            .setColor(INDIGO_BLUE)
            .setDescription(`**Current Matrix State:** ${statusEmoji} \`${statusText}\`\n\nManage your automated defensive shields below. Use the navigation buttons to jump between configuration views and moderation histories.`)
            .addFields(
                { name: '🔗 LINK SHIELD', value: `\`\`\`yaml\nStatus: ${settings.linksEnabled ? 'ENABLED' : 'DISABLED'}\nTimeout: ${formatDuration(settings.linkTimeout)}\nAvoids: ${settings.linkAvoids.length} Items\`\`\``, inline: true },
                { name: '🖼️ IMAGE SHIELD', value: `\`\`\`yaml\nStatus: ${settings.imagesEnabled ? 'ENABLED' : 'DISABLED'}\nLimit: ${settings.maxImages} Msg\nTimeout: ${formatDuration(settings.imageTimeout)}\`\`\``, inline: true },
                { name: '⚔️ ANTI RAID', value: `\`\`\`yaml\nStatus: ${settings.raidEnabled ? 'ENABLED' : 'DISABLED'}\nAction: 24h Timeout\`\`\``, inline: true },
                { name: '📁 FILE SANDBOX', value: `\`\`\`yaml\nStatus: ${settings.fileShieldEnabled ? 'ENABLED' : 'DISABLED'}\nAction: 1d Timeout\`\`\``, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Main Defenses • Page 1 of 3' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_master').setLabel(settings.masterSwitch ? 'DISARM SYSTEM' : 'ARM SYSTEM').setStyle(settings.masterSwitch ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji('🔌')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_links').setLabel('Link Shield').setStyle(settings.linksEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji('🔗'),
            new ButtonBuilder().setCustomId('toggle_images').setLabel('Image Shield').setStyle(settings.imagesEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji('🖼️'),
            new ButtonBuilder().setCustomId('toggle_raid').setLabel('Anti Raid').setStyle(settings.raidEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('toggle_files').setLabel('File Sandbox').setStyle(settings.fileShieldEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji('📁')
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('nav_page2').setLabel('Logs & Config ➡️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('nav_page3').setLabel('Mod History 📜').setStyle(ButtonStyle.Secondary)
        );

        return { embeds: [embed], components: [row1, row2, row3], ephemeral: true };
    } 
    
    if (page === 2) {
        const avoidsSummary = settings.linkAvoids.length > 0 
            ? settings.linkAvoids.map(d => `\`${d}\``).join(', ')
            : '_No links avoided._';
            
        const accessSummary = settings.allowedAccess.length > 0 
            ? settings.allowedAccess.map(d => `\`${d}\``).join(', ')
            : '_Only Owner & Main Admin._';

        const embed = new EmbedBuilder()
            .setTitle('📡 LOGGING & ADVANCED CONFIG')
            .setColor(INDIGO_BLUE)
            .setDescription(`**Current Matrix State:** ${statusEmoji} \`${statusText}\`\n\nFine-tune thresholds, action criteria, and designated tracking channels for server modifications.`)
            .addFields(
                { name: '🗑️ Deleted Message Logs', value: `> State: ${settings.logDeletedEnabled ? '✅ `Enabled`' : '❌ `Disabled`'}\n> *Applies to all texts, files, and images.*`, inline: false },
                { name: '🟢 Allowed Links (Avoids)', value: `> ${avoidsSummary}`, inline: false },
                { name: '🔑 Panel Access (IDs)', value: `> ${accessSummary}`, inline: false },
                { name: '🗂️ Target Logging Channel', value: settings.logChannelId ? `> Destination: <#${settings.logChannelId}>` : '> Destination: `Not Set (Sends to source channel)`', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Configuration • Page 2 of 3' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_deleted').setLabel('Delete Logs').setStyle(settings.logDeletedEnabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('edit_links').setLabel('Setup Links').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
            new ButtonBuilder().setCustomId('edit_avoids').setLabel('Edit Avoids').setStyle(ButtonStyle.Secondary).setEmoji('🟢'),
            new ButtonBuilder().setCustomId('edit_images').setLabel('Setup Images').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
            new ButtonBuilder().setCustomId('edit_access').setLabel('Edit Access').setStyle(ButtonStyle.Secondary).setEmoji('🔑')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('select_log').setPlaceholder('Select channel for server security logs...').addChannelTypes(ChannelType.GuildText)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('nav_page1').setLabel('⬅️ Main Defenses').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('nav_page3').setLabel('Mod History 📜').setStyle(ButtonStyle.Secondary)
        );

        return { embeds: [embed], components: [row1, row2, row3], ephemeral: true };
    }

    if (page === 3) {
        const embed = new EmbedBuilder()
            .setTitle('📜 RECENT MODERATION ACTIONS')
            .setColor(INDIGO_BLUE)
            .setDescription('Displaying the last 10 automated and manual moderation actions tracked by this system.')
            .setTimestamp()
            .setFooter({ text: 'Incident History • Page 3 of 3' });

        const historyList = settings.history && settings.history.length > 0
            ? settings.history.map((log, index) => `**${index + 1}. [${log.type}]** \`${log.username}\` (${log.userId})\n🔹 **When:** <t:${log.timestamp}:F> (<t:${log.timestamp}:R>)\n🔹 **Reason:** \`${log.reason}\``).join('\n\n—\n\n')
            : '*No recent actions have been logged.*';

        embed.addFields({ name: '🚨 Active Incident Feed', value: historyList });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('nav_page1').setLabel('⬅️ Main Defenses').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('nav_page2').setLabel('Logs & Config ➡️').setStyle(ButtonStyle.Secondary)
        );

        return { embeds: [embed], components: [row1], ephemeral: true };
    }
};

const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|io|me|li)\/.+)|(discord\.com\/invite\/.+)/i;
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadLocalDatabase();

    for (const [id, guild] of client.guilds.cache) {
        await syncWithDiscord(guild);
    }

    try {
        console.log('🔄 Syncing global application (/) commands...');
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        const commands = [
            new SlashCommandBuilder()
                .setName('setup')
                .setDescription('Opens the Security Control Center dashboard.')
        ].map(cmd => cmd.toJSON());

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Global commands updated successfully across all servers!');
    } catch (error) {}
});

client.on(Events.GuildAuditLogEntryCreate, async (auditLog, guild) => {
    if (!guild) return;
    const settings = await getSettings(guild.id);
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
        await logAction(guild, actionType, target.username || target.tag, target.id, reason);

        if (settings.logChannelId) {
            try {
                const logChannel = await guild.channels.fetch(settings.logChannelId);
                if (logChannel) {
                    const embed = createLogEmbed(
                        `🔨 Manual ${actionType} Executed`, 
                        `**Target User:** <@${target.id}> (${target.id})\n**Moderator:** <@${executor.id}>\n**Reason:** ${reason}`, 
                        color
                    );
                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand() || interaction.isButton() || interaction.isModalSubmit() || interaction.isChannelSelectMenu()) {
        try {
            if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
                await interaction.deferReply({ ephemeral: true });
            }

            const settings = await getSettings(interaction.guildId);
            
            const allowedUserId = '1284247278957367337';
            const isServerOwner = interaction.user.id === interaction.guild.ownerId;
            const isWhitelistedUser = interaction.user.id === allowedUserId;
            const isAdmin = interaction.member && interaction.member.permissions && interaction.member.permissions.has('Administrator');
            
            let hasAccess = isServerOwner || isWhitelistedUser || isAdmin;

            if (!hasAccess && settings.allowedAccess.length > 0) {
                if (settings.allowedAccess.includes(interaction.user.id)) {
                    hasAccess = true;
                }
                if (interaction.member && interaction.member.roles && interaction.member.roles.cache.some(role => settings.allowedAccess.includes(role.id))) {
                    hasAccess = true;
                }
            }

            if (!hasAccess) {
                if (interaction.deferred) {
                    return interaction.editReply({ content: '❌ **Access Denied:** You do not have permission to use or view the security panel.' });
                } else if (!interaction.replied) {
                    return interaction.reply({ content: '❌ **Access Denied:** You do not have permission to use or view the security panel.', ephemeral: true });
                }
                return;
            }

            if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
                const dashboard = await generateDashboard(interaction.guildId, 1);
                return interaction.editReply(dashboard);
            }

            if (interaction.isButton()) {
                const modalButtons = ['edit_links', 'edit_avoids', 'edit_access', 'edit_images'];
                
                if (!modalButtons.includes(interaction.customId)) {
                    await interaction.deferUpdate();
                }

                if (interaction.customId === 'nav_page1') {
                    const dashboard = await generateDashboard(interaction.guildId, 1);
                    return interaction.editReply(dashboard);
                }
                if (interaction.customId === 'nav_page2') {
                    const dashboard = await generateDashboard(interaction.guildId, 2);
                    return interaction.editReply(dashboard);
                }
                if (interaction.customId === 'nav_page3') {
                    const dashboard = await generateDashboard(interaction.guildId, 3);
                    return interaction.editReply(dashboard);
                }

                if (['toggle_master', 'toggle_links', 'toggle_images', 'toggle_raid', 'toggle_files'].includes(interaction.customId)) {
                    if (interaction.customId === 'toggle_master') await updateSetting(interaction.guild, 'masterSwitch', !settings.masterSwitch);
                    if (interaction.customId === 'toggle_links') await updateSetting(interaction.guild, 'linksEnabled', !settings.linksEnabled);
                    if (interaction.customId === 'toggle_images') await updateSetting(interaction.guild, 'imagesEnabled', !settings.imagesEnabled);
                    if (interaction.customId === 'toggle_raid') await updateSetting(interaction.guild, 'raidEnabled', !settings.raidEnabled);
                    if (interaction.customId === 'toggle_files') await updateSetting(interaction.guild, 'fileShieldEnabled', !settings.fileShieldEnabled);
                    
                    const dashboard = await generateDashboard(interaction.guildId, 1);
                    return interaction.editReply(dashboard);
                }

                if (interaction.customId === 'toggle_deleted') {
                    await updateSetting(interaction.guild, 'logDeletedEnabled', !settings.logDeletedEnabled);
                    const dashboard = await generateDashboard(interaction.guildId, 2);
                    return interaction.editReply(dashboard);
                }

                if (interaction.customId === 'edit_links') {
                    const modal = new ModalBuilder().setCustomId('modal_links').setTitle('Link Shield Settings');
                    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_link_timeout').setLabel('Timeout (e.g. 30m, 1d)').setStyle(TextInputStyle.Short).setRequired(true).setValue(toShortFormat(settings.linkTimeout))));
                    await interaction.showModal(modal);
                    return;
                }

                if (interaction.customId === 'edit_avoids') {
                    const modal = new ModalBuilder().setCustomId('modal_avoids').setTitle('Configure Allowed Links');
                    modal.addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('input_avoids')
                            .setLabel('Enter domains/invites to AVOID (comma-sep)')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('discord.gg/yourserver, discord.com/invite/xyz')
                            .setRequired(false)
                            .setValue(settings.linkAvoids.join(', '))
                    ));
                    await interaction.showModal(modal);
                    return;
                }

                if (interaction.customId === 'edit_access') {
                    const modal = new ModalBuilder().setCustomId('modal_access').setTitle('Configure Panel Access');
                    modal.addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('input_access')
                            .setLabel('Enter User/Role IDs (Separate with commas)')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('123456789012345678, 987654321098765432')
                            .setRequired(false)
                            .setValue(settings.allowedAccess.join(', '))
                    ));
                    await interaction.showModal(modal);
                    return;
                }

                if (interaction.customId === 'edit_images') {
                    const modal = new ModalBuilder().setCustomId('modal_images').setTitle('Image Shield Settings');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_image_max').setLabel('Trigger limit (e.g. 1, 3, 5)').setStyle(TextInputStyle.Short).setRequired(true).setValue(settings.maxImages.toString())),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_image_timeout').setLabel('Timeout (e.g. 60m, 7d)').setStyle(TextInputStyle.Short).setRequired(true).setValue(toShortFormat(settings.imageTimeout)))
                    );
                    await interaction.showModal(modal);
                    return;
                }
            }

            if (interaction.isModalSubmit()) {
                await interaction.deferUpdate();
                
                if (interaction.customId === 'modal_links') {
                    const parsed = parseDuration(interaction.fields.getTextInputValue('input_link_timeout'));
                    if (parsed) await updateSetting(interaction.guild, 'linkTimeout', parsed);
                    const dashboard = await generateDashboard(interaction.guildId, 2);
                    await interaction.editReply(dashboard);
                    return;
                }

                if (interaction.customId === 'modal_avoids') {
                    const rawInput = interaction.fields.getTextInputValue('input_avoids');
                    const processedList = rawInput.split(',')
                        .map(item => item.trim().toLowerCase())
                        .filter(item => item.length > 0);

                    await updateSetting(interaction.guild, 'linkAvoids', processedList);
                    const dashboard = await generateDashboard(interaction.guildId, 2);
                    await interaction.editReply(dashboard);
                    return;
                }

                if (interaction.customId === 'modal_access') {
                    const rawInput = interaction.fields.getTextInputValue('input_access');
                    const processedList = rawInput.split(',')
                        .map(item => item.trim())
                        .filter(item => item.length > 0);

                    await updateSetting(interaction.guild, 'allowedAccess', processedList);
                    const dashboard = await generateDashboard(interaction.guildId, 2);
                    await interaction.editReply(dashboard);
                    return;
                }

                if (interaction.customId === 'modal_images') {
                    const max = parseInt(interaction.fields.getTextInputValue('input_image_max'));
                    const parsedTimeout = parseDuration(interaction.fields.getTextInputValue('input_image_timeout'));
                    if (!isNaN(max) && max > 0) await updateSetting(interaction.guild, 'maxImages', max);
                    if (parsedTimeout) await updateSetting(interaction.guild, 'imageTimeout', parsedTimeout);
                    const dashboard = await generateDashboard(interaction.guildId, 2);
                    await interaction.editReply(dashboard);
                    return;
                }
            }

            if (interaction.isChannelSelectMenu() && interaction.customId === 'select_log') {
                await interaction.deferUpdate();
                await updateSetting(interaction.guild, 'logChannelId', interaction.values);
                const dashboard = await generateDashboard(interaction.guildId, 2);
                await interaction.editReply(dashboard); 
                return;
            }
        } catch (error) {}
    }
});

client.on('messageDelete', async message => {
    if (!message.guild || !message.author || message.author.bot) return; 

    const settings = await getSettings(message.guild.id);
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
    if (!message.guild) return; 
    if (message.author.bot || message.webhookId) return;
    if (message.author.id === client.user.id) return; 

    const settings = await getSettings(message.guild.id);
    if (!settings.masterSwitch) return;

    let hasBypass = message.author.id === message.guild.ownerId || (message.member && message.member.permissions.has('Administrator'));
    if (!hasBypass && settings.allowedAccess.length > 0) {
        if (settings.allowedAccess.includes(message.author.id)) hasBypass = true;
        if (message.member && message.member.roles && message.member.roles.cache.some(role => settings.allowedAccess.includes(role.id))) hasBypass = true;
    }
    
    if (hasBypass) return; 

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
                       (content.includes('@everyone') && linkRegex.test(content)) ||
                       (content.includes('@here') && linkRegex.test(content));

        if (isRaid) {
            try {
                await message.delete().catch(() => {});
                if (message.member && message.member.timeout) await message.member.timeout(86400000, 'Using Malicious Raid App Commands').catch(() => {});

                await logAction(message.guild, 'TIMEOUT', message.author.username, message.author.id, 'Malicious Raid App Activity');
                await message.channel.send(`🚨 **RAID BLOCKED:** <@${message.author.id}> tried to use a malicious raid app!`);

                const log = createLogEmbed('🛡️ Anti Raid Activated', `**Culprit:** <@${message.author.id}>\n**Action:** Message Deleted & User Timed Out for 24h.`, '#800080');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (settings.fileShieldEnabled && message.attachments.size > 0) {
        const hasDangerousFile = message.attachments.some(attachment => {
            const fileName = attachment.name.toLowerCase();
            return dangerousExtensions.some(ext => fileName.endsWith(ext));
        });

        if (hasDangerousFile) {
            try {
                await message.delete();
                if (message.member && message.member.timeout) await message.member.timeout(1440 * 60000, 'Uploading dangerous/malicious files').catch(() => {});
                
                await logAction(message.guild, 'TIMEOUT', message.author.username, message.author.id, 'Dangerous File Upload');
                await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for uploading a prohibited file type (Executable/Script).`).catch(() => {});
                
                const log = createLogEmbed('📁 File Sandbox Blocked', `**User:** <@${message.author.id}>\n**Action:** Message Deleted & Timed out (1 Day)\n**Reason:** Uploaded an executable or script file.`, '#ff0000');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (settings.linksEnabled) {
        const messageContentLower = message.content.toLowerCase();
        const isLink = linkRegex.test(message.content);
        const isAvoided = settings.linkAvoids && settings.linkAvoids.some(domain => messageContentLower.includes(domain));

        if (isLink && !isAvoided) {
            try {
                await message.delete();
                if (message.member && message.member.timeout) await message.member.timeout(settings.linkTimeout * 60000, 'Prohibited Link').catch(() => {});
                
                await logAction(message.guild, 'TIMEOUT', message.author.username, message.author.id, 'Link Spam');
                
                const log = createLogEmbed('🛡️ Link Blocked', `**User:** <@${message.author.id}>\n**Trigger:** \`Unauthorized Link\`\n**Action:** Deleted & Timed out (${formatDuration(settings.linkTimeout)})`, '#ffcc00');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return;
            } catch (e) {}
        }
    }

    if (settings.imagesEnabled && message.attachments.size >= settings.maxImages) {
        try {
            await message.delete();
            if (message.member && message.member.timeout) await message.member.timeout(settings.imageTimeout * 60000, 'Image Spam/Hacked Account').catch(() => {});
            
            await logAction(message.guild, 'TIMEOUT', message.author.username, message.author.id, 'Image Spam/Mass Upload');
            await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for sending too many images at once.`).catch(() => {});
            
            const log = createLogEmbed('🚨 Image Spam Blocked', `**User:** <@${message.author.id}>\n**Action:** Deleted & Timed out (${formatDuration(settings.imageTimeout)})`, '#ff0000');
            await targetLogChannel.send({ embeds: [log] }).catch(() => {});
        } catch (e) {}
    }
});

client.login(process.env.DISCORD_TOKEN);
