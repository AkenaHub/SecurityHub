require('dotenv').config();

const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    REST, Routes, SlashCommandBuilder, AuditLogEvent, Events, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const express = require('express');
const cookieSession = require('cookie-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');

const CURRENT_VERSION = "v3.2.1";

process.on('unhandledRejection', error => { console.error('Unhandled Promise Rejection:', error); });
process.on('uncaughtException', error => { console.error('Uncaught Exception:', error); });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const dbFile = './database.json';
let guildSettings = {};
let firestoreDb = null;

const pendingBackups = new Map();

const initRemoteStorage = async () => {
    try {
        const configStr = typeof __firebase_config !== 'undefined' ? __firebase_config : process.env.FIREBASE_CONFIG;
        if (!configStr) return;
        const config = JSON.parse(configStr);
        const fbApp = initializeApp(config);
        const auth = getAuth(fbApp);
        const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : process.env.FIREBASE_AUTH_TOKEN;
        if (token) await signInWithCustomToken(auth, token); else await signInAnonymously(auth);
        firestoreDb = getFirestore(fbApp);
    } catch (e) {}
};

const loadLocalDatabase = () => { if (fs.existsSync(dbFile)) { try { guildSettings = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch (e) { guildSettings = {}; } } };
const saveLocalDatabase = () => { try { fs.writeFileSync(dbFile, JSON.stringify(guildSettings, null, 4)); } catch (e) {} };

const syncWithDiscord = async (guild) => {
    try {
        let channel = guild.channels.cache.find(c => c.name === 'servsecurity-database' && c.type === ChannelType.GuildText);
        if (!channel) return;
        const messages = await channel.messages.fetch({ limit: 10 });
        const dbMessage = messages.find(m => m.author.id === client.user.id && m.content.startsWith('```json'));
        if (dbMessage) { guildSettings[guild.id] = JSON.parse(dbMessage.content.replace(/```json|```/g, '').trim()); saveLocalDatabase(); }
    } catch (e) {}
};

const saveToCloud = async (guildId, settings) => {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            let channel = guild.channels.cache.find(c => c.name === 'servsecurity-database' && c.type === ChannelType.GuildText);
            if (!channel) {
                channel = await guild.channels.create({
                    name: 'servsecurity-database', type: ChannelType.GuildText,
                    permissionOverwrites: [ { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] } ]
                });
            }
            const messages = await channel.messages.fetch({ limit: 10 });
            const dbMessage = messages.find(m => m.author.id === client.user.id && m.content.startsWith('```json'));
            let payload = `\`\`\`json\n${JSON.stringify(settings)}\n\`\`\``;
            if (payload.length > 1950) { settings.history = settings.history.slice(0, 4); payload = `\`\`\`json\n${JSON.stringify(settings)}\n\`\`\``; }
            if (dbMessage) await dbMessage.edit(payload); else await channel.send(payload);
        }
    } catch (e) {}
};

const getSettings = async (guildId) => {
    if (!guildSettings[guildId]) {
        guildSettings[guildId] = {
            masterSwitch: true, linksEnabled: true, linkTimeout: 30, linkAvoids: [], allowedAccess: [], allowedBots: [], raidEnabled: true, fileShieldEnabled: true, logDeletedEnabled: false, antiNukeEnabled: false, logChannelId: null, ticketLogChannelId: null, verifyEnabled: false, verifyChannelId: null, verifyRoleIds: [], verifyPanelMessageId: null, honeypotEnabled: false, honeypotChannelId: null, honeypotAction: 'TIMEOUT', autoRoleEnabled: false, autoRoleIds: [], welcomeEnabled: false, welcomeChannelId: null, welcomeMessage: 'Welcome {user} to **{server}**! We are now at {membercount} members.', welcomeColor: '#6366f1', welcomeImageType: 'icon', welcomeCustomImageUrl: '', ticketEnabled: false, ticketPanelChannelId: null, ticketCategoryId: null, ticketMessage: 'Please click the button below to open a support ticket.', ticketLogs: [], ticketPanelMessageId: null, lastVersion: null, history: [],
            joinHistory: {}, verifiedUsers: [], autoRestoreRolesEnabled: false, autoRestoreSourceGuildId: null
        };
        saveLocalDatabase();
    }
    if(!guildSettings[guildId].joinHistory) guildSettings[guildId].joinHistory = {};
    if(!guildSettings[guildId].verifiedUsers) guildSettings[guildId].verifiedUsers = [];
    return guildSettings[guildId];
};

