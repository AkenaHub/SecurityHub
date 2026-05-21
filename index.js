require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

client.once('ready', () => {
    console.log(`Ready: ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'dashboard') {
        const allowedUserId = '1284247278957367337';
        const isServerOwner = interaction.user.id === interaction.guild?.ownerId;
        const isWhitelistedUser = interaction.user.id === allowedUserId;
        const isAdmin = interaction.member?.permissions.has('Administrator');

        if (!isServerOwner && !isWhitelistedUser && !isAdmin) {
            return interaction.reply({
                content: '❌ **Access Denied:** You do not have permission to view the security panel.',
                ephemeral: true
            });
        }

        const dashboardUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
        
        await interaction.reply({
            content: `🌐 **Access the ServSecurity Control Center here:**\n${dashboardUrl}`,
            ephemeral: true
        });
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

const app = express();

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const usingHttps = process.env.PUBLIC_URL && process.env.PUBLIC_URL.startsWith('https');

app.use(session({
    secret: process.env.SESSION_SECRET || 'servsecurity-key-123',
    resave: true,
    saveUninitialized: true,
    proxy: true,
    name: 'servsecurity.sid',
    cookie: { 
        secure: usingHttps,
        sameSite: usingHttps ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    
    if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else {
        res.status(404).send("File missing");
    }
});

app.get('/api/auth/login', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.REDIRECT_URI;
    
    if (!clientId || !redirectUri) {
        return res.status(500).send("Missing credentials");
    }
    
    const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds`;
    res.redirect(authorizeUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=No_code');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const guildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.user = userResponse.data;
        req.session.guilds = guildsResponse.data;

        req.session.save((err) => {
            res.redirect('/');
        });
    } catch (error) {
        res.redirect('/?error=Auth_Failed');
    }
});

app.get('/api/user-data', (req, res) => {
    if (!req.session || !req.session.user) return res.json({ loggedIn: false });

    const adminGuilds = req.session.guilds.filter(guild => {
        const perms = BigInt(guild.permissions);
        return (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
    });

    const mappedGuilds = adminGuilds.map(guild => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
        botPresent: client.guilds.cache.has(guild.id)
    }));

    res.json({
        loggedIn: true,
        user: req.session.user,
        guilds: mappedGuilds,
        botClientId: process.env.DISCORD_CLIENT_ID
    });
});

app.get('/api/config/:guildId', (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getSettings(req.params.guildId));
});

app.post('/api/config/:guildId', (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    
    guildSettings[req.params.guildId] = {
        ...getSettings(req.params.guildId),
        ...req.body
    };
    saveDatabase();
    res.json({ success: true, config: guildSettings[req.params.guildId] });
});

app.delete('/api/config/:guildId', (req, res) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    
    delete guildSettings[req.params.guildId];
    saveDatabase();
    res.json({ success: true, message: 'Configuration reverted' });
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Active on ${PORT}`));
