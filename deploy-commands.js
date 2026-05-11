const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const dotenv = require('dotenv');

// Load environment variables (locally only; Railway uses its own Variables dashboard)
dotenv.config();

const commands = [
    new SlashCommandBuilder()
        .setName('startprotecting')
        .setDescription('Enables invite spam and hacked account detection.')
        // Only allow administrators to run this command
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('stopprotecting')
        .setDescription('Disables invite spam and hacked account detection.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
]
    .map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // Registers commands globally (can take up to an hour to update everywhere)
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
