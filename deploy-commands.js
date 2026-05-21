const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Define your /setup command
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Opens the Security Control Center dashboard.')
].map(command => command.toJSON());

// Initialize the REST provider
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Started refreshing global application (/) commands...');

        // Routes.applicationCommands registers the command for ALL servers globally
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID), 
            { body: commands }
        );

        console.log('✅ Successfully reloaded global application (/) commands!');
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();