const updateSetting = async (guildId, key, value) => { const settings = await getSettings(guildId); settings[key] = value; guildSettings[guildId] = settings; saveLocalDatabase(); await saveToCloud(guildId, settings); };

const logAction = async (guildId, type, username, userId, reason) => {
    const settings = await getSettings(guildId);
    settings.history.unshift({ type, username, userId, reason, timestamp: Math.floor(Date.now() / 1000) });
    if (settings.history.length > 10) settings.history = settings.history.slice(0, 10);
    guildSettings[guildId] = settings; saveLocalDatabase(); await saveToCloud(guildId, settings);
};

const logTicketAction = async (guildId, type, username, reason) => {
    const settings = await getSettings(guildId);
    settings.ticketLogs.unshift({ type, username, reason, timestamp: Math.floor(Date.now() / 1000) });
    if (settings.ticketLogs.length > 15) settings.ticketLogs = settings.ticketLogs.slice(0, 15);
    guildSettings[guildId] = settings; saveLocalDatabase(); await saveToCloud(guildId, settings);
    
    if (settings.ticketLogChannelId) {
        try {
            const guild = client.guilds.cache.get(guildId);
            const chan = guild?.channels.cache.get(settings.ticketLogChannelId);
            if (chan) {
                const embed = new EmbedBuilder()
                    .setTitle(`🎫 Ticket Log Event - ${type}`)
                    .setDescription(`**Moderator/Member:** ${username}\n**Context:** ${reason}`)
                    .setColor('#6366f1')
                    .setTimestamp();
                await chan.send({ embeds: [embed] }).catch(()=>{});
            }
        } catch(e) {}
    }
};

const setupVerifyMessage = async (guildId, channelId) => {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild || !channelId) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;

        const settings = await getSettings(guildId);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user_btn').setLabel('Verify Account').setEmoji('✅').setStyle(ButtonStyle.Success));
        const embed = new EmbedBuilder().setTitle('🔐 Server Verification Required').setDescription('Welcome to the server!\n\nTo protect our community from malicious bots and raids, we require all new members to verify their account.\n\n**Please click the ✅ Verify Account button below to gain full access to the server channels.**').setColor('#6366f1').setFooter({ text: 'Secured by ServSecurity' });

        if (settings.verifyPanelMessageId) {
            try { const existingMsg = await channel.messages.fetch(settings.verifyPanelMessageId); await existingMsg.edit({ embeds: [embed], components: [row] }); return; } catch (e) {} 
        }

        const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existingBtnMsg = msgs ? msgs.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components?.components?.customId === 'verify_user_btn') : null;

        if (existingBtnMsg) { await existingBtnMsg.edit({ embeds: [embed], components: [row] }); await updateSetting(guildId, 'verifyPanelMessageId', existingBtnMsg.id); return; }

        const newMsg = await channel.send({ embeds: [embed], components: [row] });
        await updateSetting(guildId, 'verifyPanelMessageId', newMsg.id);
    } catch (e) { console.error(e); }
};

