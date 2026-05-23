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
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );
        console.log('Successfully loaded the /dashboard command globally.');
    } catch (error) {
        console.error('Failed to deploy commands:', error.message);
    }
})();
