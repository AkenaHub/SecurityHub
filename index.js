require('dotenv').config();

const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    REST, Routes, SlashCommandBuilder, AuditLogEvent, Events, PermissionFlagsBits, ChannelType
} = require('discord.js');
const express = require('express');
const cookieSession = require('cookie-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');

const CURRENT_VERSION = "v1.6.0";

process.on('unhandledRejection', error => {
    console.error('Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
});

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
let firestoreDb = null;
let firestoreReady = false;

const appId = typeof __app_id !== 'undefined' ? __app_id : (process.env.APP_ID || 'servsecurity-app');

const initRemoteStorage = async () => {
    try {
        const hasConfig = typeof __firebase_config !== 'undefined' || process.env.FIREBASE_CONFIG;
        if (!hasConfig) return;

        const config = typeof __firebase_config !== 'undefined' 
            ? JSON.parse(__firebase_config) 
            : JSON.parse(process.env.FIREBASE_CONFIG);

        const app = initializeApp(config);
        const auth = getAuth(app);
        
        const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : process.env.FIREBASE_AUTH_TOKEN;
        if (token) {
            await signInWithCustomToken(auth, token);
        } else {
            await signInAnonymously(auth);
        }

        firestoreDb = getFirestore(app);
        firestoreReady = true;
    } catch (e) {
        firestoreReady = false;
    }
};

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
        let channel = guild.channels.cache.find(c => c.name === 'servsecurity-database' && c.type === ChannelType.GuildText);
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

const saveToCloud = async (guildId, settings) => {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            let channel = guild.channels.cache.find(c => c.name === 'servsecurity-database' && c.type === ChannelType.GuildText);
            if (!channel) {
                channel = await guild.channels.create({
                    name: 'servsecurity-database',
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
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

            if (dbMessage) await dbMessage.edit(payload);
            else await channel.send(payload);
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
            allowedBots: [],
            imagesEnabled: true,
            maxImages: 1,
            imageTimeout: 4320,
            raidEnabled: true,
            fileShieldEnabled: true,
            logDeletedEnabled: false,
            antiNukeEnabled: false,
            spamShieldEnabled: false,
            logChannelId: null,
            verifyEnabled: false,
            verifyChannelId: null,
            verifyRoleId: null,
            lastVersion: null,
            history: []
        };
        saveLocalDatabase();
    }
    return guildSettings[guildId];
};

const updateSetting = async (guildId, key, value) => {
    const settings = await getSettings(guildId);
    settings[key] = value;
    guildSettings[guildId] = settings;
    saveLocalDatabase();
    await saveToCloud(guildId, settings);
};

const logAction = async (guildId, type, username, userId, reason) => {
    const settings = await getSettings(guildId);
    if (!settings.history) settings.history = [];
    
    settings.history.unshift({
        type,
        username,
        userId,
        reason,
        timestamp: Math.floor(Date.now() / 1000)
    });

    if (settings.history.length > 10) settings.history = settings.history.slice(0, 10);
    
    guildSettings[guildId] = settings;
    saveLocalDatabase();
    await saveToCloud(guildId, settings);
};

const setupVerifyMessage = async (guildId, channelId) => {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;

        const msgs = await channel.messages.fetch({ limit: 10 }).catch(() => null);
        if (msgs && msgs.some(m => m.author.id === client.user.id && m.components.length > 0)) return;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_user_btn')
                    .setLabel('Verify Account')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success)
            );
            
        const embed = new EmbedBuilder()
            .setTitle('🔐 Server Verification')
            .setDescription('Welcome! To gain access to the rest of the server, please click the verification button below. This ensures you are a real user and helps protect our community from bots.')
            .setColor('#4f46e5');

        await channel.send({ embeds: [embed], components: [row] }).catch(console.error);
    } catch (e) {
        console.error(e);
    }
};

const sendChangelog = async (guild) => {
    if (guild.id !== '1499199296522944522') return;

    try {
        let channel = guild.channels.cache.find(c => c.name === 'bot-changelog' && c.type === ChannelType.GuildText);
        if (!channel) {
            channel = await guild.channels.create({
                name: 'bot-changelog',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.AddReactions] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
                ]
            });
        }

        const ansiText = `\`\`\`ansi
\u001b[2;32m[+]\u001b[0m Added Button Verification System module to the dashboard.
\u001b[2;32m[+]\u001b[0m Added /kick, /ban, and /timeout slash moderation commands.
\`\`\``;

        const embed = new EmbedBuilder()
            .setTitle('🚀 System Update Deployed')
            .setColor(0x4f46e5)
            .setDescription(`**Version ${CURRENT_VERSION}**\n\nThe ServSecurity Matrix has been updated. Below are the compiled changes:\n\n${ansiText}`)
            .setTimestamp()
            .setFooter({ text: 'ServSecurity Automated Changelog' });

        await channel.send({ content: '@here', embeds: [embed] });
    } catch (e) {}
};

