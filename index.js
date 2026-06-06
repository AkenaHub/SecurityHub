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

const CURRENT_VERSION = "v2.6.2";

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
            raidEnabled: true,
            fileShieldEnabled: true,
            logDeletedEnabled: false,
            antiNukeEnabled: false,
            logChannelId: null,
            verifyEnabled: false,
            verifyChannelId: null,
            verifyRoleIds: [],
            verifyPanelMessageId: null,
            honeypotEnabled: false,
            honeypotChannelId: null,
            honeypotAction: 'TIMEOUT',
            autoRoleEnabled: false,
            autoRoleIds: [],
            welcomeEnabled: false,
            welcomeChannelId: null,
            welcomeMessage: 'Welcome {user} to **{server}**! We are now at {membercount} members.',
            welcomeColor: '#6366f1',
            ticketEnabled: false,
            ticketPanelChannelId: null,
            ticketCategoryId: null,
            ticketMessage: 'Please click the button below to open a support ticket.',
            ticketLogs: [],
            ticketPanelMessageId: null,
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
    
    settings.history.unshift({ type, username, userId, reason, timestamp: Math.floor(Date.now() / 1000) });
    if (settings.history.length > 10) settings.history = settings.history.slice(0, 10);
    
    guildSettings[guildId] = settings;
    saveLocalDatabase();
    await saveToCloud(guildId, settings);
};

const logTicketAction = async (guildId, type, username, reason) => {
    const settings = await getSettings(guildId);
    if (!settings.ticketLogs) settings.ticketLogs = [];
    
    settings.ticketLogs.unshift({ type, username, reason, timestamp: Math.floor(Date.now() / 1000) });
    if (settings.ticketLogs.length > 15) settings.ticketLogs = settings.ticketLogs.slice(0, 15);
    
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

        const settings = await getSettings(guildId);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_user_btn').setLabel('Verify Account').setEmoji('✅').setStyle(ButtonStyle.Success)
        );
        const embed = new EmbedBuilder()
            .setTitle('🔐 Server Verification Required')
            .setDescription('Welcome to the server!\n\nTo protect our community from malicious bots and raids, we require all new members to verify their account.\n\n**Please click the ✅ Verify Account button below to gain full access to the server channels.**')
            .setColor('#6366f1').setFooter({ text: 'Secured by ServSecurity' });

        if (settings.verifyPanelMessageId) {
            try {
                const existingMsg = await channel.messages.fetch(settings.verifyPanelMessageId);
                await existingMsg.edit({ embeds: [embed], components: [row] });
                return;
            } catch (e) {} 
        }

        const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existingBtnMsg = msgs ? msgs.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components?.components?.customId === 'verify_user_btn') : null;

        if (existingBtnMsg) {
            await existingBtnMsg.edit({ embeds: [embed], components: [row] });
            await updateSetting(guildId, 'verifyPanelMessageId', existingBtnMsg.id);
            return;
        }

        const newMsg = await channel.send({ embeds: [embed], components: [row] });
        await updateSetting(guildId, 'verifyPanelMessageId', newMsg.id);

    } catch (e) { console.error(e); }
};

const setupTicketPanel = async (guildId, channelId, messageText) => {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;

        const settings = await getSettings(guildId);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_ticket_btn').setLabel('Open Ticket').setEmoji('📩').setStyle(ButtonStyle.Primary)
        );
        const embed = new EmbedBuilder()
            .setTitle('📩 Support Tickets')
            .setDescription(messageText || 'Please click the button below to open a support ticket.')
            .setColor('#6366f1').setFooter({ text: 'Secured by ServSecurity' });

        if (settings.ticketPanelMessageId) {
            try {
                const existingMsg = await channel.messages.fetch(settings.ticketPanelMessageId);
                await existingMsg.edit({ embeds: [embed], components: [row] });
                return; 
            } catch (e) {}
        }

        const newMsg = await channel.send({ embeds: [embed], components: [row] });
        await updateSetting(guildId, 'ticketPanelMessageId', newMsg.id);
        
    } catch (e) { console.error(e); }
};

