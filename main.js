/* eslint-disable linebreak-style */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-console */
/* eslint-disable prefer-promise-reject-errors */
/* eslint eqeqeq: ["error", "smart"] */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable radix */

const { DateTime } = require('luxon');
const { Interval } = require('luxon');
const i = require('./index');

const client = new i.disc.Client();

const params = [['you', 'WATCHING'], ['you', 'LISTENING'], ['with you', 'PLAYING']];
let activity = 0;

function commandParse(msg, prefix, commandchannel) { // parses commands and sends to hub function
  if (!msg.content.toLowerCase().startsWith(prefix)) return; // not a msg that starts with prefix
  if (commandchannel != null) {
    const chans = commandchannel.split(',');
    if (chans.indexOf(msg.channel.id) < 0) {
      msg.channel.send('Use a command channel to use my commands.');
      return;
    }
  }
  console.log(`[${msg.author.tag}] ${msg.content}`);
  const content = msg.content.slice(prefix.length); // formats msg content
  const command = content.split(' ');
  let index = -1;
  for (const u in i.config.commands) {
    const com = i.config.commands[u];
    if (Array.isArray(com) && com.indexOf(command[0].toLowerCase()) !== -1) {
      index = parseInt(u);
      break;
    } else if (com === command[0].toLowerCase()) {
      index = parseInt(u);
      break;
    }
  }

  if (index !== -1) { // checks if command is valid, sends to discModule hub function for response
    i.discModule.hub(msg, index, command);
  } else {
    msg.channel.send(i.config.invalidCommand); // malformed command, mispelled or just not a command
  }
}

async function minuteFunction() { // executes every minute (see client.once('ready', ...))
  // member update stuff //
  const curMil = Date.now(); // CURRENT TIME IN MILLISECONDS SINCE EPOCH
  i.data.getValue('info', 'id', 1, 'memberupdatetime').then((output) => {
    if (curMil - output.memberupdatetime > 1000 * 60 * 60 * i.config.memberCheckUpdateFrequency) {
      i.mc.updateMembers(output.memberupdatetime);
    }
  });

  i.discModule.eventTimeout(); // updates events for if they should have started / ended
  i.discModule.leaderCheck(); // updates leaders of value events to ensure no innacurracies
  i.discModule.eventIntervalCheck(); // checks for event wide updates via interval

  // gexp stuff //
  const date = DateTime.fromMillis(curMil, { zone: 'America/New_York' });
  const storedDate = DateTime.fromMillis((await i.data.getValue('info', 'id', '1', 'lastdate')).lastdate, { zone: 'America/New_York' });
  const int = Interval.fromDateTimes(storedDate, date);
  let daysPast = Math.floor(int.length('days')); // days past
  const newDate = storedDate.plus({ days: daysPast });

  if (daysPast > 0) { // more than a day since last update
    const now = new Date();
    const DoW = now.getDay();
    if (DoW === 1) {
      i.data.reducePasses();
      i.discModule.eventUnconfirm();
    }
    console.log(`${daysPast} day(s) have passed since lastdate`);
    if (daysPast > 7) {
      console.log('bot has been off for a week or more, set daysPast to 7');
      daysPast = 7;
    }
    try { // deals with gexp
      await i.mc.dayXPFunction(daysPast, newDate.ts);
      await i.data.writeValue('info', 'id', '1', 'lastdate', newDate.ts); // updates lastime value to new date
      console.log('dayXPFunction finished');
    } catch (err) {
      console.log(`dayXPFunction error: ${err}`);
    }
  }

  setTimeout(minuteFunction, (1000 * 60));
}

async function activityLoop() {
  client.user.setActivity(params[activity][0], { type: params[activity][1] });
  activity += 1;
  if (activity === params.length) {
    activity = 0;
  }
  setTimeout(activityLoop, 1000 * 60);
}

client.once('ready', async () => {
  console.log('Online');
  activityLoop();
  minuteFunction(); // executes check every minute

  // let lastDate = await i.data.getValue('info', 'id', '1', 'lastdate')
});

client.on('raw', (packet) => { // uncached reaction adds
  // We don't want this to run on unrelated packets
  if (!['MESSAGE_REACTION_ADD'].includes(packet.t)) return;
  // Grab the channel to check the message from
  const channel = client.channels.cache.get(packet.d.channel_id);
  // There's no need to emit if the message is cached, because the event will fire anyway for that
  if (channel.messages.cache.has(packet.d.message_id)) return;
  // Since we have confirmed the message is not cached, let's fetch it
  channel.messages.fetch(packet.d.message_id).then(async (message) => {
    // Emojis can have identifiers of name:id format, so we have to account for that case as well
    const emoji = packet.d.emoji.id ? `${packet.d.emoji.name}:${packet.d.emoji.id}` : packet.d.emoji.name;
    // This gives us the reaction we need to emit the event properly, in top of the message object
    const reaction = message.reactions.cache.get(emoji);
    const user = await client.users.fetch(packet.d.user_id);
    // Adds the currently reacting user to the reaction's users collection.
    if (reaction) reaction.users.cache.set(packet.d.user_id, user);
    if (packet.t === 'MESSAGE_REACTION_ADD' && reaction != null) {
      client.emit('messageReactionAdd', reaction, user);
    }
  });
});

client.on('messageReactionAdd', (react, user) => {
  if (user.me || user.bot) {
    return;
  }
  i.discModule.eventReact(react, user);
});

client.on('message', async (msg) => {
  if (msg.author.id === i.config.botId || msg.author.bot) {
    return;
  }

  let prefix; // finds prefix, checks for dm or guild then finds custom prefix if guild has one
  let channel;
  if (msg.channel.type === 'dm') {
    prefix = i.config.defaultPrefix;
  } else {
    const dbPrefix = await i.data.getValue('guilds', 'discordguildid',
      msg.guild.id, ['prefix', 'commandchannel']);
    if (dbPrefix == null || dbPrefix.prefix == null) {
      prefix = i.config.defaultPrefix;
    } else {
      prefix = dbPrefix.prefix;
    }
    if (!prefix) {
      prefix = i.config.defaultPrefix;
    }
    if (dbPrefix != null) {
      channel = dbPrefix.commandchannel;
    }
  }

  await i.data.fastDiscordIDStore(msg.author.id);
  commandParse(msg, prefix, channel);
  // sends prefix and msg to be parsed into possible command */
});

client.on('guildCreate', async (guild) => {
  try {
    i.data.getValue('guilds', 'discordguildid', guild.id, 'discordguildid').then((output) => {
      if (output == null) {
        i.data.insertValue('guilds', 'discordguildid', guild.id);
      }
    });
    guild.me.setNickname(`[${i.config.defaultPrefix.replace(/ /, '')}] ${i.config.botName}`);
    // await i.discModule.newGuild(guild);
  } catch (err) {
    console.log(`guildCreate event response failed: ${err}.`);
  }
});

client.on('guildMemberAdd', (member) => {
  i.data.getValue('users', 'discordid', member.id, 'discordid').then((output) => {
    if (output == null) {
      i.data.insertValue('users', 'discordid', member.id);
    }
  });
});

module.exports.client = client;

client.login(i.creds.discToken);