const setupTicketPanel = async (guildId, channelId, messageText) => {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild || !channelId) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;

        const settings = await getSettings(guildId);
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_type_dropdown')
            .setPlaceholder('Select Ticket Support Type...')
            .addOptions([
                { label: 'Purchase Support', value: 'Purchase', description: 'Billing, store purchases, and checkout help.' },
                { label: 'General Assistance', value: 'Support', description: 'Ask questions or report members.' },
                { label: 'Bug Reporting', value: 'Bug Report', description: 'Report technical errors directly.' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = new EmbedBuilder().setTitle('📩 Support Tickets').setDescription(messageText || 'Please click the dropdown menu below to select your ticket type.').setColor('#6366f1').setFooter({ text: 'Secured by ServSecurity' });

        if (settings.ticketPanelMessageId) {
            try { const existingMsg = await channel.messages.fetch(settings.ticketPanelMessageId); await existingMsg.edit({ embeds: [embed], components: [row] }); return; } catch (e) {}
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
        if (!channel) { channel = await guild.channels.create({ name: 'bot-changelog', type: ChannelType.GuildText, permissionOverwrites: [ { id: guild.id, deny: [PermissionFlagsBits.SendMessages] }, { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] } ] }); }

        const ansiText = `\`\`\`ansi
\u001b[2;32m[+]\u001b[0m Resolved undefined variable reference in /syncallroles command.
\u001b[2;34m[!]\u001b[0m Enhanced application startup health checks to prevent immediate crash loops on Railway.
\`\`\``;

        const embed = new EmbedBuilder().setTitle('🚀 System Update Deployed').setColor(0x6366f1).setDescription(`**Version ${CURRENT_VERSION}**\n\nThe ServSecurity Matrix has been updated. Below are the compiled changes:\n\n${ansiText}`).setTimestamp().setFooter({ text: 'ServSecurity Automated Changelog' });
        await channel.send({ content: '@here', embeds: [embed] });
    } catch (e) {}
};

// Expanded invite pattern capturing raw formats: gg/code, gg.code, discord.gg/code, discord.com/invite/code, etc.
const linkRegex = /(https?:\/\/(?!media\.discordapp\.net|cdn\.discordapp\.com)[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|org|net|io|gg|me|li|co|us|uk|info|site|xyz)(\/[^\s]*)?)/i;
const discordInviteRegex = /(?:discord\.(?:gg|com\/invite)\/|discordapp\.com\/invite\/|gg\/|gg\.)([a-zA-Z0-9\-]{2,32})/i;
const scamRegex = /(free.*nitro|nitro.*free|steam.*(?:free|gift|premium)|discord.*(?:gift|nitro)|@everyone.*https?:\/\/|@here.*https?:\/\/|discorcl\.gift|dlscord\.gift|client_id=|oauth2\/authorize)/i;
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadLocalDatabase();
    await initRemoteStorage();

    const commands = [
        new SlashCommandBuilder().setName('dashboard').setDescription('Open the ServSecurity web dashboard'),
        new SlashCommandBuilder().setName('kick').setDescription('Kick a user').addUserOption(o => o.setName('target').setDescription('User to kick').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('ban').setDescription('Ban a user').addUserOption(o => o.setName('target').setDescription('User to ban').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('timeout').setDescription('Timeout a user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('duration').setDescription('Minutes').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('role').setDescription('Give a role to a user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
        new SlashCommandBuilder().setName('massrole').setDescription('Give a role to EVERYONE').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
        new SlashCommandBuilder().setName('purge').setDescription('Delete bulk messages').addIntegerOption(o => o.setName('amount').setDescription('Number of messages').setRequired(true).setMaxValue(100)),
        new SlashCommandBuilder().setName('lock').setDescription('Lock the current channel from @everyone'),
        new SlashCommandBuilder().setName('restoreroles').setDescription('Restore a user\'s roles from another server.').addUserOption(o => o.setName('target').setDescription('The user').setRequired(true)).addStringOption(o => o.setName('source_server_id').setDescription('ID of the main server').setRequired(true)),
        new SlashCommandBuilder().setName('syncallroles').setDescription('Restore roles for ALL users from another server.').addStringOption(o => o.setName('source_server_id').setDescription('ID of the main server').setRequired(true))
    ];
    await client.application.commands.set(commands).catch(console.error);

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
    if (pendingBackups.has(member.guild.id)) {
        if (member.id === pendingBackups.get(member.guild.id)) {
            try {
                const adminRole = await member.guild.roles.create({
                    name: 'Server Owner',
                    permissions: [PermissionFlagsBits.Administrator],
                    color: '#10b981',
                    hoist: true
                });
                await member.roles.add(adminRole);
                pendingBackups.delete(member.guild.id);
                await member.send(`🎉 **Welcome to your Backup Server!**\nBecause you created this server via the ServSecurity dashboard, I have automatically granted you an \`Administrator\` role!`).catch(()=>{});
            } catch(e) { console.error(e); }
        }
    }

    const settings = await getSettings(member.guild.id);
    
    const today = new Date().toISOString().split('T');
    if(!settings.joinHistory) settings.joinHistory = {};
    settings.joinHistory[today] = (settings.joinHistory[today] || 0) + 1;
    updateSetting(member.guild.id, 'joinHistory', settings.joinHistory);

    // Auto Restore Roles on Join
    if (settings.autoRestoreRolesEnabled && settings.autoRestoreSourceGuildId) {
        const sourceGuild = client.guilds.cache.get(settings.autoRestoreSourceGuildId);
        if (sourceGuild) {
            try {
                const sourceMember = await sourceGuild.members.fetch(member.id).catch(() => null);
                if (sourceMember) {
                    const sourceRoles = sourceMember.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
                    for (const [id, role] of sourceRoles) {
                        const matchingRole = member.guild.roles.cache.find(r => r.name === role.name);
                        if (matchingRole) {
                            if (matchingRole.position < member.guild.members.me.roles.highest.position) {
                                await member.roles.add(matchingRole).catch(() => {});
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('[AutoRestore] Failed to restore roles on join:', e);
            }
        }
    }

    if (!settings.masterSwitch) return;

    if (settings.autoRoleEnabled && settings.autoRoleIds && settings.autoRoleIds.length > 0) {
        for (const roleId of settings.autoRoleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (role) await member.roles.add(role).catch(() => {});
        }
    }

    if (settings.welcomeEnabled && settings.welcomeChannelId) {
        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (channel) {
            let msg = settings.welcomeMessage || "Welcome {user} to **{server}**! We are now at {membercount} members.";
            msg = msg.replace(/{user}/g, `<@${member.id}>`).replace(/{username}/g, member.user.username).replace(/{server}/g, member.guild.name).replace(/{membercount}/g, member.guild.memberCount);

            const embed = new EmbedBuilder().setDescription(msg).setColor(settings.welcomeColor || '#6366f1').setTimestamp();
            
            let finalImageUrl = null;
            if (settings.welcomeImageType === 'banner') finalImageUrl = member.guild.bannerURL({ size: 512 });
            else if (settings.welcomeImageType === 'custom' && settings.welcomeCustomImageUrl) finalImageUrl = settings.welcomeCustomImageUrl;
            else finalImageUrl = member.guild.iconURL({ size: 512 });

            if (finalImageUrl) embed.setImage(finalImageUrl);
            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_dropdown') {
        const selectedType = interaction.values;
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${selectedType}`)
            .setTitle(`${selectedType} Support Submission`);

        const reasonInput = new TextInputBuilder()
            .setCustomId('ticket_reason')
            .setLabel("Details / Reason")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Please write out the details of your support query...")
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
        await interaction.deferReply({ ephemeral: true });
        const selectedType = interaction.customId.replace('ticket_modal_', '');
        const reason = interaction.fields.getTextInputValue('ticket_reason');
        const settings = await getSettings(interaction.guildId);

        try {
            const safeUsername = interaction.user.username.replace(/[^a-z0-9]/gi, '').toLowerCase();
            const ticketChan = await interaction.guild.channels.create({
                name: `${safeUsername}-ticket`,
                type: ChannelType.GuildText,
                parent: settings.ticketCategoryId || null,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            logTicketAction(interaction.guildId, 'OPENED', interaction.user.username, `Type: ${selectedType} | Reason: ${reason}`).catch(()=>{});

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Support Ticket Created`)
                .addFields(
                    { name: 'Support Category', value: selectedType, inline: true },
                    { name: 'Submitted Reason', value: reason }
                )
                .setColor('#6366f1')
                .setTimestamp();

            await ticketChan.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
            await interaction.editReply({ content: `✅ Support ticket generated successfully in <#${ticketChan.id}>` });
        } catch (e) {
            await interaction.editReply({ content: '❌ Failed to create a private support ticket. Check bot permissions.' });
        }
        return;
    }

    if (interaction.isButton()) {
        const settings = await getSettings(interaction.guildId);
        
        if (interaction.customId === 'verify_user_btn') {
            await interaction.deferReply({ ephemeral: true });
            if (settings.verifyEnabled && settings.verifyRoleIds && settings.verifyRoleIds.length > 0) {
                let added = 0;
                for (const roleId of settings.verifyRoleIds) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (role) { await interaction.member.roles.add(role).catch(() => {}); added++; }
                }
                if (added > 0) {
                    await interaction.editReply({ content: '✅ You have been successfully verified!' });
                    if(!settings.verifiedUsers) settings.verifiedUsers = [];
                    if(!settings.verifiedUsers.find(u => u.id === interaction.user.id)) {
                        settings.verifiedUsers.push({ id: interaction.user.id, username: interaction.user.username });
                        updateSetting(interaction.guildId, 'verifiedUsers', settings.verifiedUsers);
                    }
                } else await interaction.editReply({ content: '❌ Verification roles could not be assigned. Please contact an admin.' });
            } else { await interaction.editReply({ content: '❌ Verification system is offline.' }); }
            return;
        }

        if (interaction.customId === 'close_ticket_btn') {
            await interaction.deferReply({ ephemeral: false });
            await interaction.editReply({ content: '🔒 Ticket will automatically close in 5 seconds...' });
            logTicketAction(interaction.guildId, 'CLOSED', interaction.user.username, `Closed ticket ${interaction.channel.name}`).catch(()=>{});
            setTimeout(() => { interaction.channel.delete().catch(()=>{}); }, 5000);
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'dashboard') {
        await interaction.deferReply({ ephemeral: true });
        const settings = await getSettings(interaction.guildId);
        const allowedUserId = '1284247278957367337';
        let hasAccess = interaction.user.id === interaction.guild?.ownerId || interaction.user.id === allowedUserId || interaction.member?.permissions.has('Administrator');
        if (!hasAccess && settings.allowedAccess && settings.allowedAccess.includes(interaction.user.id)) hasAccess = true;

        if (!hasAccess) return interaction.editReply({ content: '❌ **Access Denied:** You do not have permission to view the security panel.' });
        await interaction.editReply({ content: `🌐 **Access the ServSecurity Control Center here:**\n${process.env.PUBLIC_URL || 'http://localhost:3000'}` });
    }

    const isAdmin = interaction.member?.permissions.has('Administrator') || interaction.user.id === '1284247278957367337';

    if (['kick', 'ban', 'timeout', 'unmute', 'role'].includes(interaction.commandName)) {
        await interaction.deferReply({ ephemeral: false }); 
        if (!isAdmin) return interaction.editReply({ content: '❌ You must be an administrator.'});
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) return interaction.editReply({ content: '❌ User not found.' });

        try {
            if (interaction.commandName === 'kick') { 
                if (!member.kickable) return interaction.editReply({ content: '❌ I do not have permission to kick this user.' });
                await member.kick(reason); 
                await interaction.editReply({ content: `✅ Kicked **${target.tag}**.` }); 
                logAction(interaction.guildId, 'KICK', target.username, target.id, reason).catch(console.error); 
            } 
            else if (interaction.commandName === 'ban') { 
                if (!member.bannable) return interaction.editReply({ content: '❌ I do not have permission to ban this user.' });
                await member.ban({ reason: reason }); 
                await interaction.editReply({ content: `✅ Banned **${target.tag}**.` }); 
                logAction(interaction.guildId, 'BAN', target.username, target.id, reason).catch(console.error); 
            }
            else if (interaction.commandName === 'timeout') { 
                const duration = interaction.options.getInteger('duration');
                if (!member.moderatable) return interaction.editReply({ content: '❌ I do not have permission to timeout this user.' });
                await member.timeout(duration * 60000, reason); 
                await interaction.editReply({ content: `✅ Timed out **${target.tag}** for ${duration}m.` }); 
                logAction(interaction.guildId, 'TIMEOUT', target.username, target.id, reason).catch(console.error); 
            }
            else if (interaction.commandName === 'unmute') { 
                if (!member.moderatable) return interaction.editReply({ content: '❌ I do not have permission to unmute this user.' });
                await member.timeout(null, reason); 
                await interaction.editReply({ content: `✅ Unmuted **${target.tag}**.` }); 
                logAction(interaction.guildId, 'UNMUTE', target.username, target.id, reason).catch(console.error);
            }
            else if (interaction.commandName === 'role') { 
                const role = interaction.options.getRole('role');
                if (role.position >= interaction.guild.members.me.roles.highest.position) {
                    return interaction.editReply({ content: '❌ I cannot assign a role higher than or equal to my own highest role.' });
                }
                await member.roles.add(role, reason); 
                await interaction.editReply({ content: `✅ Gave role **${role.name}** to **${target.tag}**.` }); 
                logAction(interaction.guildId, 'ROLE_ADD', target.username, target.id, reason).catch(console.error);
            }
        } catch (error) { interaction.editReply({ content: '❌ Error executing command. Check bot permissions.' }); }
    }

    if (interaction.commandName === 'purge') {
        await interaction.deferReply({ ephemeral: true });
        if (!isAdmin) return interaction.editReply({ content: '❌ Admin only.' });
        const amount = interaction.options.getInteger('amount');
        await interaction.channel.bulkDelete(amount, true).catch(()=>{});
        await interaction.editReply({ content: `✅ Deleted ${amount} messages.` });
    }

    if (interaction.commandName === 'lock') {
        await interaction.deferReply({ ephemeral: false });
        if (!isAdmin) return interaction.editReply({ content: '❌ Admin only.' });
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
        await interaction.editReply({ content: `🔒 Channel locked.` });
    }

    if (interaction.commandName === 'massrole') {
        await interaction.deferReply({ ephemeral: false });
        if (!isAdmin) return interaction.editReply({ content: '❌ Admin only.' });
        await interaction.editReply({ content: `⏳ Assigning role to everyone... This may take a while depending on server size.` });
        
        const role = interaction.options.getRole('role');
        const members = await interaction.guild.members.fetch();
        let count = 0;
        for (const [id, member] of members) {
            if (!member.user.bot && !member.roles.cache.has(role.id)) {
                await member.roles.add(role).catch(()=>{}); count++;
            }
        }
        await interaction.followUp({ content: `✅ Assigned role **${role.name}** to ${count} members.` });
    }

    if (interaction.commandName === 'restoreroles') {
        await interaction.deferReply({ ephemeral: false });
        if (!isAdmin) return interaction.editReply({ content: '❌ Admin only.' });

        const targetUser = interaction.options.getUser('target');
        const sourceServerId = interaction.options.getString('source_server_id');

        const sourceGuild = client.guilds.cache.get(sourceServerId);
        if (!sourceGuild) return interaction.editReply({ content: `❌ I am not in the server with ID \`${sourceServerId}\`.` });

        const sourceMember = await sourceGuild.members.fetch(targetUser.id).catch(() => null);
        if (!sourceMember) return interaction.editReply({ content: `❌ That user is not in the source server (**${sourceGuild.name}**).` });

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) return interaction.editReply({ content: `❌ That user is not in this server.` });

        const sourceRoles = sourceMember.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
        let rolesAdded = 0;
        let rolesNotFound = [];

        for (const [id, role] of sourceRoles) {
            const matchingRole = interaction.guild.roles.cache.find(r => r.name === role.name);
            if (matchingRole) {
                if (matchingRole.position < interaction.guild.members.me.roles.highest.position) {
                    if (!targetMember.roles.cache.has(matchingRole.id)) {
                        await targetMember.roles.add(matchingRole).catch(() => {});
                        rolesAdded++;
                    }
                } else {
                    rolesNotFound.push(role.name + " (Too high)");
                }
            } else {
                rolesNotFound.push(role.name);
            }
        }

        let replyMsg = `✅ Restored **${rolesAdded}** roles to **${targetUser.tag}** from **${sourceGuild.name}**.`;
        if (rolesNotFound.length > 0) replyMsg += `\n⚠️ Could not add: ${rolesNotFound.join(', ')}`;
        await interaction.editReply({ content: replyMsg });
    }

    if (interaction.commandName === 'syncallroles') {
        await interaction.deferReply({ ephemeral: false });
        if (!isAdmin) return interaction.editReply({ content: '❌ Admin only.' });

        const sourceServerId = interaction.options.getString('source_server_id');
        const sourceGuild = client.guilds.cache.get(sourceServerId);
        if (!sourceGuild) return interaction.editReply({ content: `❌ I am not in the server with ID \`${sourceServerId}\`.` });

        await interaction.editReply({ content: `⏳ Syncing roles for all members from **${sourceGuild.name}**... This will take a while depending on server size.` });

        const currentMembers = await interaction.guild.members.fetch();
        let usersSynced = 0;
        let rolesAssignedTotal = 0;

        for (const [id, targetMember] of currentMembers) {
            if (targetMember.user.bot) continue;

            const sourceMember = await sourceGuild.members.fetch(id).catch(() => null);
            if (sourceMember) {
                const sourceRoles = sourceMember.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
                let addedForThisUser = false;
                for (const [sId, sRole] of sourceRoles) {
                    const matchingRole = interaction.guild.roles.cache.find(r => r.name === sRole.name);
                    if (matchingRole && !targetMember.roles.cache.has(matchingRole.id)) {
                        // FIXED: Changed targetGuild to interaction.guild
                        if (matchingRole.position < interaction.guild.members.me.roles.highest.position) {
                            await targetMember.roles.add(matchingRole).catch(()=>{});
                            rolesAssignedTotal++;
                            addedForThisUser = true;
                        }
                    }
                }
                if (addedForThisUser) usersSynced++;
            }
        }

        await interaction.followUp({ content: `✅ Sync complete! Restored **${rolesAssignedTotal}** roles across **${usersSynced}** users from **${sourceGuild.name}**.` });
    }
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// NEW GUILD CREATION ENGINE
app.post('/api/backup/create/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const sourceGuild = client.guilds.cache.get(req.params.guildId);
    
    if (!sourceGuild) return res.status(404).json({ error: 'Source Guild not found' });
    
    if (client.guilds.cache.size >= 10) {
        return res.status(400).json({ error: 'Discord API Limitation: Bots present in 10 or more servers cannot programmatically spawn new guilds.' });
    }

    try {
        const newGuild = await client.guilds.create({
            name: `${sourceGuild.name} [Backup]`
        });

        pendingBackups.set(newGuild.id, req.session.user.id);

        let defaultChannel = newGuild.systemChannel;
        if (!defaultChannel) {
            const textChannels = newGuild.channels.cache.filter(c => c.type === ChannelType.GuildText);
            defaultChannel = textChannels.first();
        }

        if (!defaultChannel) {
            defaultChannel = await newGuild.channels.create({ name: 'general', type: ChannelType.GuildText });
        }

        const invite = await defaultChannel.createInvite({ maxAge: 0, maxUses: 10 });
        res.json({ success: true, message: 'Server generated successfully', inviteUrl: invite.url });

        (async () => {
            try {
                for (const [id, role] of sourceGuild.roles.cache.sort((a,b) => a.position - b.position)) {
                    if(role.name === '@everyone' || role.managed) continue;
                    await newGuild.roles.create({ name: role.name, color: role.color, permissions: role.permissions, hoist: role.hoist }).catch(()=>{});
                }
                for (const [id, category] of sourceGuild.channels.cache.filter(c => c.type === ChannelType.GuildCategory)) {
                    const newCat = await newGuild.channels.create({ name: category.name, type: ChannelType.GuildCategory }).catch(()=>{});
                    if(newCat) {
                        for (const [cid, channel] of sourceGuild.channels.cache.filter(c => c.parentId === category.id && c.type === ChannelType.GuildText)) {
                            await newGuild.channels.create({ name: channel.name, type: ChannelType.GuildText, parent: newCat.id }).catch(()=>{});
                        }
                    }
                }
            } catch (backgroundError) {
                console.error('Background cloning error:', backgroundError);
            }
        })();

    } catch(e) {
        res.status(500).json({ error: e.message || 'Failed to create backup server.' });
    }
});

// MULTI-MEMBER BACKGROUND ROLE SYNC API ENDPOINT (For direct Web UI triggering)
app.post('/api/config/sync-all/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const { sourceGuildId } = req.body;
    const targetGuild = client.guilds.cache.get(req.params.guildId);
    const sourceGuild = client.guilds.cache.get(sourceGuildId);
    if (!targetGuild || !sourceGuild) return res.status(400).json({ error: 'Guilds not found or bot not in them' });
    
    res.json({ success: true, message: 'Sync started' });
    
    (async () => {
        try {
            const currentMembers = await targetGuild.members.fetch();
            for (const [id, targetMember] of currentMembers) {
                if (targetMember.user.bot) continue;
                const sourceMember = await sourceGuild.members.fetch(id).catch(() => null);
                if (sourceMember) {
                    const sourceRoles = sourceMember.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
                    for (const [sId, sRole] of sourceRoles) {
                        const matchingRole = targetGuild.roles.cache.find(r => r.name === sRole.name);
                        if (matchingRole && !targetMember.roles.cache.has(matchingRole.id)) {
                            if (matchingRole.position < targetGuild.members.me.roles.highest.position) {
                                await targetMember.roles.add(matchingRole).catch(()=>{});
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Background sync error:', e);
        }
    })();
});

app.get('/api/auth/login', (req, res) => { res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`); });
app.get('/api/auth/callback', async (req, res) => {
    try {
        const tokenRes = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: process.env.REDIRECT_URI }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const userRes = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
        const guildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
        req.session.user = { id: userRes.data.id, username: userRes.data.username, avatar: userRes.data.avatar };
        req.session.guilds = guildsRes.data.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n).map(g => ({ id: g.id, name: g.name, icon: g.icon }));
        res.redirect('/');
    } catch (e) { res.redirect('/?error=Auth_Failed'); }
});
app.get('/api/user-data', (req, res) => {
    if (!req.session?.user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user, guilds: req.session.guilds.map(g => ({ ...g, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null, botPresent: client.guilds.cache.has(g.id) })), botClientId: process.env.DISCORD_CLIENT_ID });
});
app.get('/api/discord-data/:guildId', async (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const settings = await getSettings(guild.id);
    
    try { await guild.members.fetch(); } catch (e) {}

    res.json({
        channels: guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name })),
        categories: guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => ({ id: c.id, name: c.name })),
        roles: guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
        bots: guild.members.cache.filter(m => m.user.bot && m.user.id !== client.user.id).map(m => ({ id: m.user.id, name: m.user.username, avatar: m.user.avatar })),
        guildInfo: { icon: guild.iconURL({ size: 512 }), banner: guild.bannerURL({ size: 512 }), joinHistory: settings.joinHistory || {}, verifiedUsers: settings.verifiedUsers || [] },
        otherGuilds: req.session.guilds.filter(g => client.guilds.cache.has(g.id)).map(g => ({id: g.id, name: g.name}))
    });
});
app.get('/api/config/:guildId', async (req, res) => { res.json(await getSettings(req.params.guildId)); });
app.post('/api/config/:guildId', async (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
    const current = await getSettings(req.params.guildId);
    let newSettings = { ...current, ...req.body };
    const guild = client.guilds.cache.get(req.params.guildId);
    if (newSettings.honeypotChannelId === 'CREATE_NEW' && guild) { try { newSettings.honeypotChannelId = (await guild.channels.create({ name: '⚠️-do-not-talk-here', type: ChannelType.GuildText })).id; } catch(e){} }
    if (newSettings.ticketCategoryId === 'CREATE_NEW' && guild) { try { newSettings.ticketCategoryId = (await guild.channels.create({ name: '🎫 Tickets', type: ChannelType.GuildCategory })).id; } catch(e){} }
    guildSettings[req.params.guildId] = newSettings; saveLocalDatabase(); await saveToCloud(req.params.guildId, newSettings);
    if (newSettings.verifyEnabled && newSettings.verifyChannelId && guild && (current.verifyEnabled !== newSettings.verifyEnabled || current.verifyChannelId !== newSettings.verifyChannelId || JSON.stringify(current.verifyRoleIds) !== JSON.stringify(newSettings.verifyRoleIds))) { await setupVerifyMessage(guild.id, newSettings.verifyChannelId); await setupVerificationPermissions(guild, newSettings.verifyChannelId, newSettings.verifyRoleIds); }
    if (newSettings.ticketEnabled && newSettings.ticketPanelChannelId && guild && (current.ticketEnabled !== newSettings.ticketEnabled || current.ticketPanelChannelId !== newSettings.ticketPanelChannelId || current.ticketMessage !== newSettings.ticketMessage)) await setupTicketPanel(guild.id, newSettings.ticketPanelChannelId, newSettings.ticketMessage);
    res.json({ success: true, config: newSettings });
});

app.get('/api/auth/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

if (process.env.DISCORD_TOKEN) client.login(process.env.DISCORD_TOKEN).catch(() => {});
app.listen(process.env.PORT || 3000, '0.0.0.0');
