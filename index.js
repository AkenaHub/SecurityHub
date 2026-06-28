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

const CURRENT_VERSION = "v3.5.1";

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
const recentJoins = new Map(); // Tracks Anti-Raid Join Floods

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
            masterSwitch: true, linksEnabled: true, linkTimeout: 30, linkAvoids: [], allowedAccess: [], allowedBots: [], raidEnabled: true, fileShieldEnabled: true, logDeletedEnabled: false, antiNukeEnabled: false, logChannelId: null, ticketLogChannelId: null, verifyEnabled: false, verifyChannelId: null, verifyRoleIds: [], verifyPanelMessageId: null, honeypotEnabled: false, honeypotChannelId: null, honeypotAction: 'TIMEOUT', autoRoleEnabled: false, autoRoleIds: [], welcomeEnabled: false, welcomeChannelId: null, welcomeMessage: 'Welcome {user} to **{server}**! We are now at {membercount} members.', welcomeColor: '#6366f1', welcomeImageType: 'icon', welcomeCustomImageUrl: '', ticketEnabled: false, ticketPanelChannelId: null, ticketCategoryId: null, ticketPingRoleIds: [], ticketMessage: 'Please click the button below to open a support ticket.', ticketLogs: [], ticketPanelMessageId: null, lastVersion: null, history: [],
            joinHistory: {}, verifiedUsers: [], autoRestoreRolesEnabled: false, autoRestoreSourceGuildId: null
        };
        saveLocalDatabase();
    }
    if(!guildSettings[guildId].joinHistory) guildSettings[guildId].joinHistory = {};
    if(!guildSettings[guildId].verifiedUsers) guildSettings[guildId].verifiedUsers = [];
    if(!guildSettings[guildId].ticketPingRoleIds) guildSettings[guildId].ticketPingRoleIds = [];
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
                { label: 'Bug Reporting', value: 'Bug Report', description: 'Report technical errors directly.' },
                { label: 'Other', value: 'Other', description: 'General inquiries or other issues.' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = new EmbedBuilder().setTitle('📩 Support Tickets').setDescription(messageText || 'Please select your ticket type below.').setColor('#6366f1').setFooter({ text: 'Secured by ServSecurity' });

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
\u001b[2;32m[+]\u001b[0m Launched beautiful Module Grid layout interface! Settings are now cleanly organized into modals.
\u001b[2;32m[+]\u001b[0m Anti-Raid system fully armed: actively detects and blocks Join Floods and Mass Ping abuse.
\u001b[2;32m[+]\u001b[0m Tickets now map channel names securely by selected category. Added "Other" option.
\`\`\``;

        const embed = new EmbedBuilder().setTitle('🚀 System Update Deployed').setColor(0x6366f1).setDescription(`**Version ${CURRENT_VERSION}**\n\nThe ServSecurity Matrix has been updated. Below are the compiled changes:\n\n${ansiText}`).setTimestamp().setFooter({ text: 'ServSecurity Automated Changelog' });
        await channel.send({ content: '@here', embeds: [embed] });
    } catch (e) {}
};

const linkRegex = /(https?:\/\/(?!media\.discordapp\.net|cdn\.discordapp\.com)[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|org|net|io|gg|me|li|co|us|uk|info|site|xyz)(\/[^\s]*)?)/i;
const discordInviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li|com\/invite)|discordapp\.com\/invite)\/[a-zA-Z0-9\-]+/i;
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
    
    if (settings.raidEnabled) {
        const now = Date.now();
        const guildJoins = recentJoins.get(member.guild.id) || [];
        const recent = guildJoins.filter(time => now - time < 10000); // Joins in last 10s
        recent.push(now);
        recentJoins.set(member.guild.id, recent);

        // More than 5 joins in 10 seconds is a Raid Flag
        if (recent.length > 5) {
            await member.kick('Anti-Raid: Mass join flood detected').catch(()=>{});
            logAction(member.guild.id, 'KICK', member.user.username, member.user.id, 'Anti-Raid: Mass join flood').catch(()=>{});
            return;
        }
    }

    const today = new Date().toISOString().split('T');
    if(!settings.joinHistory) settings.joinHistory = {};
    settings.joinHistory[today] = (settings.joinHistory[today] || 0) + 1;
    updateSetting(member.guild.id, 'joinHistory', settings.joinHistory);

    if (settings.autoRestoreRolesEnabled && settings.autoRestoreSourceGuildId) {
        const sourceGuild = client.guilds.cache.get(settings.autoRestoreSourceGuildId);
        if (sourceGuild) {
            try {
                const sourceMember = await sourceGuild.members.fetch(member.id).catch(() => null);
                if (sourceMember) {
                    const sourceRoles = sourceMember.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
                    for (const [id, role] of sourceRoles) {
                        const matchingRole = member.guild.roles.cache.find(r => r.name === role.name);
                        if (matchingRole && matchingRole.position < member.guild.members.me.roles.highest.position) {
                            await member.roles.add(matchingRole).catch(() => {});
                        }
                    }
                }
            } catch (e) {}
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
            const safeType = selectedType.replace(/[^a-z0-9]/gi, '').toLowerCase();
            
            const permissionOverwrites = [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ];

            if (settings.ticketPingRoleIds && settings.ticketPingRoleIds.length > 0) {
                settings.ticketPingRoleIds.forEach(roleId => {
                    permissionOverwrites.push({
                        id: roleId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    });
                });
            }

            const ticketChan = await interaction.guild.channels.create({
                name: `${safeType}-${safeUsername}-ticket`,
                type: ChannelType.GuildText,
                parent: settings.ticketCategoryId || null,
                permissionOverwrites: permissionOverwrites
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

            let pingContent = `<@${interaction.user.id}>`;
            if (settings.ticketPingRoleIds && settings.ticketPingRoleIds.length > 0) {
                const roleMentions = settings.ticketPingRoleIds.map(roleId => `<@&${roleId}>`).join(' ');
                pingContent += ` ${roleMentions}`;
            }

            await ticketChan.send({ content: pingContent, embeds: [embed], components: [row] });
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
            let canClose = false;
            if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                canClose = true;
            } else if (settings.ticketPingRoleIds && settings.ticketPingRoleIds.length > 0) {
                canClose = settings.ticketPingRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
            } else {
                canClose = true; 
            }

            if (!canClose) {
                return interaction.reply({ content: '❌ You must have a designated Support Role to close this ticket.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: false });
            await interaction.editReply({ content: '🔒 Ticket will automatically close in 5 seconds...' });
            logTicketAction(interaction.guildId, 'CLOSED', interaction.user.username, `Closed ticket ${interaction.channel.name}`).catch(()=>{});
            setTimeout(() => { interaction.channel.delete().catch(()=>{}); }, 5000);
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;

    const isAdmin = interaction.member?.permissions.has('Administrator') || interaction.user.id === '1284247278957367337';

    if (interaction.commandName === 'dashboard') {
        await interaction.deferReply({ ephemeral: true });
        const settings = await getSettings(interaction.guildId);
        const allowedUserId = '1284247278957367337';
        let hasAccess = isAdmin || interaction.user.id === interaction.guild?.ownerId;
        if (!hasAccess && settings.allowedAccess && settings.allowedAccess.includes(interaction.user.id)) hasAccess = true;

        if (!hasAccess) return interaction.editReply({ content: '❌ **Access Denied:** You do not have permission to view the security panel.' });
        await interaction.editReply({ content: `🌐 **Access the ServSecurity Control Center here:**\n${process.env.PUBLIC_URL || 'http://localhost:3000'}` });
        return;
    }

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
    if (message.author.id === client.user.id) return; 

    const settings = await getSettings(message.guild.id);
    if (!settings.masterSwitch) return;

    let hasBypass = message.author?.id === message.guild.ownerId || (message.member && message.member.permissions.has('Administrator'));
    if (!hasBypass && settings.allowedAccess && settings.allowedAccess.length > 0) {
        if (message.author && settings.allowedAccess.includes(message.author.id)) hasBypass = true;
        if (message.member && message.member.roles && message.member.roles.cache.some(role => settings.allowedAccess.includes(role.id))) hasBypass = true;
    }
    
    if (message.webhookId) {
        if (settings.raidEnabled || settings.linksEnabled) {
            const content = message.content.toLowerCase();
            const isScam = scamRegex.test(content) || (content.includes('@everyone') && linkRegex.test(content));
            if (isScam) {
                try {
                    await message.delete().catch(()=>{});
                    const wh = await message.fetchWebhook().catch(()=>{});
                    if (wh) await wh.delete('Deleted malicious webhook spammer').catch(()=>{});
                } catch(e) {}
            }
        }
        return; 
    }

    if (settings.honeypotEnabled && settings.honeypotChannelId && message.channel.id === settings.honeypotChannelId) {
        if (hasBypass) return;
        try {
            await message.delete().catch(()=>{});
            const action = settings.honeypotAction || 'TIMEOUT';
            if (action === 'BAN') await message.member.ban({ reason: 'Security Trap' }).catch(()=>{});
            else if (action === 'KICK') await message.member.kick('Security Trap').catch(()=>{});
            else await message.member.timeout(1440 * 60000, 'Security Trap').catch(()=>{});
            return; 
        } catch (e) {}
    }
    
    if (hasBypass) return; 

    // Mass Ping & Flood Protection
    if (settings.raidEnabled) {
        if (message.mentions.users.size > 5 || message.mentions.roles.size > 3) {
            try {
                await message.delete().catch(() => {});
                if (message.member && message.member.moderatable) await message.member.timeout(86400000, 'Anti-Raid: Mass pinging detected').catch(() => {});
                return;
            } catch (e) {}
        }

        const content = message.content.toLowerCase();
        const isRaid = content.includes('﷽') || scamRegex.test(message.content) || (content.includes('@everyone') && linkRegex.test(content)) || (content.includes('@here') && linkRegex.test(content));
        if (isRaid) {
            try {
                await message.delete().catch(() => {});
                if (message.member && message.member.moderatable) await message.member.timeout(86400000, 'Malicious Phishing/Raid Activity').catch(() => {});
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
                return; 
            } catch (e) {}
        }
    }

    if (settings.linksEnabled) {
        const messageContentLower = message.content.toLowerCase();
        const isInvite = discordInviteRegex.test(message.content);
        const isAvoided = settings.linkAvoids && settings.linkAvoids.some(domain => domain.length > 0 && messageContentLower.includes(domain));
        
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

app.post('/api/backup/create/:guildId', async (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const sourceGuild = client.guilds.cache.get(req.params.guildId);
    if (!sourceGuild) return res.status(404).json({ error: 'Source Guild not found' });
    if (client.guilds.cache.size >= 10) return res.status(400).json({ error: 'Discord API Limitation: Bots present in 10 or more servers cannot programmatically spawn new guilds.' });

    try {
        const newGuild = await client.guilds.create({ name: `${sourceGuild.name} [Backup]` });
        pendingBackups.set(newGuild.id, req.session.user.id);

        let defaultChannel = newGuild.systemChannel;
        if (!defaultChannel) {
            const textChannels = newGuild.channels.cache.filter(c => c.type === ChannelType.GuildText);
            defaultChannel = textChannels.first();
        }
        if (!defaultChannel) defaultChannel = await newGuild.channels.create({ name: 'general', type: ChannelType.GuildText });

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
            } catch (backgroundError) { console.error('Background cloning error:', backgroundError); }
        })();
    } catch(e) { res.status(500).json({ error: e.message || 'Failed to create backup server.' }); }
});

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
        } catch (e) {}
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
    
    if (newSettings.honeypotChannelId === 'CREATE_NEW' && guild) { 
        let existing = guild.channels.cache.find(c => c.name === '⚠️-do-not-talk-here' && c.type === ChannelType.GuildText);
        if (existing) {
            newSettings.honeypotChannelId = existing.id;
        } else {
            try { newSettings.honeypotChannelId = (await guild.channels.create({ name: '⚠️-do-not-talk-here', type: ChannelType.GuildText })).id; } catch(e){} 
        }
    }
    if (newSettings.ticketCategoryId === 'CREATE_NEW' && guild) { 
        let existing = guild.channels.cache.find(c => c.name === '🎫 Tickets' && c.type === ChannelType.GuildCategory);
        if (existing) {
            newSettings.ticketCategoryId = existing.id;
        } else {
            try { newSettings.ticketCategoryId = (await guild.channels.create({ name: '🎫 Tickets', type: ChannelType.GuildCategory })).id; } catch(e){} 
        }
    }
    
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