const setupVerificationPermissions = async (guild, verifyChannelId, verifyRoleIds) => {
    try {
        await guild.roles.everyone.setPermissions(guild.roles.everyone.permissions.remove(PermissionFlagsBits.ViewChannel)).catch(()=>{});
        if (verifyRoleIds && verifyRoleIds.length > 0) {
            for (const roleId of verifyRoleIds) {
                const verifiedRole = guild.roles.cache.get(roleId);
                if (verifiedRole) await verifiedRole.setPermissions(verifiedRole.permissions.add(PermissionFlagsBits.ViewChannel)).catch(()=>{});
            }
        }
        const verifyChannel = guild.channels.cache.get(verifyChannelId);
        if (verifyChannel) {
            await verifyChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
                ViewChannel: true, SendMessages: false, AddReactions: false, ReadMessageHistory: true
            }).catch(()=>{});
        }
    } catch (error) { console.error("Verification Setup Error:", error); }
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
\u001b[2;32m[+]\u001b[0m Fixed "Application failed to respond" error by implementing interaction deferring mechanics.
\u001b[2;34m[!]\u001b[0m Firebase logging tasks have been successfully offloaded to background threads.
\`\`\``;

        const embed = new EmbedBuilder()
            .setTitle('🚀 System Update Deployed')
            .setColor(0x6366f1)
            .setDescription(`**Version ${CURRENT_VERSION}**\n\nThe ServSecurity Matrix has been updated. Below are the compiled changes:\n\n${ansiText}`)
            .setTimestamp()
            .setFooter({ text: 'ServSecurity Automated Changelog' });

        await channel.send({ content: '@here', embeds: [embed] });
    } catch (e) {}
};

const linkRegex = /(https?:\/\/(?!media\.discordapp\.net|cdn\.discordapp\.com)[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|org|net|io|gg|me|li|co|us|uk|info|site|xyz)(\/[^\s]*)?)/i;
const discordInviteRegex = /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)[a-zA-Z0-9]+/i;
const maliciousAppRegex = /(discord\.com\/api\/oauth2|discord\.com\/oauth2|client_id=|oauth2\/authorize)/i;
const scamRegex = /(free.*nitro|nitro.*free|steam.*(?:free|gift|premium)|discord.*(?:gift|nitro)|@everyone.*https?:\/\/|@here.*https?:\/\/|discorcl\.gift|dlscord\.gift)/i;
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];

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
            if (guild.id === '1499199296522944522') await sendChangelog(guild);
            await updateSetting(guild.id, 'lastVersion', CURRENT_VERSION);
        }
    }
});

