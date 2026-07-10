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

const CURRENT_VERSION = "v3.6.0";

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
const recentJoins = new Map();

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
            masterSwitch: true, linksEnabled: true, linkTimeout: 30, linkAvoids: [], allowedAccess: [], allowedBots: [], raidEnabled: true, fileShieldEnabled: true, logDeletedEnabled: false, antiNukeEnabled: false, logChannelId: null, ticketLogChannelId: null, verifyEnabled: false, verifyChannelId: null, verifyRoleIds: [], verifyPanelMessageId: null, honeypotEnabled: false, honeypotChannelId: null, honeypotAction: 'TIMEOUT', autoRoleEnabled: false, autoRoleIds: [], welcomeEnabled: false, welcomeChannelId: null, welcomeMessage: 'Welcome {user} to **{server}**!', welcomeColor: '#6366f1', welcomeImageType: 'none', welcomeCustomImageUrl: '', ticketEnabled: false, ticketPanelChannelId: null, ticketCategoryId: null, ticketPingRoleIds: [], ticketMessage: 'Open a support ticket below.', ticketLogs: [], ticketPanelMessageId: null, lastVersion: null, history: [],
            joinHistory: {}, verifiedUsers: []
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
        const existingBtnMsg = msgs ? msgs.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0]?.components[0]?.customId === 'verify_user_btn') : null;

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

const linkRegex = /(https?:\/\/(?!media\.discordapp\.net|cdn\.discordapp\.com)[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|org|net|io|gg|me|li|co|us|uk|info|site|xyz)(\/[^\s]*)?)/i;
const discordInviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li|com\/invite)|discordapp\.com\/invite)\/[a-zA-Z0-9\-]+/i;
const scamRegex = /(free.*nitro|nitro.*free|steam.*(?:free|gift|premium)|discord.*(?:gift|nitro)|@everyone.*https?:\/\/|@here.*https?:\/\/|discorcl\.gift|dlscord\.gift|client_id=|oauth2\/authorize)/i;

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
        new SlashCommandBuilder().setName('purge').setDescription('Delete bulk messages').addIntegerOption(o => o.setName('amount').setDescription('Number of messages').setRequired(true).setMaxValue(100))
    ];
    await client.application.commands.set(commands).catch(console.error);

    for (const [id, guild] of client.guilds.cache) {
        await syncWithDiscord(guild);
    }
});

