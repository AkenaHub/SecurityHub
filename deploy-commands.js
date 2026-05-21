const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const commands = [
    new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Get the link to the ServSecurity web control panel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully loaded the /dashboard command globally.');
    } catch (error) {
        console.error(error);
    }
})();