const linkRegex = /(https?:\/\/(?!media\.discordapp\.net|cdn\.discordapp\.com)[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|org|net|io|gg|me|li|co|us|uk|info|site|xyz)(\/[^\s]*)?)/i;
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];
const imageMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const userMessageCache = new Map();

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadLocalDatabase();
    await initRemoteStorage();

    for (const [id, guild] of client.guilds.cache) {
        await syncWithDiscord(guild);
        const settings = await getSettings(guild.id);
        
        if (settings.lastVersion !== CURRENT_VERSION) {
            if (guild.id === '1499199296522944522') {
                await sendChangelog(guild);
            }
            await updateSetting(guild.id, 'lastVersion', CURRENT_VERSION);
        }
    }
});

client.on('interactionCreate', async interaction => {
    // Handle Verification Button
    if (interaction.isButton() && interaction.customId === 'verify_user_btn') {
        const settings = await getSettings(interaction.guildId);
        if (settings.verifyEnabled && settings.verifyRoleId) {
            const role = interaction.guild.roles.cache.get(settings.verifyRoleId);
            if (role) {
                await interaction.member.roles.add(role).catch(() => {});
                await interaction.reply({ content: '✅ You have been successfully verified!', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Verification role not found. Please contact a server admin.', ephemeral: true });
            }
        } else {
            await interaction.reply({ content: '❌ Verification system is currently offline.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'dashboard') {
        const settings = await getSettings(interaction.guildId);
        const allowedUserId = '1284247278957367337';
        const isServerOwner = interaction.user.id === interaction.guild?.ownerId;
        const isWhitelistedUser = interaction.user.id === allowedUserId;
        const isAdmin = interaction.member?.permissions.has('Administrator');
        
        let hasAccess = isServerOwner || isWhitelistedUser || isAdmin;

        if (!hasAccess && settings.allowedAccess && settings.allowedAccess.length > 0) {
            if (settings.allowedAccess.includes(interaction.user.id)) hasAccess = true;
            if (interaction.member && interaction.member.roles && interaction.member.roles.cache.some(role => settings.allowedAccess.includes(role.id))) hasAccess = true;
        }

        if (!hasAccess) {
            return interaction.reply({ content: '❌ **Access Denied:** You do not have permission to view the security panel.', ephemeral: true });
        }

        const dashboardUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
        await interaction.reply({ content: `🌐 **Access the ServSecurity Control Center here:**\n${dashboardUrl}`, ephemeral: true });
    }

    // Moderation Commands
    if (interaction.commandName === 'kick' || interaction.commandName === 'ban' || interaction.commandName === 'timeout') {
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided by moderator.';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return interaction.reply({ content: '❌ Could not find that user in the server.', ephemeral: true });
        }

        try {
            if (interaction.commandName === 'kick') {
                if (!member.kickable) return interaction.reply({ content: '❌ I do not have permission to kick this user.', ephemeral: true });
                await member.kick(reason);
                await interaction.reply({ content: `✅ Successfully kicked **${target.tag}**. Reason: ${reason}` });
                await logAction(interaction.guildId, 'KICK', target.username, target.id, `Manual Kick: ${reason}`);
            } 
            else if (interaction.commandName === 'ban') {
                if (!member.bannable) return interaction.reply({ content: '❌ I do not have permission to ban this user.', ephemeral: true });
                await member.ban({ reason: reason });
                await interaction.reply({ content: `✅ Successfully banned **${target.tag}**. Reason: ${reason}` });
                await logAction(interaction.guildId, 'BAN', target.username, target.id, `Manual Ban: ${reason}`);
            }
            else if (interaction.commandName === 'timeout') {
                const duration = interaction.options.getInteger('duration');
                if (!member.moderatable) return interaction.reply({ content: '❌ I do not have permission to timeout this user.', ephemeral: true });
                await member.timeout(duration * 60000, reason);
                await interaction.reply({ content: `✅ Successfully timed out **${target.tag}** for ${duration} minutes. Reason: ${reason}` });
                await logAction(interaction.guildId, 'TIMEOUT', target.username, target.id, `Manual Timeout (${duration}m): ${reason}`);
            }
        } catch (error) {
            console.error(error);
            interaction.reply({ content: '❌ An error occurred while trying to execute the command.', ephemeral: true });
        }
    }
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const settings = await getSettings(newGuild.id);
    if (!settings.masterSwitch || !settings.antiNukeEnabled) return;
    
    if (oldGuild.name !== newGuild.name) {
        try {
            const fetchedLogs = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate });
            const auditEntry = fetchedLogs.entries.first();
            if (!auditEntry) return;

            const executor = auditEntry.executor;
            if (executor.id === client.user.id || !executor.bot) return;
            if (settings.allowedBots && settings.allowedBots.includes(executor.id)) return;

            await newGuild.setName(oldGuild.name).catch(() => {});

            const member = await newGuild.members.fetch(executor.id).catch(() => null);
            if (member && member.bannable) {
                await member.ban({ reason: 'Anti-Nuke: Unauthorized Server Modification' }).catch(() => {});
                await logAction(newGuild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Server Name Change Attempt');
                
                if (settings.logChannelId) {
                    const logChannel = await newGuild.channels.fetch(settings.logChannelId).catch(()=>null);
                    if (logChannel) {
                        const log = createLogEmbed('☢️ Anti-Nuke Activated', `**Culprit:** <@${executor.id}>\n**Action:** Bot Banned & Changes Reverted\n**Reason:** Attempted to change server name.`, '#ff0000');
                        await logChannel.send({ embeds: [log] }).catch(() => {});
                    }
                }
            }
        } catch (e) {}
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!oldChannel.guild) return;
    const settings = await getSettings(oldChannel.guild.id);
    if (!settings.masterSwitch || !settings.antiNukeEnabled) return;

    if (oldChannel.name !== newChannel.name) {
        try {
            const fetchedLogs = await oldChannel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelUpdate });
            const auditEntry = fetchedLogs.entries.first();
            if (!auditEntry) return;

            const executor = auditEntry.executor;
            if (executor.id === client.user.id || !executor.bot) return;
            if (settings.allowedBots && settings.allowedBots.includes(executor.id)) return;

            await newChannel.setName(oldChannel.name).catch(() => {});

            const member = await oldChannel.guild.members.fetch(executor.id).catch(() => null);
            if (member && member.bannable) {
                await member.ban({ reason: 'Anti-Nuke: Unauthorized Channel Modification' }).catch(() => {});
                await logAction(oldChannel.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Channel Name Change Attempt');

                if (settings.logChannelId) {
                    const logChannel = await oldChannel.guild.channels.fetch(settings.logChannelId).catch(()=>null);
                    if (logChannel) {
                        const log = createLogEmbed('☢️ Anti-Nuke Activated', `**Culprit:** <@${executor.id}>\n**Action:** Bot Banned & Changes Reverted\n**Reason:** Attempted to change channel name.`, '#ff0000');
                        await logChannel.send({ embeds: [log] }).catch(() => {});
                    }
                }
            }
        } catch (e) {}
    }
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const settings = await getSettings(channel.guild.id);
    if (!settings.masterSwitch || !settings.antiNukeEnabled) return;

    try {
        const fetchedLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
        const auditEntry = fetchedLogs.entries.first();
        if (!auditEntry) return;

        const executor = auditEntry.executor;
        if (executor.id === client.user.id || !executor.bot) return;
        if (settings.allowedBots && settings.allowedBots.includes(executor.id)) return;

        await channel.clone().catch(()=>{});

        const member = await channel.guild.members.fetch(executor.id).catch(() => null);
        if (member && member.bannable) {
            await member.ban({ reason: 'Anti-Nuke: Unauthorized Channel Deletion' }).catch(() => {});
            await logAction(channel.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Channel Deletion Attempt');

            if (settings.logChannelId) {
                const logChannel = await channel.guild.channels.fetch(settings.logChannelId).catch(()=>null);
                if (logChannel) {
                    const log = createLogEmbed('☢️ Anti-Nuke Activated', `**Culprit:** <@${executor.id}>\n**Action:** Bot Banned & Channel Restored\n**Reason:** Attempted to delete channel.`, '#ff0000');
                    await logChannel.send({ embeds: [log] }).catch(() => {});
                }
            }
        }
    } catch (e) {}
});

client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const settings = await getSettings(channel.guild.id);
    if (!settings.masterSwitch || !settings.antiNukeEnabled) return;

    try {
        const fetchedLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate });
        const auditEntry = fetchedLogs.entries.first();
        if (!auditEntry) return;

        const executor = auditEntry.executor;
        if (executor.id === client.user.id || !executor.bot) return;
        if (settings.allowedBots && settings.allowedBots.includes(executor.id)) return;

        await channel.delete().catch(()=>{});

        const member = await channel.guild.members.fetch(executor.id).catch(() => null);
        if (member && member.bannable) {
            await member.ban({ reason: 'Anti-Nuke: Unauthorized Channel Creation' }).catch(() => {});
            await logAction(channel.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Channel Creation Attempt');

            if (settings.logChannelId) {
                const logChannel = await channel.guild.channels.fetch(settings.logChannelId).catch(()=>null);
                if (logChannel) {
                    const log = createLogEmbed('☢️ Anti-Nuke Activated', `**Culprit:** <@${executor.id}>\n**Action:** Bot Banned & Channel Deleted\n**Reason:** Attempted to create channel.`, '#ff0000');
                    await logChannel.send({ embeds: [log] }).catch(() => {});
                }
            }
        }
    } catch (e) {}
});

