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

const CURRENT_VERSION = "v1.3.0";

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
            imagesEnabled: true,
            maxImages: 1,
            imageTimeout: 4320,
            raidEnabled: true,
            fileShieldEnabled: true,
            logDeletedEnabled: false,
            antiNukeEnabled: false,
            spamShieldEnabled: false,
            logChannelId: null,
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

const sendChangelog = async (guild) => {
    if (guild.id !== '1499199296522944522') return;

    try {
        let channel = guild.channels.cache.find(c => c.name === 'bot-changelog' && c.type === ChannelType.GuildText);
        if (!channel) {
            channel = await guild.channels.create({
                name: 'bot-changelog',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.SendMessages] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });
        }

        const ansiText = `\`\`\`ansi
\u001b[2;32m[+]\u001b[0m Added Anti-Nuke protections for channel creation and deletion.
\u001b[2;34m[!]\u001b[0m Upgraded Link Shield to support all domains.
\u001b[2;34m[!]\u001b[0m Beautified web dashboard with glassy UI and spotlight buttons.
\u001b[2;32m[+]\u001b[0m Added manual Log Channel ID input.
\`\`\``;

        const embed = new EmbedBuilder()
            .setTitle('🚀 System Update Deployed')
            .setColor(0x4f46e5)
            .setDescription(`**Version ${CURRENT_VERSION}**\n\nThe ServSecurity Matrix has been updated. Below are the compiled changes:\n\n${ansiText}`)
            .setTimestamp()
            .setFooter({ text: 'ServSecurity Automated Changelog' });

        await channel.send({ embeds: [embed] });
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

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const commands = [
            new SlashCommandBuilder().setName('dashboard').setDescription('Get the link to the ServSecurity web control panel.')
        ].map(cmd => cmd.toJSON());

        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (error) {}
});

client.on('interactionCreate', async interaction => {
