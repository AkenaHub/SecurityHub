const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const clientId = process.env.DISCORD_CLIENT_ID?.replace(/['"]/g, '').trim();
const token = process.env.DISCORD_TOKEN?.replace(/['"]/g, '').trim();

if (!clientId || clientId === 'undefined') {
    console.log('Skipping deploy-commands.js: DISCORD_CLIENT_ID is missing or undefined.');
    return;
}

if (!token || token === 'undefined') {
    console.log('Skipping deploy-commands.js: DISCORD_TOKEN is missing or undefined.');
    return;
}

const commands = [
    new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Get the link to the ServSecurity web control panel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user from the server.')
        .addUserOption(option => option.setName('target').setDescription('The user to kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the kick').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server.')
        .addUserOption(option => option.setName('target').setDescription('The user to ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the ban').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a user for a specific duration.')
        .addUserOption(option => option.setName('target').setDescription('The user to timeout').setRequired(true))
        .addIntegerOption(option => option.setName('duration').setDescription('Duration in minutes').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the timeout').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove a timeout from a user.')
        .addUserOption(option => option.setName('target').setDescription('The user to unmute').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the unmute').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
        .setName('role')
        .setDescription('Give a role to a user.')
        .addUserOption(option => option.setName('target').setDescription('The user to give the role to').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to assign').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for assigning the role').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );
        console.log('Successfully loaded moderation commands globally.');
    } catch (error) {
        console.error('Failed to deploy commands:', error.message);
    }
})();