client.on('guildMemberAdd', async member => {
    const settings = await getSettings(member.guild.id);
    if (!settings.masterSwitch) return;
    
    // Anti-Raid Join Flooding Protection
    if (settings.raidEnabled) {
        const now = Date.now();
        const guildJoins = recentJoins.get(member.guild.id) || [];
        const recent = guildJoins.filter(time => now - time < 10000); 
        recent.push(now);
        recentJoins.set(member.guild.id, recent);

        if (recent.length > 5) {
            await member.kick('Anti-Raid: Mass join flood detected').catch(()=>{});
            logAction(member.guild.id, 'KICK', member.user.username, member.user.id, 'Anti-Raid: Mass join flood').catch(()=>{});
            return;
        }
    }

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
            
            if (settings.welcomeImageType !== 'none') {
                let finalImageUrl = null;
                if (settings.welcomeImageType === 'banner') finalImageUrl = member.guild.bannerURL({ size: 512 });
                else if (settings.welcomeImageType === 'custom' && settings.welcomeCustomImageUrl) finalImageUrl = settings.welcomeCustomImageUrl;
                else finalImageUrl = member.guild.iconURL({ size: 512 });

                if (finalImageUrl) embed.setImage(finalImageUrl);
            }

            await channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_dropdown') {
        const selectedType = interaction.values[0];
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

    if (interaction.commandName === 'dashboard') {
        await interaction.reply({ content: `🌐 **Access the ServSecurity Control Center here:**\n${process.env.PUBLIC_URL || 'http://localhost:3000'}`, ephemeral: true });
        return;
    }

    const isAdmin = interaction.member?.permissions.has('Administrator');
    if (!isAdmin) return interaction.reply({ content: '❌ You must be an administrator.', ephemeral: true });

    if (interaction.commandName === 'purge') {
        await interaction.deferReply({ ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        await interaction.channel.bulkDelete(amount, true).catch(()=>{});
        await interaction.editReply({ content: `✅ Deleted ${amount} messages.` });
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

            await newGuild.setName(oldGuild.name).catch(() => {});
            const member = await newGuild.members.fetch(executor.id).catch(() => null);
            if (member && member.bannable) {
                await member.ban({ reason: 'Anti-Nuke: Unauthorized Server Modification' }).catch(() => {});
            }
        } catch (e) {}
    }
});

client.on('messageCreate', async message => {
    if (message.author.id === client.user.id) return; 

    const settings = await getSettings(message.guild.id);
    if (!settings.masterSwitch) return;

    let hasBypass = message.author?.id === message.guild.ownerId || (message.member && message.member.permissions.has('Administrator'));
    
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(cookieSession({ 
    name: 'servsecurity.sid', 
    keys: [process.env.SESSION_SECRET || 'servsecurity-key-12345'], 
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
    sameSite: 'lax'
}));

// Route static files correctly for both Express and Vercel serverless environments
app.get('/', (req, res) => {
    const cwdPublicPath = path.join(process.cwd(), 'public', 'index.html');
    const cwdRootPath = path.join(process.cwd(), 'index.html');
    const dirPublicPath = path.join(__dirname, 'public', 'index.html');
    const dirRootPath = path.join(__dirname, 'index.html');

    if (fs.existsSync(cwdPublicPath)) res.sendFile(cwdPublicPath);
    else if (fs.existsSync(cwdRootPath)) res.sendFile(cwdRootPath);
    else if (fs.existsSync(dirPublicPath)) res.sendFile(dirPublicPath);
    else if (fs.existsSync(dirRootPath)) res.sendFile(dirRootPath);
    else res.status(404).send("<div style='background:#050608;color:#fff;font-family:sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;'><h2>UI Error: Missing index.html</h2><p style='color:#9ca3af;margin-top:10px;'>Vercel could not locate your dashboard UI file. Please ensure index.html is uploaded to your repository.</p></div>");
});

app.get('/api/auth/login', (req, res) => { 
    res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`); 
});

app.get('/api/auth/callback', async (req, res) => {
    try {
        const tokenRes = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({ 
            client_id: process.env.DISCORD_CLIENT_ID, 
            client_secret: process.env.DISCORD_CLIENT_SECRET, 
            grant_type: 'authorization_code', 
            code: req.query.code, 
            redirect_uri: process.env.REDIRECT_URI 
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        
        const userRes = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
        const guildsRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
        
        req.session.user = { id: userRes.data.id, username: userRes.data.username, avatar: userRes.data.avatar };
        req.session.guilds = guildsRes.data.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n).map(g => ({ id: g.id, name: g.name, icon: g.icon }));
        res.redirect('/');
    } catch (e) { 
        console.error("Auth Failed:", e.response?.data || e.message);
        res.redirect('/?error=Auth_Failed'); 
    }
});

app.get('/api/user-data', (req, res) => {
    if (!req.session?.user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user, guilds: req.session.guilds.map(g => ({ ...g, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null, botPresent: client.guilds.cache.has(g.id) })), botClientId: process.env.DISCORD_CLIENT_ID });
});

app.get('/api/discord-data/:guildId', async (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    
    res.json({
        channels: guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name })),
        categories: guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => ({ id: c.id, name: c.name })),
        roles: guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
        bots: guild.members.cache.filter(m => m.user.bot && m.user.id !== client.user.id).map(m => ({ id: m.user.id, name: m.user.username, avatar: m.user.avatar }))
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
        if (existing) newSettings.honeypotChannelId = existing.id;
        else { try { newSettings.honeypotChannelId = (await guild.channels.create({ name: '⚠️-do-not-talk-here', type: ChannelType.GuildText })).id; } catch(e){} }
    }
    if (newSettings.ticketCategoryId === 'CREATE_NEW' && guild) { 
        let existing = guild.channels.cache.find(c => c.name === '🎫 Tickets' && c.type === ChannelType.GuildCategory);
        if (existing) newSettings.ticketCategoryId = existing.id;
        else { try { newSettings.ticketCategoryId = (await guild.channels.create({ name: '🎫 Tickets', type: ChannelType.GuildCategory })).id; } catch(e){} }
    }
    
    guildSettings[req.params.guildId] = newSettings; saveLocalDatabase(); await saveToCloud(req.params.guildId, newSettings);
    if (newSettings.verifyEnabled && newSettings.verifyChannelId && guild && (current.verifyEnabled !== newSettings.verifyEnabled || current.verifyChannelId !== newSettings.verifyChannelId || JSON.stringify(current.verifyRoleIds) !== JSON.stringify(newSettings.verifyRoleIds))) { await setupVerifyMessage(guild.id, newSettings.verifyChannelId); await setupVerificationPermissions(guild, newSettings.verifyChannelId, newSettings.verifyRoleIds); }
    if (newSettings.ticketEnabled && newSettings.ticketPanelChannelId && guild && (current.ticketEnabled !== newSettings.ticketEnabled || current.ticketPanelChannelId !== newSettings.ticketPanelChannelId || current.ticketMessage !== newSettings.ticketMessage)) await setupTicketPanel(guild.id, newSettings.ticketPanelChannelId, newSettings.ticketMessage);
    res.json({ success: true, config: newSettings });
});

app.get('/api/auth/logout', (req, res) => { req.session = null; res.redirect('/'); });

if (process.env.DISCORD_TOKEN) client.login(process.env.DISCORD_TOKEN).catch(() => {});
module.exports = app;
if (require.main === module) { app.listen(process.env.PORT || 3000, '0.0.0.0'); }
