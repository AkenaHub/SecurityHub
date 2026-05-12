const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('startprotecting')
        .setDescription('Enables the master protection system.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('stopprotecting')
        .setDescription('Disables the master protection system.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure protection settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand.setName('links')
            .setDescription('Configure Discord invite protection')
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable link protection').setRequired(true))
            .addIntegerOption(opt => opt.setName('timeout').setDescription('Timeout duration in minutes').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand.setName('images')
            .setDescription('Configure hacked account (image spam) protection')
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable image protection').setRequired(true))
            .addIntegerOption(opt => opt.setName('max_amount').setDescription('Max images allowed per message').setRequired(false))
            .addIntegerOption(opt => opt.setName('timeout').setDescription('Timeout duration in minutes').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand.setName('logs')
            .setDescription('Set the channel where protection logs are sent')
            .addChannelOption(opt => opt.setName('channel').setDescription('The channel to send logs to').setRequired(true))
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
