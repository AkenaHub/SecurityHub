require('dotenv').config();

const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    REST, Routes, SlashCommandBuilder, AuditLogEvent, Events, PermissionFlagsBits, ChannelType
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');
const { getAuth, signInAnonymously, signInWithCustomToken } = require('firebase/auth');

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

const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|io|me|li)\/.+)|(discord\.com\/invite\/.+)/i;
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi', '.pif'];

const createLogEmbed = (title, description, color) => {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadLocalDatabase();
    await initRemoteStorage();

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const commands = [
            new SlashCommandBuilder().setName('dashboard').setDescription('Get the link to the ServSecurity web control panel.')
        ].map(cmd => cmd.toJSON());

        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (error) {}
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'dashboard') {
        const settings = await getSettings(interaction.guildId);
        const allowedUserId = '1284247278957367337';
        const isServerOwner = interaction.user.id === interaction.guild?.ownerId;
        const isWhitelistedUser = interaction.user.id === allowedUserId;
        const isAdmin = interaction.member?.permissions.has('Administrator');
        
        let hasAccess = isServerOwner || isWhitelistedUser || isAdmin;

        if (!hasAccess && settings.allowedAccess.length > 0) {
            if (settings.allowedAccess.includes(interaction.user.id)) hasAccess = true;
            if (interaction.member && interaction.member.roles && interaction.member.roles.cache.some(role => settings.allowedAccess.includes(role.id))) hasAccess = true;
        }

        if (!hasAccess) {
            return interaction.reply({ content: '❌ **Access Denied:** You do not have permission to view the security panel.', ephemeral: true });
        }

        const dashboardUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
        await interaction.reply({ content: `🌐 **Access the ServSecurity Control Center here:**\n${dashboardUrl}`, ephemeral: true });
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
                await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Link Spam');
                const log = createLogEmbed('🛡️ Link Blocked', `**User:** <@${message.author.id}>\n**Trigger:** \`Unauthorized Link\`\n**Action:** Deleted & Timed out (${settings.linkTimeout}m)`, '#ffcc00');
                await targetLogChannel.send({ embeds: [log] }).catch(() => {});
                return;
            } catch (e) {}
        }
    }

    if (settings.imagesEnabled && message.attachments.size >= settings.maxImages) {
        try {
            await message.delete();
            if (message.member && message.member.timeout) await message.member.timeout(settings.imageTimeout * 60000, 'Image Spam').catch(() => {});
            await logAction(message.guild.id, 'TIMEOUT', message.author.username, message.author.id, 'Image Spam');
            await message.author.send(`⚠️ You were timed out in **${message.guild.name}** for sending too many images at once.`).catch(() => {});
            const log = createLogEmbed('🚨 Image Spam Blocked', `**User:** <@${message.author.id}>\n**Action:** Deleted & Timed out (${settings.imageTimeout}m)`, '#ff0000');
            await targetLogChannel.send({ embeds: [log] }).catch(() => {});
        } catch (e) {}
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

app.use(session({
    secret: process.env.SESSION_SECRET || 'servsecurity-key-12345',
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
        res.status(404).send("<div style='background:#000;color:#fff;font-family:sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;'><h2>System Error: Missing UI</h2><p>The server is running, but it cannot find your <code>index.html</code> file.</p></div>");
    }
});

app.get('/api/auth/login', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.REDIRECT_URI;
    if (!clientId || !redirectUri) return res.status(500).send("<div style='background:#000;color:#fff;font-family:sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;'><h2>Configuration Error</h2><p>You are missing the <code>REDIRECT_URI</code> or <code>DISCORD_CLIENT_ID</code> variable in your Railway variables.</p></div>");
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

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
        const guildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } });

        req.session.user = userResponse.data;
        req.session.guilds = guildsResponse.data;

        req.session.save(() => {
            res.redirect('/');
        });
    } catch (error) {
        console.error("OAuth Error:", error.response?.data || error.message);
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
    
    res.json({ success: true, config: newSettings });
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN).catch(() => {});
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web Dashboard active on port ${PORT}`));