client.on('guildMemberAdd', async member => {
    const settings = await getSettings(member.guild.id);
    if (!settings.masterSwitch) return;

    if (settings.autoRoleEnabled && settings.autoRoleIds && settings.autoRoleIds.length > 0) {
        for (const roleId of settings.autoRoleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (role) await member.roles.add(role).catch((err) => {
                console.error(`[AutoRole] Failed to assign role to ${member.user.tag}. Check bot permissions and role hierarchy! Error: ${err.message}`);
            });
        }
    }

    if (settings.welcomeEnabled && settings.welcomeChannelId) {
        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (channel) {
            let msg = settings.welcomeMessage || "Welcome {user} to **{server}**! We are now at {membercount} members.";
            msg = msg.replace(/{user}/g, `<@${member.id}>`).replace(/{username}/g, member.user.username)
                     .replace(/{server}/g, member.guild.name).replace(/{membercount}/g, member.guild.memberCount);

            const embed = new EmbedBuilder().setDescription(msg).setColor(settings.welcomeColor || '#6366f1').setTimestamp();
            const iconUrl = member.guild.iconURL({ size: 512 });
            if (iconUrl) embed.setImage(iconUrl);
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const settings = await getSettings(interaction.guildId);
        
        if (interaction.customId === 'verify_user_btn') {
            await interaction.deferReply({ ephemeral: true }); // Tell Discord to wait
            if (settings.verifyEnabled && settings.verifyRoleIds && settings.verifyRoleIds.length > 0) {
                let added = 0;
                for (const roleId of settings.verifyRoleIds) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (role) { await interaction.member.roles.add(role).catch(() => {}); added++; }
                }
                if (added > 0) await interaction.editReply({ content: '✅ You have been successfully verified!' });
                else await interaction.editReply({ content: '❌ Verification roles could not be configured. Please contact an admin.' });
            } else {
                await interaction.editReply({ content: '❌ Verification system is currently offline.' });
            }
            return;
        }

        if (interaction.customId === 'open_ticket_btn') {
            await interaction.deferReply({ ephemeral: true }); // Tell Discord to wait
            if (!settings.ticketEnabled) return interaction.editReply({ content: '❌ The ticket system is currently offline.' });
            
            try {
                const ticketChan = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: settings.ticketCategoryId || null,
                    permissionOverwrites: [
                        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });

                // Do logging in the background so it doesn't hold up the reply
                logTicketAction(interaction.guildId, 'OPENED', interaction.user.username, `Opened <#${ticketChan.id}>`).catch(console.error);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
                );
                const embed = new EmbedBuilder()
                    .setTitle(`Ticket: ${interaction.user.username}`)
                    .setDescription('Support will be with you shortly. Click the button below to close this ticket.')
                    .setColor('#6366f1');

                await ticketChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
                await interaction.editReply({ content: `✅ Ticket opened in <#${ticketChan.id}>` });
            } catch (e) {
                console.error(e);
                await interaction.editReply({ content: '❌ Failed to create ticket channel. Check bot permissions.' });
            }
            return;
        }

        if (interaction.customId === 'close_ticket_btn') {
            await interaction.reply({ content: '🔒 Ticket will automatically close in 5 seconds...', ephemeral: false });
            // Background logging
            logTicketAction(interaction.guildId, 'CLOSED', interaction.user.username, `Closed ticket ${interaction.channel.name}`).catch(console.error);
            setTimeout(() => { interaction.channel.delete().catch(()=>{}); }, 5000);
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'dashboard') {
        await interaction.deferReply({ ephemeral: true });
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
            return interaction.editReply({ content: '❌ **Access Denied:** You do not have permission to view the security panel.' });
        }

        const dashboardUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
        await interaction.editReply({ content: `🌐 **Access the ServSecurity Control Center here:**\n${dashboardUrl}` });
    }

    if (['kick', 'ban', 'timeout', 'unmute', 'role'].includes(interaction.commandName)) {
        await interaction.deferReply({ ephemeral: false }); 
        
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided by moderator.';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return interaction.editReply({ content: '❌ Could not find that user in the server.' });
        }

        try {
            if (interaction.commandName === 'kick') {
                if (!member.kickable) return interaction.editReply({ content: '❌ I do not have permission to kick this user.' });
                await member.kick(reason);
                await interaction.editReply({ content: `✅ Successfully kicked **${target.tag}**. Reason: ${reason}` });
                logAction(interaction.guildId, 'KICK', target.username, target.id, `Manual Kick: ${reason}`).catch(console.error);
            } 
            else if (interaction.commandName === 'ban') {
                if (!member.bannable) return interaction.editReply({ content: '❌ I do not have permission to ban this user.' });
                await member.ban({ reason: reason });
                await interaction.editReply({ content: `✅ Successfully banned **${target.tag}**. Reason: ${reason}` });
                logAction(interaction.guildId, 'BAN', target.username, target.id, `Manual Ban: ${reason}`).catch(console.error);
            }
            else if (interaction.commandName === 'timeout') {
                const duration = interaction.options.getInteger('duration');
                if (!member.moderatable) return interaction.editReply({ content: '❌ I do not have permission to timeout this user.' });
                await member.timeout(duration * 60000, reason);
                await interaction.editReply({ content: `✅ Successfully timed out **${target.tag}** for ${duration} minutes. Reason: ${reason}` });
                logAction(interaction.guildId, 'TIMEOUT', target.username, target.id, `Manual Timeout (${duration}m): ${reason}`).catch(console.error);
            }
            else if (interaction.commandName === 'unmute') {
                if (!member.moderatable) return interaction.editReply({ content: '❌ I do not have permission to unmute this user.' });
                await member.timeout(null, reason);
                await interaction.editReply({ content: `✅ Successfully unmuted **${target.tag}**. Reason: ${reason}` });
                logAction(interaction.guildId, 'UNMUTE', target.username, target.id, `Manual Unmute: ${reason}`).catch(console.error);
            }
            else if (interaction.commandName === 'role') {
                const role = interaction.options.getRole('role');
                if (role.position >= interaction.guild.members.me.roles.highest.position) {
                    return interaction.editReply({ content: '❌ I cannot assign a role higher than or equal to my own highest role.' });
                }
                await member.roles.add(role, reason);
                await interaction.editReply({ content: `✅ Successfully gave the role **${role.name}** to **${target.tag}**. Reason: ${reason}` });
                logAction(interaction.guildId, 'ROLE_ADD', target.username, target.id, `Assigned Role ${role.name}: ${reason}`).catch(console.error);
            }
        } catch (error) {
            console.error(error);
            interaction.editReply({ content: '❌ An error occurred while trying to execute the command.' });
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
                logAction(newGuild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Server Name Change Attempt').catch(console.error);
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
                logAction(oldChannel.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Channel Name Change Attempt').catch(console.error);
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
            logAction(channel.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Channel Deletion Attempt').catch(console.error);
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
            logAction(channel.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Channel Creation Attempt').catch(console.error);
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
            name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions, position: role.position, mentionable: role.mentionable, reason: 'Anti-Nuke: Restoring deleted role'
        }).catch(() => {});

        const member = await role.guild.members.fetch(executor.id).catch(() => null);
        if (member && member.bannable) {
            await member.ban({ reason: 'Anti-Nuke: Unauthorized Role Deletion' }).catch(() => {});
            logAction(role.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Role Deletion Attempt').catch(console.error);
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

            await newRole.edit({ name: oldRole.name, permissions: oldRole.permissions, color: oldRole.color, hoist: oldRole.hoist, mentionable: oldRole.mentionable }).catch(() => {});

            const member = await oldRole.guild.members.fetch(executor.id).catch(() => null);
            if (member && member.bannable) {
                await member.ban({ reason: 'Anti-Nuke: Unauthorized Role Modification' }).catch(() => {});
                logAction(oldRole.guild.id, 'BAN', executor.username, executor.id, 'Anti-Nuke: Role Modification Attempt').catch(console.error);
            }
        } catch (e) {}
    }
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

    if (settings.honeypotEnabled && settings.honeypotChannelId && message.channel.id === settings.honeypotChannelId) {
        if (hasBypass) return; // Admins won't be trapped
        try {
            await message.delete().catch(()=>{});
            const action = settings.honeypotAction || 'TIMEOUT';
            
            if (action === 'BAN') {
                if (message.member && message.member.bannable) await message.member.ban({ reason: 'Security Trap: Hacked Account Detection' }).catch(()=>{});
            } else if (action === 'KICK') {
                if (message.member && message.member.kickable) await message.member.kick('Security Trap: Hacked Account Detection').catch(()=>{});
            } else {
                if (message.member && message.member.moderatable) await message.member.timeout(1440 * 60000, 'Security Trap: Hacked Account Detection').catch(()=>{});
            }
            return; 
        } catch (e) {}
    }
    
    if (hasBypass) return; 

    if (settings.raidEnabled) {
        const content = message.content.toLowerCase();
        const isRaid = content.includes('﷽') || maliciousAppRegex.test(message.content) || scamRegex.test(message.content) || (content.includes('@everyone') && linkRegex.test(content)) || (content.includes('@here') && linkRegex.test(content));

        if (isRaid) {
            try {
                await message.delete().catch(() => {});
                if (message.member && message.member.moderatable) await message.member.timeout(86400000, 'Malicious Phishing/Raid Activity').catch(() => {});
                await message.channel.send(`🚨 **SECURITY ALERT:** <@${message.author.id}> tried to post a malicious phishing link or raid command!`);
                return; 
            } catch (e) {}
        }
    }

    if (settings.fileShieldEnabled && message.attachments.size > 0) {
        const hasDangerousFile = message.attachments.some(attachment => dangerousExtensions.some(ext => attachment.name.toLowerCase().endsWith(ext)));
        if (hasDangerousFile) {
            try {
                await message.delete();
                if (message.member && message.member.timeout) await message.member.timeout(1440 * 60000, 'Uploading dangerous files').catch(() => {});
                await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for uploading a prohibited file type.`).catch(() => {});
                return; 
            } catch (e) {}
        }
    }

    if (settings.linksEnabled) {
        const messageContentLower = message.content.toLowerCase();
        const isInvite = discordInviteRegex.test(message.content);
        const isAvoided = settings.linkAvoids && settings.linkAvoids.some(domain => messageContentLower.includes(domain));

        if (isInvite && !isAvoided) {
            try {
                await message.delete();
                if (message.member && message.member.timeout) await message.member.timeout(settings.linkTimeout * 60000, 'Prohibited Server Invite').catch(() => {});
                return;
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
    if (fs.existsSync(publicPath)) res.sendFile(publicPath);
    else if (fs.existsSync(rootPath)) res.sendFile(rootPath);
    else res.status(404).send("<div style='background:#050608;color:#fff;font-family:sans-serif;height:100vh;display:flex;align-items:center;justify-content:center;'><h2>System Error: Missing UI index.html</h2></div>");
});

app.get('/api/auth/login', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID?.replace(/['"]/g, '').trim();
    const redirectUri = process.env.REDIRECT_URI?.replace(/['"]/g, '').trim();
    if (!clientId || !redirectUri) return res.status(500).send("<div style='background:#050608;color:#fff;font-family:sans-serif;height:100vh;display:flex;align-items:center;justify-content:center;'><h2>Configuration Error - Missing Auth URI</h2></div>");
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
            client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: code, redirect_uri: redirectUri,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
        const guildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } });

        const adminGuilds = guildsResponse.data.filter(guild => {
            const perms = BigInt(guild.permissions);
            return (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
        }).map(g => ({ id: g.id, name: g.name, icon: g.icon }));

        req.session.user = { id: userResponse.data.id, username: userResponse.data.username, avatar: userResponse.data.avatar };
        req.session.guilds = adminGuilds;
        res.redirect('/');
    } catch (error) {
        console.error("OAuth Error:", error.response?.data || error.message);
        res.redirect('/?error=Auth_Failed');
    }
});

app.get('/api/user-data', (req, res) => {
    if (!req.session || !req.session.user) return res.json({ loggedIn: false });
    const mappedGuilds = req.session.guilds.map(guild => ({
        id: guild.id, name: guild.name, icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null, botPresent: client.guilds.cache.has(guild.id)
    }));
    res.json({ loggedIn: true, user: req.session.user, guilds: mappedGuilds, botClientId: process.env.DISCORD_CLIENT_ID?.replace(/['"]/g, '').trim() });
});

app.get('/api/discord-data/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found or bot not in guild' });

    try { await guild.members.fetch(); } catch (e) {}

    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name }));
    const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => ({ id: c.id, name: c.name }));
    const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
    const bots = guild.members.cache.filter(m => m.user.bot && m.user.id !== client.user.id).map(m => ({ id: m.user.id, name: m.user.username, avatar: m.user.avatar }));

    res.json({ channels, categories, roles, bots });
});

app.get('/api/config/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const settings = await getSettings(req.params.guildId);
    res.json(settings);
});

app.post('/api/config/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    
    const current = await getSettings(req.params.guildId);
    let newSettings = { ...current, ...req.body };
    const guild = client.guilds.cache.get(req.params.guildId);
    
    if (newSettings.honeypotChannelId === 'CREATE_NEW' && guild) {
        try {
            const newChan = await guild.channels.create({
                name: '⚠️-do-not-talk-here', type: ChannelType.GuildText, reason: 'Honeypot channel via Dashboard',
                permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }]
            });
            newSettings.honeypotChannelId = newChan.id;
        } catch (e) { newSettings.honeypotChannelId = current.honeypotChannelId || null; }
    }

    if (newSettings.ticketCategoryId === 'CREATE_NEW' && guild) {
        try {
            const newCat = await guild.channels.create({
                name: '🎫 Tickets', type: ChannelType.GuildCategory, reason: 'Ticket Category via Dashboard',
                permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
            });
            newSettings.ticketCategoryId = newCat.id;
        } catch (e) { newSettings.ticketCategoryId = current.ticketCategoryId || null; }
    }

    guildSettings[req.params.guildId] = newSettings;
    saveLocalDatabase();
    await saveToCloud(req.params.guildId, newSettings);
    
    if (newSettings.verifyEnabled && newSettings.verifyChannelId && newSettings.verifyRoleIds && newSettings.verifyRoleIds.length > 0 && guild) {
        await setupVerifyMessage(req.params.guildId, newSettings.verifyChannelId);
        await setupVerificationPermissions(guild, newSettings.verifyChannelId, newSettings.verifyRoleIds);
    }

    if (newSettings.ticketEnabled && newSettings.ticketPanelChannelId && guild) {
        await setupTicketPanel(req.params.guildId, newSettings.ticketPanelChannelId, newSettings.ticketMessage);
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