client.on('roleDelete', async role => {
    if (!role.guild) return;
    const settings = await getSettings(role.guild.id);
    if (!settings.masterSwitch || !settings.antiNukeEnabled) return;

    try {
        const fetchedLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete });
        const auditEntry = fetchedLogs.entries.first();
        if (!auditEntry) return;

        const executor = auditEntry.executor;
        if (executor.id === client.user.id || !executor.bot) return;
        if (settings.allowedBots && settings.allowedBots.includes(executor.id)) return;

        await role.guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            position: role.position,
            mentionable: role.mentionable,
            reason: 'Anti-Nuke: Restoring deleted role'
        }).catch(() => {});

        const member = await role.guild.members.fetch(executor.id).catch(() => null);
        if (member && member.bannable) {
            await member.ban({ reason: 'Anti-Nuke: Unauthorized Role Deletion' }).catch(() => {});
            await logAction(role.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Role Deletion Attempt');

            if (settings.logChannelId) {
                const logChannel = await role.guild.channels.fetch(settings.logChannelId).catch(()=>null);
                if (logChannel) {
                    const log = createLogEmbed('☢️ Anti-Nuke Activated', `**Culprit:** <@${executor.id}>\n**Action:** Bot Banned & Role Restored\n**Reason:** Attempted to delete a role.`, '#ff0000');
                    await logChannel.send({ embeds: [log] }).catch(() => {});
                }
            }
        }
    } catch (e) {}
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (!oldRole.guild) return;
    const settings = await getSettings(oldRole.guild.id);
    if (!settings.masterSwitch || !settings.antiNukeEnabled) return;

    if (oldRole.name !== newRole.name || oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        try {
            const fetchedLogs = await oldRole.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate });
            const auditEntry = fetchedLogs.entries.first();
            if (!auditEntry) return;

            const executor = auditEntry.executor;
            if (executor.id === client.user.id || !executor.bot) return;
            if (settings.allowedBots && settings.allowedBots.includes(executor.id)) return;

            await newRole.edit({
                name: oldRole.name,
                permissions: oldRole.permissions,
                color: oldRole.color,
                hoist: oldRole.hoist,
                mentionable: oldRole.mentionable
            }).catch(() => {});

            const member = await oldRole.guild.members.fetch(executor.id).catch(() => null);
            if (member && member.bannable) {
                await member.ban({ reason: 'Anti-Nuke: Unauthorized Role Modification' }).catch(() => {});
                await logAction(oldRole.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Role Modification Attempt');

                if (settings.logChannelId) {
                    const logChannel = await oldRole.guild.channels.fetch(settings.logChannelId).catch(()=>null);
                    if (logChannel) {
                        const log = createLogEmbed('☢️ Anti-Nuke Activated', `**Culprit:** <@${executor.id}>\n**Action:** Bot Banned & Changes Reverted\n**Reason:** Attempted to modify role permissions/name.`, '#ff0000');
                        await logChannel.send({ embeds: [log] }).catch(() => {});
                    }
                }
            }
        } catch (e) {}
    }
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
        await logAction(guild.id, actionType, target.username || target.tag, target.id, reason);

        if (settings.logChannelId) {
            try {
                const logChannel = await guild.channels.fetch(settings.logChannelId);
                if (logChannel) {
                    const embed = createLogEmbed(`🔨 Manual ${actionType} Executed`, `**Target User:** <@${target.id}> (${target.id})\n**Moderator:** <@${executor.id}>\n**Reason:** ${reason}`, color);
                    await logChannel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}
        }
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
    if (!message.guild || message.author.bot || message.webhookId || message.author.id === client.user.id) return; 

    if (message.author.id === '1284247278957367337') return;

    const settings = await getSettings(message.guild.id);
    if (!settings.masterSwitch) return;

    let hasBypass = message.author.id === message.guild.ownerId || (message.member && message.member.permissions.has('Administrator'));
    if (!hasBypass && settings.allowedAccess && settings.allowedAccess.length > 0) {
        if (settings.allowedAccess.includes(message.author.id)) hasBypass = true;
        if (message.member && message.member.roles && message.member.roles.cache.some(role => settings.allowedAccess.includes(role.id))) hasBypass = true;
    }
    
    if (hasBypass) return; 

    if (settings.spamShieldEnabled) {
        const key = `${message.guild.id}-${message.author.id}`;
        const now = Date.now();
        if (!userMessageCache.has(key)) userMessageCache.set(key, []);
        const timestamps = userMessageCache.get(key);
        timestamps.push(now);
        
        while (timestamps.length > 0 && timestamps < now - 5000) timestamps.shift();
        
        if (timestamps.length === 0) {
            userMessageCache.delete(key);
        } else if (timestamps.length >= 6) {
            userMessageCache.delete(key);
            try {
                if (message.member && message.member.timeout) await message.member.timeout(10 * 60000, 'Text Spamming').catch(() => {});
                await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Rapid Text Spam');
                
                if (settings.logChannelId) {
                    let spamLogChannel = message.guild.channels.cache.get(settings.logChannelId);
                    const log = createLogEmbed('🛡️ Anti Spam Activated', `**User:** <@${message.author.id}>\n**Action:** Timed out (10 Minutes)\n**Reason:** Sending messages too quickly.`, '#ffcc00');
                    if (spamLogChannel) await spamLogChannel.send({ embeds: [log] }).catch(() => {});
                }
                
                await message.delete().catch(() => {});
                return;
            } catch (e) {}
        }
    }

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
                await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Malicious Raid App Activity');
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
                if (message.member && message.member.timeout) await message.member.timeout(1440 * 60000, 'Uploading dangerous files').catch(() => {});
                await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Dangerous File Upload');
                await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for uploading a prohibited file type.`).catch(() => {});
                const log = createLogEmbed('📁 Anti File Blocked', `**User:** <@${message.author.id}>\n**Action:** Message Deleted & Timed out (1 Day)\n**Reason:** Uploaded an executable or script file.`, '#ff0000');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (settings.linksEnabled) {
        const messageContentLower = message.content.toLowerCase();
        
        const isTenorGif = messageContentLower.includes('tenor.com/view') || messageContentLower.includes('giphy.com/gifs');
        const isLink = linkRegex.test(message.content);
        const isAvoided = settings.linkAvoids && settings.linkAvoids.some(domain => messageContentLower.includes(domain));

        if (isLink && !isAvoided && !isTenorGif) {
            try {
                await message.delete();
                if (message.member && message.member.timeout) await message.member.timeout(settings.linkTimeout * 60000, 'Prohibited Link').catch(() => {});
                await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Link Spam');
                const log = createLogEmbed('🛡️ Anti Link Blocked', `**User:** <@${message.author.id}>\n**Trigger:** \`Unauthorized Link\`\n**Action:** Deleted & Timed out (${settings.linkTimeout}m)`, '#ffcc00');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return;
            } catch (e) {}
        }
    }

    if (settings.imagesEnabled && message.attachments.size > 0) {
        const isImageOrGif = message.attachments.every(attachment => {
            if (!attachment.contentType) return false;
            return imageMimeTypes.some(type => attachment.contentType.startsWith(type));
        });

        if (isImageOrGif && message.attachments.size >= settings.maxImages) {
            try {
                await message.delete();
                if (message.member && message.member.timeout) await message.member.timeout(settings.imageTimeout * 60000, 'Image/GIF Spam').catch(() => {});
                await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Image/GIF Spam');
                await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for sending too many images/GIFs at once.`).catch(() => {});
                const log = createLogEmbed('🚨 Anti Image & GIF Blocked', `**User:** <@${message.author.id}>\n**Action:** Deleted & Timed out (${settings.imageTimeout}m)`, '#ff0000');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
            } catch (e) {}
        }
    }
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const usingHttps = process.env.PUBLIC_URL && process.env.PUBLIC_URL.startsWith('https');

app.use(cookieSession({
    name: 'servsecurity.sid',
    keys: [process.env.SESSION_SECRET || 'servsecurity-key-12345'],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: usingHttps,
    sameSite: usingHttps ? 'none' : 'lax'
}));

app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    
    if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else {
        res.status(404).send("<div style='background:#000;color:#fff;font-family:sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;'><h2>System Error: Missing UI</h2><p>The server is running, but it cannot find your <code>index.html</code> file.</p></div>");
    }
});

app.get('/api/auth/login', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID?.replace(/['"]/g, '').trim();
    const redirectUri = process.env.REDIRECT_URI?.replace(/['"]/g, '').trim();
    
    if (!clientId || !redirectUri) return res.status(500).send("<div style='background:#000;color:#fff;font-family:sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;'><h2>Configuration Error</h2><p>You are missing the <code>REDIRECT_URI</code> or <code>DISCORD_CLIENT_ID</code> variable in your Railway variables.</p></div>");
    
    const authorizeUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds`;
    res.redirect(authorizeUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=No_code');

    try {
        const clientId = process.env.DISCORD_CLIENT_ID?.replace(/['"]/g, '').trim();
        const clientSecret = process.env.DISCORD_CLIENT_SECRET?.replace(/['"]/g, '').trim();
        const redirectUri = process.env.REDIRECT_URI?.replace(/['"]/g, '').trim();

        const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
        const guildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } });

        const adminGuilds = guildsResponse.data.filter(guild => {
            const perms = BigInt(guild.permissions);
            return (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
        }).map(g => ({
            id: g.id,
            name: g.name,
            icon: g.icon
        }));

        req.session.user = {
            id: userResponse.data.id,
            username: userResponse.data.username,
            avatar: userResponse.data.avatar
        };
        req.session.guilds = adminGuilds;

        res.redirect('/');
    } catch (error) {
        console.error("OAuth Error:", error.response?.data || error.message);
        console.log("-> Please verify DISCORD_CLIENT_SECRET exactly matches the Developer Portal, and you haven't recently reset it.");
        res.redirect('/?error=Auth_Failed');
    }
});

app.get('/api/user-data', (req, res) => {
    if (!req.session || !req.session.user) return res.json({ loggedIn: false });

    const mappedGuilds = req.session.guilds.map(guild => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
        botPresent: client.guilds.cache.has(guild.id)
    }));

    res.json({
        loggedIn: true,
        user: req.session.user,
        guilds: mappedGuilds,
        botClientId: process.env.DISCORD_CLIENT_ID?.replace(/['"]/g, '').trim()
    });
});

app.get('/api/discord-data/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found or bot not in guild' });

    try { await guild.members.fetch(); } catch (e) {}

    const channels = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .map(c => ({ id: c.id, name: c.name }));

    const roles = guild.roles.cache
        .filter(r => r.name !== '@everyone' && !r.managed)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

    const bots = guild.members.cache
        .filter(m => m.user.bot && m.user.id !== client.user.id)
        .map(m => ({ id: m.user.id, name: m.user.username, avatar: m.user.avatar }));

    res.json({ channels, roles, bots });
});

app.get('/api/config/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const settings = await getSettings(req.params.guildId);
    res.json(settings);
});

app.post('/api/config/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    
    const current = await getSettings(req.params.guildId);
    const newSettings = { ...current, ...req.body };
    
    guildSettings[req.params.guildId] = newSettings;
    saveLocalDatabase();
    await saveToCloud(req.params.guildId, newSettings);
    
    // Check if we need to send the verification setup message
    if (newSettings.verifyEnabled && newSettings.verifyChannelId && newSettings.verifyRoleId) {
        await setupVerifyMessage(req.params.guildId, newSettings.verifyChannelId);
    }
    
    res.json({ success: true, config: newSettings });
});

app.get('/api/auth/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN).catch(() => {});
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web Dashboard active on port ${PORT}`));
