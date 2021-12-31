/* eslint-disable prefer-destructuring */
/* eslint-disable no-multi-str */
/* eslint-disable linebreak-style */
/* eslint-disable no-useless-concat */
/* eslint-disable radix */
/* eslint-disable prefer-template */
/* eslint-disable no-await-in-loop */
/* eslint-disable arrow-body-style */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-console */
/* eslint-disable prefer-promise-reject-errors */
/* eslint eqeqeq: ["error", "smart"] */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */

const { MessageEmbed } = require('discord.js');
const Chart = require('quickchart-js');
const Cache = require('node-cache');
const i = require('../index');
const dc = require('../main');
const { hclient } = require('./mcModule');

const cooldownCache = new Cache({ stdTTL: i.config.cacheTTL });
const objCache = new Cache({ stdTTL: 30 * 60 });
const graphCache = new Cache({ stdTTL: 60 * 60 });
const eventMsgCache = new Cache({ stdTTL: 60 * 60 * 12 });
const leaderMsgCache = new Cache({ stdTTL: 60 * 14 });
const reactEventCool = new Cache({ stdTTL: 30 });

// UTILITY FUNCTIONS //

function limiter(fn, wait) { // limits api calls
  let isCalled = false;
  const calls = [];

  const caller = () => {
    if (calls.length && !isCalled) {
      isCalled = true;
      calls.shift().call();
      setTimeout(() => {
        isCalled = false;
        caller();
      }, wait);
    }
  };

  return function lims() {
    calls.push(fn.bind(this, ...arguments));
    caller();
  };
}

function form(input) { // turns input into '`' + input + '`'
  return ('`' + input + '`');
}

function strPath(obj, path) { // takes a string, goes to path in obj
  path = path.split('.');
  for (let u = 0, len = path.length; u < len; u += 1) {
    obj = obj[path[u]];
  }
  return obj;
}

function checkStaff(msg, user) { // returns true / false if person has staff role or is owner
  return new Promise((resolve, reject) => {
    if (msg.channel.type === 'dm') reject('checkStaff called on a DM');
    if (user == null) user = msg.author.id; // add in capability for reaction checking
    if (user === msg.channel.guild.owner.user.id) resolve(true); // is owner of server
    i.data.getValue('guilds', 'discordguildid', msg.channel.guild.id, 'staffrole').then((output) => { // finds staff role for server
      if (output == null) resolve(false); // no staff roles set
      const staffRoles = output.staffrole.split(',');
      for (const role of msg.member._roles) {
        if (staffRoles.indexOf(role) !== -1) {
          resolve(true);
        }
      }
      resolve(false);
    });
  });
}

async function checkOwner(msg) {
  return new Promise((resolve, reject) => {
    if (msg.channel.type === 'dm') reject('checkStaff called on a DM');
    if (msg.author.id === msg.channel.guild.owner.user.id) resolve(true); // is owner of server
    resolve(false);
  });
}

async function findRole(guild, role) {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      const roles = guild.roles.cache.entries();
      const roleAmount = guild.roles.cache.size;
      for (let num = 0; num < roleAmount; num += 1) {
        const val = roles.next().value;
        if (val[1].name.toLowerCase() === role.toLowerCase()) {
          resolve([true, val[1].id]);
        }
      }
      // console.log(await guild.roles.fetch().cache);
      resolve([false]);
    } catch (err) {
      console.log(err);
      reject(err);
    }
  });
}

async function changeRole(memberObj, roleID, action) { // adds or removes roles only when required
  console.log(`ATTEMPT: role ${action} id: ${roleID}, member: ${memberObj.user.tag}`);
  if (memberObj._roles.includes(roleID) === false && action === 'add') {
    await memberObj.roles.add(roleID); // commented out for TESTING
    console.log('success');
  } else if (memberObj._roles.includes(roleID) && action === 'remove') {
    await memberObj.roles.remove(roleID); // commented out for TESTING
    console.log('success');
  }
}

function isBotDev(msg) { // for bot developer commands only
  if (msg.author.id !== i.config.botDevID) {
    msg.channel.send('This command is for bot developers only.');
    return false;
  }
  return true;
}

function placeForm(num) { // adds "st, nd, rd, th" suffixes to numbers
  if (num > 10 && num < 20) return `${num}th`;
  num = num.toString();
  const last = parseInt(num.split('').pop());
  let suffix;
  switch (last) {
    case 1:
      suffix = 'st';
      break;
    case 2:
      suffix = 'nd';
      break;
    case 3:
      suffix = 'rd';
      break;
    default:
      suffix = 'th';
      break;
  }
  return num.toString().concat(suffix);
}

function coolForm(id, command) { // format of cooldown thing
  return `${id}${command}`;
}

function cooldown(msg, command) { // does cooldown stuff with caches.
  const commandCooldown = cooldownCache.get(`${msg.author.id}${command}`);
  if (commandCooldown != null) {
    const timeRemaining = i.config.cacheTTL - (Date.now() - commandCooldown) / 1000;
    msg.channel.send(`This command is on cooldown for ${Math.floor(timeRemaining / 60)}m ${Math.round(timeRemaining % 60)}s.`);
    return false;
  }
  return true;
}

async function newGuild(guild) {
  let dataGuild;
  try {
    dataGuild = await i.data.getValue('guilds', 'discordguildid', guild.id, 'discordguildid'); // checks if guild is in database already
  } catch (err) {
    console.log(`newGuild getValue failed: ${err}`);
    // eslint-disable-next-line no-useless-return
    dataGuild = () => { return; };
  }
  if (dataGuild !== undefined) {
    console.log('Guild not detected in database, passing through newGuild.');
    try { // writes guild id to database
      await i.data.insertValue('guilds', 'discordguildid', guild.id);
      console.log(`Wrote new guild with id "${guild.id} to the database.`);
    } catch (err) {
      console.log(`Error writing new guild with id "${guild.id}" to the database. Error: ${err}`);
      throw (err);
    }
    console.log('hi');
  } else {
    console.log(`Already known guild with id "${guild.id}" passed through newGuild function, ignored.`);
  }
}

function awaitReaction(msg, emoji) {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    let emojiArr = [];
    if (Array.isArray(emoji)) { // checks for emoji array, converts to array
      emojiArr = emoji;
    } else {
      emojiArr.push(emoji);
    }

    const filter = (react, user) => {
      return user.id !== i.config.botId && emojiArr.indexOf(react.emoji.name) > -1;
    };
    msg.awaitReactions(filter, { max: 1, time: 1000 * 60 * 5 }).then((reaction) => { // wait
      msg.reactions.removeAll();
      if (reaction.size === 0) {
        resolve(false);
      }
      resolve(reaction.first().emoji.name);
    }).catch((err) => {
      reject(err);
    });
  });
}

async function staffRoles(channel, guild, user) { // adds roles to staff list of a server.
  const generalFilter = (m) => m.author.id === user.id && m.content !== 'CANCEL';
  const message = await channel.send('I will allow people with the specified role(s) access to\nall my staff only commands.\nYou can change this later.\n\nNote: High level commands involved in server confirguation will remain owner-only.');
  message.react('✅');
  message.react('❎');
  const react = await awaitReaction(message, ['✅', '❎']);
  if (react === '✅') {
    await channel.send('What is the name of the role(s)?\nIf you have multiple roles you wish to add,\nplease separate them with with a comma (Ex. Admin,Mod,Helper)\n\nType something random if you do not want to add staff roles now.');
    let roleSet = false;
    const writeRoles = { roles: [] };
    let correctRoles = [];
    while (!roleSet) { // loops through waiting for valid role
      correctRoles = [];
      const roleMessage = await guild.owner.user.dmChannel.awaitMessages(generalFilter, { max: 1 });
      let { content } = roleMessage.first();
      content = content.replace(/\s+/g, '');
      const roles = content.split(',');
      const rolePromise = [];
      for (const role of roles) {
        rolePromise.push(findRole(guild, role));
      }
      try {
        const roleResults = await Promise.all(rolePromise);
        const errorRoles = [];

        for (const index in roleResults) { // checking for valid roles, adding to list.
          if (roleResults[index][0]) {
            writeRoles.roles.push(roleResults[index][1]);
            correctRoles.push(roles[index]);
          } else { // roles that didn't work or exist
            errorRoles.push(roles[index]);
          }
        }

        if (errorRoles.length > 0) {
          await channel.send('Role(s) `' + errorRoles.join(',') + '` were mispelt or do not exist. If you want to try again, select ❎'); // tells user of fails
        }

        let confirmMessage = 'Role(s) `' + correctRoles.join(',') + '` will be given staff permissions. Continue?';
        if (correctRoles.length === 0) {
          confirmMessage = 'No roles (besides the owner) will be given staff permissions. Continue?';
        }
        const confirm = await channel.send(confirmMessage);
        await confirm.react('✅');
        await confirm.react('❎');

        const finalConfirm = await awaitReaction(confirm, ['✅', '❎']); // final check to confirm settings. Goes back to top if X is checked.
        if (finalConfirm === '❎') {
          await channel.send('What is the name of the role(s)?\nIf you have multiple roles you wish to add,\nplease separate them with with a comma (Ex. Admin,Mod,Helper)\n\nType something random if you do not want to add staff roles now.');
        } else if (finalConfirm === '✅') {
          roleSet = true;
        }
      } catch (err) {
        console.log(`staff roles error: ${err}`);
        await channel.send('Error. Please try again, or contact Rajah#7777 for assistance');
      }
    }
    try {
      await i.data.writeValue('guilds', 'discordguildid', guild.id, 'staffrole', writeRoles);
      await channel.send('Staff permissions sucessfully added to `' + correctRoles.join(', ') + '`');
    } catch (err) {
      console.log(`staff roles set error: ${err}`);
      await channel.send('Unknown error. Please contact Rajah#7777 for assistance.');
    }
  } else if (react === '❎') {
    await channel.send('No staff role(s) set. This can be changed later.');
  }
}

async function newOwner(guild, owner) { // send to owner on guild join, sets up bot
  // eslint-disable-next-line no-useless-concat
  const firstMessage = await owner.user.send(`Welcome to the ${i.config.botName} bot setup!\nIf you do not want to configure the bot now, type ` + '`' + 'CANCEL' + '`' + '.\n to continue, please react with ✅');
  const cancelFilter = (m) => m.content === 'CANCEL' || m.content === i.config.finalMessage;
  const generalFilter = (m) => m.author.id !== i.config.botId && m.content !== 'CANCEL';
  const cancelCollector = owner.user.dmChannel.createMessageCollector(cancelFilter);
  const channel = owner.user.dmChannel;

  let index = 0; // tracks where in setup owner is

  const cancelCheck = (collect) => {
    return new Promise((resolve) => {
      collect.on('collect', (msg) => {
        if (msg.content === 'CANCEL') {
          collect.stop();
          resolve('canceled');
        } if (msg.content === i.config.finalMessage) {
          collect.stop();
          resolve('setup');
        }
      });
    });
  };

  cancelCheck(cancelCollector).then((result) => {
    if (result === 'setup') {
      console.log('Guild setup complete.');
    } else {
      channel.send('Setup canceled. Use bot in server to configure. Have a great day!');
      // eslint-disable-next-line no-useless-return
      return;
    }
  });
  while (index <= 10) {
    switch (index) {
      case 0: { // starts interaction with check reaction
        firstMessage.react('✅');
        await awaitReaction(firstMessage, '✅');
        index += 1;
        break;
      }
      case 1: { // adds staff role if wanted
        await channel.send('**Step 1 of 5**\nDoes your server have staff role(s) that you want me to use?');
        await staffRoles(channel, guild, owner.user);
        index += 1;
        break;
      }
      case 2: {
        await channel.send('hi!');
        index += 1;
        break;
      }
      case 3: {
        break;
      }
      default:
        channel.send('Internal error');
        console.log('MessageCollector error.');
        break;
    }
  }
}

async function memberAndRank(give, revoke) { // gives people ranks for time in guilds
  const guildsFound = []; // tracking guilds and roles looked up to reduce api calls
  const guildIDFound = []; // for tracking ID string for identification
  const roleIDArray = []; // to discord's api
  const memIDArray = [];

  let discordIDArrGive = [];
  for (const res of give) { // checks mc accounts for linked discord accounts
    discordIDArrGive.push(i.data.hasDiscordAccount(res[0]));
  }
  discordIDArrGive = await Promise.all(discordIDArrGive);
  for (const u in give) {
    const entry = give[u];
    const discordID = discordIDArrGive[u];
    if (discordID) { // has a discord account
      let guildObj;
      let index = guildIDFound.indexOf(entry[1]);

      if (index === -1) { // LIST OF DISCORD GUILD OBJECTS, guild not yet found
        guildObj = dc.client.guilds.cache.get(entry[1]);
        const roleMemObj = await i.data.getValue('guilds', 'discordguildid', entry[1], ['tierrole', 'memberrole']);
        if (roleMemObj.tierrole != null && roleMemObj.tierrole.split(',').length === i.config.discordRankHours.length) {
          roleIDArray.push(roleMemObj.tierrole.split(',')); // makes sure all of the ranks are set
        } else {
          roleIDArray.push('none'); // if guild has not set tier roles
        }
        if (roleMemObj.memberrole != null) {
          memIDArray.push(roleMemObj.memberrole);
        } else {
          memIDArray.push('none'); // if guild has not set member role
        }
        guildsFound.push(guildObj);
        guildIDFound.push(guildObj.id);
        index = guildsFound.length - 1;
      } else { // discord guild object already found
        guildObj = guildsFound[index];
      }

      if (discordID === '539649048504827914') {
        console.log(index);
        console.log(entry);
      }
      const memberObj = guildObj.members.cache.get(discordID); // gets member object
      if (memberObj != null) { // checks for in server
        if (memIDArray[index] !== 'none') { // adds member role if the server has set one
          changeRole(memberObj, memIDArray[index], 'add');
        }
        if (roleIDArray[index] !== 'none') { // adds first rank if server has set one
          if (entry[2] === 0) { // first tier role
            changeRole(memberObj, roleIDArray[index][0], 'add');
          } else { // getting higher role, remove old
            changeRole(memberObj, roleIDArray[index][entry[2] - 1], 'remove');
            changeRole(memberObj, roleIDArray[index][entry[2]], 'add');
          }
        }
      }
    }
  }

  let discordIDArrRev = [];
  for (const res of revoke) { // checks mc accounts for linked discord accounts
    discordIDArrRev.push(i.data.hasDiscordAccount(res[0]));
  }
  discordIDArrRev = await Promise.all(discordIDArrRev);
  for (const v in revoke) { // remove roles from people that left guilds
    const entry = revoke[v];
    const discordID = discordIDArrRev[v];
    if (discordID && entry[1] != null) {
      // console.log(entry); // ISSUE HERE, both roleMemObj and guildObj returned null/undefined
      let guildObj;
      let index = guildsFound.indexOf(entry[1]);
      if (index === -1 && entry[1] != null) { // checks if guild already found
        guildObj = dc.client.guilds.cache.get(entry[1]);
        // console.log(entry);
        const roleMemObj = await i.data.getValue('guilds', 'discordguildid', entry[1], ['tierrole', 'memberrole']);
        // console.log(roleMemObj);
        if (roleMemObj != null) {
          if (roleMemObj.tierrole != null && roleMemObj.tierrole.split(',').length === i.config.discordRankHours.length) {
            roleIDArray.push(roleMemObj.tierrole.split(',')); // makes sure all of the ranks are set
          } else {
            roleIDArray.push('none'); // if guild has not set tier roles
          }
          if (roleMemObj.memberrole != null) {
            memIDArray.push(roleMemObj.memberrole);
          } else {
            memIDArray.push('none'); // if guild has not set member role
          }
        } else {
          roleIDArray.push('none');
          memIDArray.push('none');
        }
        guildsFound.push(guildObj);
        guildIDFound.push(guildObj.id);
        index = guildsFound.length - 1;
      } else {
        guildObj = guildsFound[index];
      }

      const memberObj = guildObj.members.cache.get(discordID); // gets member object
      if (memberObj != null) { // checks for in server
        if (roleIDArray[index] !== 'none') {
          for (const role of roleIDArray[index]) {
            if (memberObj._roles.includes(role)) { // removes all tier roles from them
              changeRole(memberObj, role, 'remove');
            }
          }
        }
        if (memIDArray[index] !== 'none') {
          changeRole(memberObj, memIDArray[index], 'remove');
        }
      }
    }
  }
}

async function findMCInfo(msg, command) { // finds guild, uuid, and mcusername for discord query
  let guildid;
  let uuid;
  let username;
  if (command.length > 1) { // specified username
    uuid = await i.mc.mojangAPI(command[1]);
    if (uuid.error != null) return ([false, 'no username']);
    username = uuid.username;
    uuid = uuid.uuid.replace(/-/g, ''); // uses electroid api, removes dashes from uuid
  } else { // no username specified, use one linked to discord account
    uuid = await i.data.getValue('users', 'discordid', msg.author.id, 'uuid');
    if (uuid == null || uuid.uuid == null) return ([false, 'no mc link']);
    uuid = uuid.uuid;
    const user = await i.mc.mojangAPI(uuid);
    username = user.username;
  }

  if (msg.channel.type === 'text') { // sent in a guild channel
    guildid = await i.data.getValue('guilds', 'discordguildid', msg.channel.guild.id, 'mcguildid');
    if (guildid == null) return ([false, 'no guild link']);
    guildid = guildid.mcguildid;
  } else { // sent in DMs
    const list = await i.data.sortedList('guildtime', 'time', 'mcguildid', 'uuid', uuid, 'DESC');
    if (list.length === 0) return ([false, 'no entries']);
    guildid = list[0].mcguildid;
  }

  let guildName = await i.data.getValue('mcguilds', 'guildid', guildid, 'guildname');
  guildName = guildName.guildname;

  return [uuid, username, guildid, guildName];
}

async function elog(log) { // does event debug logging if debug log enabled
  const on = await i.data.getValue('info', 'id', 1, 'eventdebug');
  if (on.eventdebug === 'true') {
    console.log(log);
  }
}

async function weeklyGEXPList(guild, week) { // returns list of xp a everyone has got that week
  const curWeek = await i.data.getValue('info', 'id', 1, 'lastdate');
  const oldTime = parseInt(curWeek.lastdate) - (600000 + 604800000 * (week + 1));
  const time = [oldTime, (oldTime + 605400000)];
  const xpData = await i.data.grabXP(guild, time);
  const perUUID = {};
  for (const entry of xpData) {
    if (perUUID[entry.uuid] == null) {
      perUUID[entry.uuid] = entry.gexp;
    } else {
      // eslint-disable-next-line operator-assignment
      perUUID[entry.uuid] = perUUID[entry.uuid] + entry.gexp;
    }
  }

  const perUser = {};
  const promArr = [];
  for (const entry in perUUID) {
    promArr.push(i.mc.mojangAPI(entry).then((userObj) => {
      perUser[userObj.username] = perUUID[entry];
    }));
  }

  const test = await Promise.all(promArr);
  console.log(test);

  //const sortedPlayers = Object.entries(perUser).sort(([, a], [, b]) => b - a);

  //console.log(sortedPlayers);
  //return sortedPlayers;
}

async function leaderboardMessage(msg, members, title, name, header, cut) {
  const chunkArray = (array, chunkSize) => {
    const numberOfChunks = Math.ceil(array.length / chunkSize);
    return [...Array(numberOfChunks)]
      .map((value, index) => {
        return array.slice(index * chunkSize, (index + 1) * chunkSize);
      });
  };

  const output = [header];
  let cutOff = false;
  for (const index in members) {
    const member = members[index];
    if (cut !== 0) {
      if (member[0] >= cut) {
        let spacing = '';
        if (parseInt(index) + 1 <= 9) {
          spacing = ' ';
        }
        let coloring;
        if (index % 2 === 0) {
          coloring = '+';
        } else {
          coloring = '-';
        }
        const namem = i.sprintf('%-24s', `${coloring}  ${parseInt(index) + 1}${spacing}  ${member[1]}`);
        const finalMember = namem.concat(member[0]);
        output.push(finalMember);
      } else {
        cutOff = true;
      }
    } else {
      let spacing = '';
      if (parseInt(index) + 1 <= 9) {
        spacing = ' ';
      }
      let coloring;
      if (index % 2 === 0) {
        coloring = '+';
      } else {
        coloring = '-';
      }
      const namem = i.sprintf('%-24s', `${coloring}  ${parseInt(index) + 1}${spacing}  ${member[1]}`);
      const finalMember = namem.concat(member[0]);
      output.push(finalMember);
    }
  }
  let size = 26;
  if (cut !== 0) {
    output.push(`Values less than ${cut} hidden.`);
    if (output.length === (26 + 1)) {
      size += 1;
    }
  }

  const splitMembers = chunkArray(output, size);
  const fields = [];
  let endIndex = 0;
  for (const index in splitMembers) {
    let input;
    if (index === 0) {
      input = {
        name: `${name}`,
        value: '```diff\n' + `${splitMembers[index].join('\n')}` + '```',
      };
    } else {
      let subtractValue = 1;
      if (splitMembers[index].length !== 26 && cutOff === true) {
        subtractValue = 2;
      }
      input = {
        name: `${endIndex} - ${endIndex + splitMembers[index].length - subtractValue}`,
        value: '```diff\n' + `${splitMembers[index].join('\n')}` + '```',
      };
    }
    endIndex += splitMembers[index].length;
    fields.push(input);
  }
  const gexpMessage = new i.Discord.MessageEmbed()
    .setColor('#138509')
    .setTitle(title)
    .addFields(fields)
    .setFooter('Finest spaghetti');
  msg.channel.send(gexpMessage);
}

// RESPONSE FUNCTIONS //

async function verify(msg, command) { // handles minecraft account verification
  if (command.length === 2) { // right syntax
    const input = command[1];
    if (!cooldown(msg, 'verify')) return;
    const mcAccObj = await i.mc.mojangAPI(input);
    if (!mcAccObj.error) { // valid mc account
      const uuid = mcAccObj.uuid.replace(/-/g, '');
      const hyObj = await i.mc.hclient.getPlayer('uuid', uuid);
      if (hyObj.success) { // logged into hypixel before
        cooldownCache.set(coolForm(msg.author.id, 'verify'), Date.now()); // no api spam cache
        if (hyObj.player != null) {
          const discord = 'DISCORD';
          if (hyObj.player.socialMedia != null && hyObj.player.socialMedia.links != null
            && hyObj.player.socialMedia.links[discord] != null) {
            if (hyObj.player.socialMedia.links[discord] === msg.author.tag) { // they are linked.
              const discordID = await i.data.getValue('users', 'uuid', hyObj.player.uuid, 'discordid');
              if (discordID != null) { // if someone already has account in database
                if (discordID.discordid !== msg.author.id) { // someone else has, overwrite theirs
                  await i.data.writeValue('users', 'discordid', discordID.discordid, 'uuid', null);
                } else { // this person has
                  msg.channel.send('Your account is already linked to ' + form(mcAccObj.username));
                  return;
                }
              }
              const memberUUID = await i.data.getValue('members', 'uuid', hyObj.player.uuid, 'mcguild');
              if (memberUUID == null) { // new user to database (not in web of guilds)
                await i.data.insertValue('members', 'uuid', uuid);
              }
              await i.data.writeValue('users', 'discordid', msg.author.id, 'uuid', uuid);
              msg.channel.send(form(msg.author.tag) + ' successfully linked to ' + form(mcAccObj.username));
              const memberGuild = await i.mc.findGuild('member', uuid);
              if (memberGuild) {
                const discordGuildID = await i.data.hasDiscordGuild(memberGuild);
                if (discordGuildID) {
                  const roles = await i.data.getValue('guilds', 'discordguildid', discordGuildID, ['tierrole', 'memberrole']);
                  const guild = dc.client.guilds.cache.get(discordGuildID);
                  const guildMemObj = guild.members.cache.get(msg.author.id);
                  if (roles != null && roles.memberrole != null) { // add member role
                    changeRole(guildMemObj, roles.memberrole, 'add');
                  }
                  if (roles != null && roles.tierrole != null) { // add a tierrole
                    const tierroleArr = roles.tierrole.split(',');
                    const memberTime = await i.data.getValue('guildtime', ['uuid', 'mcguildid'], [uuid, memberGuild], 'time');
                    if (memberTime != null) {
                      const rank = i.mc.findRank(memberTime.time);
                      changeRole(guildMemObj, tierroleArr[rank], 'add');
                      changeRole(guildMemObj, tierroleArr[rank - 1], 'remove');
                    } else {
                      changeRole(guildMemObj, tierroleArr[0], 'add');
                    }
                  }
                }
              }
            } else {
              msg.channel.send(form(mcAccObj.username) + ' is linked to a different Discord account than ' + form(msg.author.tag));
            }
          } else {
            msg.channel.send(form(mcAccObj.username) + ' has not linked a Discord account, or Hypixel has not updated it yet.');
          }
        } else {
          msg.channel.send(form(mcAccObj.username) + 'has not played on the Hypixel Network.');
        }
      } else {
        msg.channel.send('Hypixel API error.');
      }
    } else {
      msg.channel.send(form(command[1]) + ' is not a valid Minecraft username.');
    }
  } else if (command.length === 1) { // no username specified, query information instead
    const databaseUUID = await i.data.getValue('users', 'discordid', msg.author.id, 'uuid');
    if (databaseUUID != null) { // account already linked
      if (databaseUUID.uuid != null) {
        const mcUserObj = await i.mc.mojangAPI(databaseUUID.uuid);
        if (!mcUserObj.error) {
          msg.channel.send(form(msg.author.tag) + ' is linked to ' + form(mcUserObj.username));
        } else {
          msg.channel.send('Minecraft API error. ' + form(msg.author.tag) + ' is linked to the Minecraft account with the uuid ' + form(mcUserObj.uuid.replace(/-/g, '')));
        }
      } else {
        msg.channel.send(form(msg.author.tag) + ' is not linked to a Minecraft account.\nUse `[prefix] verify [minecraft account]` to link an account.');
      }
    } else {
      msg.channel.send('Please specify a valid minecraft username to link accounts.');
    }
  } else {
    msg.channel.send('Invalid syntax.');
  }
}

async function checkTimeRank(msg, command) { // finds how long user in a guild
  const results = await findMCInfo(msg, command);
  if (!results[0]) { // findMCInfo mostly
    switch (results[1]) {
      case 'no username':
        msg.channel.send('Username not found.');
        return;
      case 'no mc link':
        msg.channel.send('No Minecraft account linked to ' + form(msg.author.tag));
        return;
      case 'no guild link':
        msg.channel.send(form(msg.guild.name) + ' does not have a Hypixel Guild linked, or an error has occurred.');
        return;
      case 'no entries':
        msg.channel.send('No time recorded in guilds using this bot.');
        return;
      default:
        console.log(results);
        msg.channel.send('Unknown error.');
        return;
    }
  }

  const cacheCheck = objCache.get(results[1]);
  if (cacheCheck != null) {
    msg.channel.send(cacheCheck);
    return;
  }

  const timeDatabase = await i.data.getValue('guildtime', ['uuid', 'mcguildid'], [results[0], results[2]], 'time');
  if (timeDatabase == null) { // gets time in database, returns error if none found.
    msg.channel.send(form(results[1]) + ' does not have any recorded time in ' + form(results[3]));
    return;
  }

  // formatting and display //
  if (msg.channel.type === 'text') {
    const index = i.mc.findRank(timeDatabase.time);
    const tierrolesObj = await i.data.getValue('guilds', 'discordguildid', msg.channel.guild.id, 'tierrole');
    if (tierrolesObj != null && tierrolesObj.tierrole != null
        && tierrolesObj.tierrole.split(',').length === i.config.discordRankHours.length) { // server has tierroles set
      const tierrolesArr = tierrolesObj.tierrole.split(',');
      const guildObj = dc.client.guilds.cache.get(msg.channel.guild.id);
      const rolesObj = Array.from(guildObj.roles.cache.values());
      let maxRankCheck = false;
      if (index + 1 === i.config.discordRankHours.length) {
        maxRankCheck = true;
      }
      let currentRole;
      let nextRole;
      for (const roleObj of rolesObj) { // finding the role objects of the current and next rank
        if (roleObj.id === tierrolesArr[index]) {
          currentRole = roleObj;
        } else if (roleObj.id === tierrolesArr[index + 1] && !maxRankCheck) {
          nextRole = roleObj;
        }
        if (currentRole != null && nextRole != null) break;
      }
      let curRankWithPerc = `${currentRole.name} `;
      let embedMsg;
      const fillBar = '█';
      const blankBar = ' ';
      const formTime = parseInt(timeDatabase.time.toFixed(0));
      const daysandhours = `${Math.floor(formTime / 24)} days, ${Math.round(formTime % 24)} hours`;
      const topDisp = `**${results[1]} has ${daysandhours} in ${results[3]}**`;
      const pos = await i.data.placement('guildtime', 'time', 'uuid', 'mcguildid', results[2], 'DESC', results[0]);
      if (!maxRankCheck) { // NOT max rank
        const hourArr = i.config.discordRankHours;
        const hoursInto = timeDatabase.time - hourArr[index];
        const nextRankHours = hourArr[index + 1];
        const perc = Math.round((hoursInto * 1000) / (hourArr[index + 1] - hourArr[index])) / 10;
        let filledBars = 0;
        while (filledBars <= i.config.rankBarLength) { // progress bar
          filledBars += 1;
          if ((perc / 100) < (filledBars / i.config.rankBarLength)
            || filledBars === i.config.rankBarLength) {
            break;
          }
        }
        let bar = fillBar.repeat(filledBars);
        bar = bar.concat(blankBar.repeat(i.config.rankBarLength - filledBars)); // progress bar done
        const dispPerc = `${perc}%`;
        // eslint-disable-next-line max-len
        let percLocation = 0;
        if (filledBars > Math.floor(dispPerc.length / 2)) { // making spacing for % num
          percLocation = blankBar.repeat(filledBars - Math.floor(dispPerc.length / 2));
        }
        // eslint-disable-next-line max-len
        const begSpacing = currentRole.name.length + 1;
        const endSpacing = i.config.rankBarLength - (nextRole.name.length + 1);
        if (percLocation.length >= begSpacing
          && percLocation.length + dispPerc.length <= endSpacing) {
          curRankWithPerc = curRankWithPerc // current role name
            .concat(blankBar.repeat(percLocation.length - begSpacing) // space b4 perc
              .concat(dispPerc // perc
                .concat(blankBar
                  .repeat(endSpacing - (percLocation.length + dispPerc.length)) // space after perc
                  .concat(` ${nextRole.name}`)))); // next role name
        } else {
          curRankWithPerc = curRankWithPerc.concat(blankBar.repeat(endSpacing - begSpacing).concat(` ${nextRole.name}`));
        }
        const hoursUntil = nextRankHours - formTime;
        const numPerc = ((hoursInto / (nextRankHours - hourArr[index])) * 100);
        const botDisp = `${results[1]} is ${Math.floor(hoursUntil / 24)} days, ${Math.round(hoursUntil % 24)} hours from ${nextRole.name} (${numPerc.toFixed(1)}%)`;
        embedMsg = new MessageEmbed()
          .setColor(currentRole.hexColor)
          .setTitle(topDisp)
          .addFields(
            { name: '`' + bar + '`', value: '`' + curRankWithPerc + '`' },
            { name: botDisp, value: `Position in ${results[3]}: **${placeForm(pos[0])} of ${pos[1]}** (Top ${((pos[0] / pos[1]) * 100).toFixed(0)}%)` },
          )
          .setFooter("Brought to you by Rajah's finest spaghetti code");
      } else { // MAX rank
        const bar = fillBar.repeat(i.config.rankBarLength);
        const rank = curRankWithPerc.concat(blankBar
          .repeat(i.config.rankBarLength - curRankWithPerc.length - 5)
          .concat('MAXED'));
        embedMsg = new MessageEmbed()
          .setColor(currentRole.hexColor)
          .setTitle(topDisp)
          .addFields(
            { name: '`' + bar + '`', value: '`' + rank + '`' },
          )
          .setFooter("Brought to you by Rajah's finest spaghetti code");
      }
      objCache.set(results[1], embedMsg);
      msg.channel.send(embedMsg);
    } else {
      const sendStr = `${results[1]} has ${timeDatabase.time} hours in ${results[3]}`;
      objCache.set(results[1], sendStr);
      msg.channel.send(sendStr);
    }
  } else {
    const sendStr = `${results[1]} has ${timeDatabase.time} hours in ${results[3]}`;
    msg.channel.send(sendStr);
  }
}

async function changePrefix(msg, command) { // change prefix for guild
  if (msg.channel.type !== 'text') {
    msg.channel.send('This command is used in discord servers only.');
    return;
  }

  if (await checkStaff(msg)) {
    try {
      let newPrefix;
      if (command[1] == null) {
        await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'prefix', i.config.defaultPrefix);
        newPrefix = i.config.defaultPrefix.replace(/ /, '');
      } else {
        newPrefix = command[1].replace(/ /, '');
      }
      await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'prefix', `${newPrefix} `);
      let botName = msg.guild.me.nickname.replace(/ *\[[^\]]*]/g, '');
      if (botName.charAt(0) === ' ') {
        botName = botName.substring(1);
      }
      await msg.guild.me.setNickname(`[${newPrefix}] ${botName}`);
      // eslint-disable-next-line no-useless-concat
      msg.channel.send('Server prefix changed to ' + '`' + newPrefix + '`'); // for discord text formatting
    } catch (err) {
      console.log(`changePrefix error: ${err}`);
      msg.channel.send('Server prefix change error.');
    }
  } else {
    msg.channel.send('This is a staff-only command.');
  }
}

async function addStaffRole(msg, command) { // adds / removes staff roles, checks existing staff
  if (msg.channel.type === 'dm') {
    msg.channel.send('Use this command in a server.');
    return;
  }
  if (await checkStaff(msg)) { // makes sure they are staff
    command.shift();
    const realRoles = [];
    let writeRoles = [];
    const failedRoles = [];
    const serverRoles = Array.from(msg.guild.roles.cache.keys());
    const removedRoles = [];

    const output = await i.data.getValue('guilds', 'discordguildid', msg.guild.id, 'staffrole');

    if (command.length === 0) { // not adding roles, checking roles
      msg.channel.send('Roles that currently have staff permissions:\n`' + output.staffrole + '`');
      return;
    }

    const userResponseText = {
      add: ['added', 'adding', 'to'],
      remove: ['removed', 'removing', 'from'],
    };
    if (command.length === 1) {
      if (command[0] === 'add' || command[0] === 'remove') {
        msg.channel.send(`Please specify at least one Role ID to ${command[0]} staff permissions ${userResponseText[command[0]][2]}.`);
      } else if (parseInt(command[0])) {
        msg.channel.send('Please specify if you want to add or remove staff permissions from this role.');
      } else {
        msg.channel.send('Incorrect syntax.');
      }
      return;
    }

    if (command[0] !== 'add' || command[0] !== 'remove') {
      msg.channel.send('Incorrect syntax.');
      return;
    }
    const addOrRemove = command[0]; // checks for adding or removing
    command.shift();

    for (const role of command) { // checks to ensure roles are real
      // eslint-disable-next-line radix
      if (serverRoles.indexOf(role) !== -1) {
        realRoles.push(role);
        writeRoles.push(role);
      } else {
        failedRoles.push(role);
      }
    }

    const databaseRoles = output.staffrole.split(',');
    if (addOrRemove === 'add') {
      for (const role of realRoles) { // removes roles already in database.
        if (databaseRoles.indexOf(role) !== -1) {
          writeRoles.splice(writeRoles.indexOf(role), 1);
          failedRoles.push(role);
        }
      }
    }

    const roleString = ',';
    try {
      if (output.staffrole == null && writeRoles.length > 0) { // if no roles already set
        if (addOrRemove === 'add') {
          await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'staffrole', writeRoles.toString());
        } else if (addOrRemove === 'remove') {
          await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'staffrole', null);
          writeRoles = removedRoles;
        }
      } else if (writeRoles.length > 0 && addOrRemove === 'add') { // if the server already has staff roles
        await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'staffrole', output.staffrole.concat(roleString.concat(writeRoles.toString())));
      } else if (addOrRemove === 'remove') { // finds remaining roles to write
        const remainingRoles = output.staffrole.split(',');
        const arrayOutput = output.staffrole.split(',');
        for (const role of realRoles) {
          const index = arrayOutput.indexOf(role);
          if (index !== -1) {
            remainingRoles.splice(index, 1);
            removedRoles.push(role);
          } else {
            failedRoles.push(role);
          }
        }

        await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'staffrole', remainingRoles.toString());
        writeRoles = removedRoles;
      } else if (writeRoles.length === 0 && failedRoles === 0) {
        msg.channel.send(`Unknown error ${userResponseText[addOrRemove][1]} staff role(s).`);
        return;
      }
    } catch (err) {
      if (err) console.log(`addStaffRole error: ${err}`);
      msg.channel.send(`Unknown error ${userResponseText[addOrRemove][1]} staff role(s).`);
      return;
    }

    if (failedRoles.length > 0 && writeRoles.length > 0) { // feedback to user
      // eslint-disable-next-line no-useless-concat
      msg.channel.send(`Sucessfully ${userResponseText[addOrRemove][0]} staff permissions ${userResponseText[addOrRemove][2]} roles:\n` + '`' + writeRoles + '`' + `\nFailed ${userResponseText[addOrRemove][1]} staff permissions ${userResponseText[addOrRemove][2]} roles:\n` + '`' + failedRoles + '`');
    } else if (writeRoles.length > 0) {
      // eslint-disable-next-line no-useless-concat
      msg.channel.send(`Sucessfully ${userResponseText[addOrRemove][0]} staff permissions ${userResponseText[addOrRemove][2]} roles:\n` + '`' + writeRoles + '`');
    } else {
      // eslint-disable-next-line no-useless-concat
      msg.channel.send(`Failed ${userResponseText[addOrRemove][1]} staff permissions ${userResponseText[addOrRemove][2]} roles:\n` + '`' + failedRoles + '`');
    }
  } else {
    msg.channel.send('This command is staff-only.');
  }
}

async function linkGuild(msg, command) { // links discord guild to minecraft guild
  if (msg.channel.type === 'dm') {
    msg.channel.send('This command is used in discord servers only.');
    return;
  }

  if (command.length === 1) { // not setting guild, only checking
    const databaseGuild = await i.data.getValue('guilds', 'discordguildid', msg.guild.id, 'mcguildid');
    if (databaseGuild.mcguildid != null) {
      const databaseGuildName = await i.data.getValue('mcguilds', 'guildid', databaseGuild.mcguildid, 'guildname');
      if (databaseGuildName.guildname == null) {
        msg.channel.send('No guild name stored. This server is linked to the Hypixel guild with ID: ' + '`' + databaseGuild.mcguildid + '`');
        console.log('Guild name not stored. MC Guild ID: ' + form(databaseGuild.mcguildid));
      } else {
        msg.channel.send('This server is linked to ' + form(databaseGuildName.guildname));
      }
    } else {
      msg.channel.send('This server does not have a linked Hypixel guild.');
    }
    return;
  }

  if (command[1] !== 'set') {
    msg.channel.send('Invalid syntax.');
    return;
  }

  if (!await checkOwner(msg)) { // only owners can modify this
    msg.channel.send('This is a owner-only command.');
    return;
  }

  const linkedMinecraftAccount = await i.data.getValue('users', 'discordid', msg.author.id, 'uuid');
  if (linkedMinecraftAccount.uuid == null) {
    msg.channel.send(form(msg.author.displayName) + ' must have a linked your minecraft account to link a guild to this server.');
  } else { // found a minecraft account, finding guild and then making sure they're admin.
    const guildSearch = await i.mc.findGuild('member', linkedMinecraftAccount.uuid);
    if (guildSearch) {
      const guildObj = await i.mc.getGuild(guildSearch);
      if (guildObj.success) {
        let memberRank = null;
        let rankPriority = 1;
        const findDatabaseGuild = await i.data.getValue('mcguilds', 'guildid', guildObj.guild._id, ['guildid', 'guildname']);
        const discordGuildLink = await i.data.getValue('guilds', 'mcguildid', findDatabaseGuild.guildid, 'discordguildid');

        if (findDatabaseGuild != null) { // update guild name if already linked
          if (findDatabaseGuild.guildname !== guildObj.guild.name && discordGuildLink != null
            && discordGuildLink.discordguildid === msg.guild.id) { // update guild name
            await i.data.writeValue('mcguilds', 'guildid', findDatabaseGuild.guildid, 'guildname', guildObj.guild.name);
            msg.channel.send('Hypixel Guild name updated to' + '`' + guildObj.guild.name + '`, previously' + findDatabaseGuild.guildname + '`');
            return;
          }
          if (discordGuildLink != null && discordGuildLink.discordguildid === msg.guild.id) {
            msg.channel.send('This server is linked to ' + '`' + guildObj.guild.name + '`.');
            return;
          }
        }

        for (const memberObj of guildObj.guild.members) { // finding player rank
          if (memberObj.uuid === linkedMinecraftAccount.uuid) {
            memberRank = memberObj.rank;
            break;
          }
        }
        if (memberRank != null) { // found the rank of the member, finding rank priority
          for (const rankObj of guildObj.guild.ranks) {
            if (rankObj.name === memberRank) {
              rankPriority = rankObj.priority; // goes 1-6
              break;
            }
          }
          console.log(findDatabaseGuild);
          console.log(discordGuildLink);
          if (rankPriority >= i.config.rankPriorityCutoff) { // high enough priority, making changes
            if (findDatabaseGuild != null && discordGuildLink != null // another server has guild
              && discordGuildLink.discordguildid !== msg.guild.id) { // erase their entry
              await i.data.writeValue('guilds', 'discordguildid', discordGuildLink.discordguildid, 'mcguildid', null);
            } else {
              await i.data.insertValue('mcguilds', ['guildid', 'guildname'], [guildObj.guild._id, guildObj.guild.name]);
            }
            await i.data.writeValue('guilds', 'discordguildid', msg.guild.id, 'mcguildid', guildObj.guild._id);
            msg.channel.send('Server successfully linked to ' + form(guildObj.guild.name));
          } else {
            msg.channel.send(form(msg.author.displayName) + ' must be high level staff in ' + form(guildObj.guild.name) + ' to link this server.');
          }
        } else {
          msg.channel.send('Internal error.');
        }
      } else {
        msg.channel.send('Hypixel API error.');
      }
    } else {
      msg.channel.send(form(msg.author.displayName) + ' is not in a guild on the Hypixel Network.');
    }
  }
}

async function updateHours(msg, command) { // staff command, updates hours in a guild of a username
  if (msg.channel.type !== 'text') {
    msg.channel.send('This command is server-only.');
    return;
  }
  if (checkStaff(msg)) {
    let username;
    let time;
    command.splice(0, 1);
    const mcObj = await i.data.getValue('guilds', 'discordguildid', msg.guild.id, 'mcguildid');
    if (mcObj != null && mcObj.mcguildid != null) {
      for (const com of command) {
        const int = parseInt(com);
        // eslint-disable-next-line no-self-compare
        if (int === int) {
          time = int;
        } else {
          username = com;
        }
      }
      if (username == null) {
        msg.channel.send('Specify a username to modify.');
      }
      if (time == null) {
        msg.channel.send('Specify a time or hour count to use.');
        return;
      }
      const userObj = await i.mc.mojangAPI(username);
      if (userObj.error) {
        msg.channel.send('Invalid minecraft username.');
        return;
      }
      const now = Date.now();
      let hours;
      if (parseInt(time) < 1000000) { // hour value
        hours = time;
      } else { // millis value
        const diff = now - time;
        hours = (diff / (1000 * 60 * 60)).toFixed(1);
      }
      await i.data.writeValue('guildtime', ['uuid', 'mcguildid'], [userObj.uuid.replace(/-/g, ''), mcObj.mcguildid], 'time', hours);
      const nameObj = await i.data.getValue('mcguilds', 'guildid', mcObj.mcguildid, 'guildname');
      msg.channel.send('Set ' + form(userObj.username) + "'s hours in " + form(nameObj.guildname) + 'to ' + form(hours));
    } else {
      msg.channel.send('No Hypixel guild linked to this server.');
    }
  } else {
    msg.channel.send('This is a staff-only command.');
  }
}

async function xpResponse(msg, command) { // handles the response of the xp command
  let uuid;
  let acct;
  if (command.length < 2) { // unspecified, use in db
    const dbEntry = await i.data.isVerified(msg);
    if (dbEntry) {
      uuid = dbEntry;
      acct = await i.mc.mojangAPI(uuid);
    } else {
      msg.channel.send('No minecraft account linked to ' + form(msg.author.tag) + '\nUse the verify command to link your account');
      return;
    }
  } else { // specified username
    acct = await i.mc.mojangAPI(command[1]);
    if (acct != null && !acct.error) {
      uuid = acct.uuid.replace(/-/g, '');
    } else {
      msg.channel.send('Invalid username.');
      return;
    }
  }

  const xpArr = await i.mc.xpCalc(uuid);
  if (!Array.isArray(xpArr)) {
    msg.channel.send('Unknown error.');
    return;
  }
  if (xpArr[0] === false) {
    msg.channel.send('The specified minecraft account is not in a Hypixel guild.');
    return;
  }
  // NUMBER CALCULATED, NOW RESPONSE //
  const req = await i.data.getValue('guilds', 'mcguildid', xpArr[4], 'gexpreq');
  let message;
  if (req != null && req.gexpreq != null) { // has a requirement, make the bar
    // BAR FORMATTING //
    let bar = '';
    const fill = '█';
    const mid = '═';
    const middleEnd = '╣';
    const blank = ' ';
    const curPerc = `${((xpArr[0] / req.gexpreq) * 100).toFixed(0)}%`;
    const projPerc = `${((xpArr[1] / req.gexpreq) * 100).toFixed(0)}%`;
    const barLen = Math.floor((xpArr[0] / req.gexpreq) * i.config.rankBarLength);
    let percBar = '';
    if (barLen > i.config.rankBarLength) { // bar already filled, at or near 100%
      bar = bar.concat(fill.repeat(i.config.rankBarLength));
      percBar = percBar.concat(blank.repeat(i.config.rankBarLength - curPerc.length));
      percBar = percBar.concat(curPerc);
    } else { // not fully done yet
      bar = bar.concat(fill.repeat(barLen));
      const spaceFromStart = barLen - curPerc.length;
      if (spaceFromStart > 0) {
        percBar = percBar.concat(blank.repeat(barLen - curPerc.length));
      }
      percBar = percBar.concat(curPerc);
    }
    if (bar.length < i.config.rankBarLength) { // bar isn't full yet
      let midLen = Math.floor((xpArr[1] / req.gexpreq) * i.config.rankBarLength);
      if (midLen <= i.config.rankBarLength && midLen > bar.length) { // if proj fits
        bar = bar.concat(mid.repeat(midLen - bar.length - 1));
        bar = bar.concat(middleEnd);
      } else if (midLen > bar.length) { // if projected overfills bar
        midLen = i.config.rankBarLength;
        bar = bar.concat(mid.repeat(midLen - bar.length - 1));
        bar = bar.concat(middleEnd);
      }

      const projPercLen = midLen - projPerc.length;
      if (projPercLen >= (percBar.length + 1)) { // adds in % projected if it fits
        percBar = percBar.concat(blank.repeat(projPercLen - percBar.length));
        percBar = percBar.concat(projPerc);
      }

      if (bar.length < i.config.rankBarLength) { // if any extra space, fill with blank
        bar = bar.concat(blank.repeat(i.config.rankBarLength - bar.length));
      }

      if (percBar.length < i.config.rankBarLength) {
        percBar = percBar.concat(blank.repeat(i.config.rankBarLength - percBar.length));
      }
    }
    // BAR DONE, NOW FULL RESPONSE
    const resObj = { // different text for various responses
      done: [
        '#00FF00',
        `✅ ${acct.username} is all set! ✅`,
      ],
      pass: [
        '#1F85DE',
        `☑️ ${acct.username} has a pass! ☑️`,
      ],
      going: [
        '#FFFF00',
        `⚠️ ${acct.username} is on track! ⚠️`,
      ],
      undone: [
        '#FF0000',
        `❌ ${acct.username} isn't on track! ❌`,
      ],
    };

    let pass = false;
    const passCheck = await i.data.getValue('passes', ['uuid', 'mcguildid'], [uuid, xpArr[4]], 'amount');
    if (passCheck != null && passCheck.amount != null && passCheck.amount > 0) {
      pass = true;
    }

    let resArr;
    if (xpArr[0] > req.gexpreq) {
      resArr = resObj.done;
    } else if (xpArr[1] > req.gexpreq) {
      resArr = resObj.going;
    } else if (pass) {
      resArr = resObj.pass;
    } else {
      resArr = resObj.undone;
    }

    let intCurPerc = ((xpArr[0] / req.gexpreq) * 100);
    let intProjPerc = ((xpArr[1] / req.gexpreq) * 100);
    if (xpArr[0] > req.gexpreq) {
      intCurPerc = intCurPerc.toFixed(0);
      intProjPerc = intProjPerc.toFixed(0);
    } else {
      intCurPerc = intCurPerc.toFixed(1);
      intProjPerc = intProjPerc.toFixed(1);
    }
    message = new MessageEmbed()
      .setColor(resArr[0])
      .setTitle(resArr[1])
      .addFields(
        { name: form(bar), value: form(percBar) },
        {
          name: `[CURRENT]  ${(xpArr[0] / 1000).toFixed(1)}k  (${intCurPerc}%)   ║   [PROJECTED]  ${(xpArr[1] / 1000).toFixed(1)}k  (${intProjPerc}%)`,
          value: `Position in ${xpArr[3]}: **${placeForm(xpArr[2][0])} of ${xpArr[2][1]}** (Top ${(Math.round(100 * (xpArr[2][0] / xpArr[2][1])))}%)`,
        },
      )
      .setFooter(`Guild Requirement: ${(req.gexpreq / 1000).toFixed(1)}k GEXP weekly, ends Sunday 11:59pm EST`);
  } else { // no requirement in server
    message = new MessageEmbed()
      .setColor('#408000')
      .setTitle(`${acct.username}'s GEXP in ${xpArr[3]}`)
      .addFields(
        { name: 'GEXP this week', value: xpArr[0] },
        { name: 'Projected Weekly Total', value: xpArr[1] },
        { name: 'Placement in Guild', value: `${xpArr[2][0]} of ${xpArr[2][1]} [Top ${(Math.round(100 * (xpArr[2][0] / xpArr[2][1])))}%]` },
      )
      .setFooter("Brought to you by Rajah's finest spaghetti code");
  }
  msg.channel.send(message);
}

async function addPass(msg, command) { // gives pass to specific username
  command.splice(0, 1);
  // INPUT CORRECTION AND ERRORS //
  if (!(await checkStaff(msg))) {
    msg.channel.send('This is a staff-only command.');
    return;
  }
  if (msg.channel.type !== 'text') {
    msg.channel.send('This is a server-only command.');
    return;
  }
  if (command.length === 0) {
    msg.channel.send('Please specify a member to add a pass to.');
    return;
  }
  const user = await i.mc.mojangAPI(command[0]);
  if (user.error || user.uuid == null) {
    msg.channel.send('Invalid username.');
    return;
  }
  const serverObj = await i.data.getValue('guilds', 'discordguildid', msg.guild.id, ['mcguildid', 'gexpreq']);
  if (serverObj == null || serverObj.mcguildid == null) {
    msg.channel.send('Please link a Hypixel guild to this server before using this command.');
    return;
  }
  if (serverObj.gexpreq == null) {
    msg.channel.send('Set a GEXP requirement for this server before using this command.');
    return;
  }
  const uuid = user.uuid.replace(/-/g, '');
  const userObj = await i.data.getValue('members', 'uuid', uuid, 'mcguild');
  if (userObj == null || userObj.mcguild == null || userObj.mcguild !== serverObj.mcguildid) {
    msg.channel.send(form(user.username) + " is not in this server's Hypixel guild");
    return;
  }
  // actual code
  let add = 1;
  if (command.length === 2) {
    add = parseInt(command[1]);
    // eslint-disable-next-line no-self-compare
    if (add !== add) {
      msg.channel.send('Input a valid number of passes to give to ' + form(user.username));
      return;
    }
  }
  await i.data.addValue('passes', ['uuid', 'mcguildid'], [uuid, serverObj.mcguildid], 'amount', add);
  const amtObj = await i.data.getValue('passes', ['uuid', 'mcguildid'], [uuid, serverObj.mcguildid], 'amount');
  msg.channel.send('Granted ' + form(user.username) + ' with ' + form(add) + ' pass(es). They now have ' + form(amtObj.amount) + ' week(s).');
}

async function overrideProfile(msg, command) { // overrides main profile to the one specified
  const uuid = await i.data.isVerified(msg);
  if (!uuid) {
    msg.channel.send('No Hypixel account linked.');
    return;
  }

  command.splice(0, 1);
  if (command.length === 0) { // if just query
    const prof = await i.data.getValue('members', 'uuid', uuid, 'mainprofile');
    if (prof.mainprofile == null) {
      msg.channel.send('Your main profile is automatic based on skill XP');
    } else {
      msg.channel.send('Your main profile has been manually set.');
    }
    return;
  }

  if (i.config.cute_names.indexOf(command[0].toLowerCase()) < 0) {
    msg.channel.send('Invalid Skyblock profile name.');
    return;
  }

  if (!cooldown(msg, 'profile')) { // cooldown
    return;
  }
  cooldownCache.set(coolForm(msg.author.id, 'profile'), Date.now());

  const profiles = await hclient.getSkyblockProfiles(uuid);
  if (profiles.success) {
    if (profiles.profiles != null) {
      let chosen = 'none';
      let name;
      for (const profile of profiles.profiles) {
        if (profile.cute_name.toLowerCase() === command[0].toLowerCase()) {
          chosen = profile.profile_id;
          name = profile.cute_name;
          break;
        }
      }
      if (chosen === 'none') {
        msg.channel.send('A profile with the name ' + form(command[0]) + ' was not found.');
        return;
      }
      await i.data.writeValue('members', 'uuid', uuid, 'mainprofile', chosen);
      const moj = await i.mc.mojangAPI(uuid);
      msg.channel.send('Set ' + form(moj.username) + "'s main Skyblock profile to " + form(name));
    } else {
      msg.channel.send('No Skyblock profiles found.');
    }
  } else {
    console.log(profiles);
    msg.channel.send('Unknown error.');
  }
}

async function kickList(msg) {
  const play = await weeklyGEXPList('5eb4d01f8ea8c94128915a85', 0);
}

// EVENT FUNCTIONS //
// the idea is you could
async function eventUnconfirm() { // removes unconfirmed events from database.
  const unconfirmed = await i.data.getValue('eventinfo', 'confirmed', 'false', 'event_id');
  const events = [unconfirmed];
  for (const event of events.flat()) {
    i.data.deleteValue('eventinfo', 'event_id', event.event_id);
  }
}

function eventInterval(size, length) { // equation to calculate the length(mins) of update interval
  if (length == null) {
    length = 12;
  }
  const vars = [1.42, 360, 1.49, 30]; // c, m, d, n order
  const xMax = i.config.scaleMaxEventLength;
  const yMax = i.config.maximumEventParticipants;
  const interval = vars[1] * (length / xMax) ** vars[0]
    + vars[3] * (size / yMax) ** vars[2]; // z = m(x/xMax)^c + n(y/yMax)^d
  if (interval < i.config.eventIntervalBounds[0]) { // smaller than low bound
    return i.config.eventIntervalBounds[0];
  }
  if (interval > i.config.eventIntervalBounds[1]) { // larger than high bound
    return i.config.eventIntervalBounds[1];
  }
  elog(`interval calculated: ${interval}`);
  return Math.round(interval);
}

function eventParticipantValue(profile, uuid, trackType) { // calculates data for each participant
  const path = i.config.eventTypes[trackType];
  let value = 0;
  if (!Array.isArray(path)) { // not event
    const str = strPath(profile.members[uuid], path);
    if (str == null) {
      value = -1;
    } else {
      value = parseInt(strPath(profile.members[uuid], path).toFixed(3));
    }
  } else if (path.indexOf('experience_skill_combat') > -1) { // skill average time
    value = parseInt((i.mc.skillAverage(profile.members[uuid])).toFixed(3));
  } else {
    for (const entry of path) {
      const xp = strPath(profile.members[uuid], entry);
      value += parseInt(xp.toFixed(3));
    }
  }
  return value;
}

async function eventComplete(eventID, event, data, graphURL, message) { // all numbers alr in, end
  await i.data.writeValue('eventinfo', 'event_id', eventID,
    ['ended', 'end_date'], ['true', event.last_updated]);
  const eventDesc = [];
  if (event.end_condition === 'time') { // formatting different kinds of end states
    const dateEnd = new Date(parseInt(event.end_value));
    eventDesc.push(`[End Time] ${dateEnd.toLocaleDateString()} ${dateEnd.toLocaleTimeString()} EST`);
    if (event.value_type === 'gain') {
      eventDesc.push(`[Event Type] Gain the most ${event.track_type} over the course of the event`);
    } else {
      eventDesc.push(`[Event Type] Have the most total ${event.track_type} by the end of the event`);
    }
  } else if (event.value_type === 'gain') {
    eventDesc.push(`[Event Type] Be the first to gain ${event.end_value} ${event.track_type}`);
  } else {
    eventDesc.push(`[Event Type] Be the first to have a total of ${event.end_value} ${event.track_type}`);
  }
  const endDate = new Date(event.last_updated);
  let winner = data[0].uuid;
  const hasDisc = await i.data.getValue('users', 'uuid', winner, 'discordid');
  if (hasDisc == null || hasDisc.discordid == null) {
    winner = await i.mc.mojangAPI(winner);
    winner = winner.username;
  } else winner = `<@${hasDisc.discordid}>`;
  const endMsg = new MessageEmbed()
    .setColor('#FF0000')
    .setTitle(`[Finished Event] ${event.event_name}`)
    .addField('Event Details', '```ini\n' + eventDesc.join('\n') + '\n```'
    + `Event won by ${winner}\n`
    + `Event created by <@${event.creator_discordid}>`)
    .setImage(graphURL)
    .setFooter(`Event Ended: ${endDate.toLocaleDateString()} ${endDate.toLocaleTimeString()} EST`);
  elog(`Event ${eventID} ended.`);
  await message.reactions.removeAll();
  await message.edit(`Congradulations to ${winner}!`, { embed: endMsg });
  // SEND FINAL PAGE
}

async function eventGraph(args, data) { // generates event graph from data
  // args: event_id, time, value_type, update_interval, last_updated, end_condition, end_value
  if (data == null) return 'none';
  const cache = graphCache.get(args.event_id);
  if (cache != null) {
    elog('[eventGraph] using graph cache');
    return cache;
  }
  const topData = data.slice(0, i.config.eventGraphAmount);
  const promise = [];
  for (const entry of topData) {
    promise.push(new Promise((resolve) => {
      const points = [];
      const promises = [];
      i.data.sortedList('eventdata', 'time', ['value', 'time'], ['event_id', 'uuid'],
        [args.event_id, entry.uuid], 'ASC').then((values) => {
        const valueArr = [values];
        for (const val of valueArr.flat()) {
          if (args.value_type === 'gain') {
            const gain = i.data.firstValue(args.event_id, entry.uuid).then((first) => {
              if (first[0].first === -1) { // if someone doesnt have api on at first, cant play
                points.push({ x: val.time, y: 0 });
              } else {
                points.push({ x: val.time, y: val.value - first[0].first });
              }
            });
            promises.push(gain);
          } else {
            points.push({ x: val.time, y: val.value });
          }
        }
        Promise.all(promises).then(() => {
          i.mc.mojangAPI(entry.uuid).then((user) => {
            const sorted = points.sort((a, b) => a.x - b.x);
            let name = entry.uuid;
            if (!user.error) name = user.username;
            const line = {
              label: name,
              data: sorted,
              tension: 0.2,
              showLine: true,
              fill: false,
              pointRadius: 0,
            };
            resolve(line);
          });
        });
      });
    }));
  }

  const graph = await Promise.all(promise);

  const yaxis = {
    min: 0,
    fontColor: '#ffffff',
    callback: (val) => {
      if (val >= 1000) {
        if (val >= 1000000) {
          if (val >= 1000000000) {
            return `${(val / 1000000000).toFixed(1)}B`;
          }
          return `${(val / 1000000).toFixed(1)}M`;
        }
        if (val >= 100000) {
          return `${(val / 1000).toFixed(0)}k`;
        }
        return `${(val / 1000).toFixed(1)}k`;
      }
      return val;
    },
  }; // setting max for value events
  if (args.end_condition === 'value') {
    if (graph[0].data[graph[0].data.length - 1].y >= +args.end_value / 2) {
      yaxis.max = +args.end_value; // needs full height
    } else yaxis.max = Math.round(+args.end_value / 2); // only needs 1/2, good to see things
  }

  const chart = new Chart();
  chart.setConfig({
    type: 'scatter',
    data: {
      datasets: graph,
    },
    options: {
      scales: {
        xAxes: [{
          type: 'time',
          time: {
            unit: 'day',
            minUnit: 'minute',
            displayFormats: {
              day: 'MMM D',
              minute: 'h:aa a',
            },
            isoWeekday: true,
          },
          ticks: {
            fontColor: '#ffffff',
          },
        }],
        yAxes: [{
          ticks: yaxis,
        }],
      },
      legend: {
        position: 'bottom',
        labels: {
          fontColor: '#ffffff',
          boxWidth: 12,
        },
      },
    },
  })
    .setWidth(400)
    .setHeight(300)
    .setBackgroundColor('transparent');
  const res = await chart.getShortUrl();
  let ttl = 60 * 60;
  const timeUntil = (+args.last_updated + (+args.update_interval * 1000 * 60)) - Date.now();
  if (timeUntil > 5000) {
    ttl = Math.floor(timeUntil / 1000);
  }
  graphCache.set(args.event_id, res, ttl); // UNCOMMENT LATER
  return res;
}

async function eventLeaderboard(eventID, lastUpdated, valueType, size) { // event top ppl
  const cache = leaderMsgCache.get(eventID);
  if (cache != null) return cache;
  let data = await i.data.sortedList('eventdata', 'value', ['uuid', 'value'],
    ['event_id', 'time'], [eventID, lastUpdated], 'DESC');
  if (data != null) {
    data = [data];
    data = data.flat();
    if (valueType === 'gain') { // calculate for gain value
      const gainValues = [];
      for (const val of data) {
        gainValues.push(new Promise((resolve) => {
          i.data.firstValue(eventID, val.uuid).then((res) => {
            if (res[0].first === -1) {
              i.data.writeFirst(eventID, val.uuid, val.value).then(() => {
                resolve({
                  uuid: val.uuid,
                  value: 0,
                  time: lastUpdated,
                });
              });
            } else {
              resolve({
                uuid: val.uuid,
                value: val.value - res[0].first,
                time: lastUpdated,
              });
            }
          });
        }));
      }
      const values = await Promise.all(gainValues);
      values.sort((a, b) => b.value - a.value);
      data = values;
    }
    data = data.slice(0, size);
    const promise = [];
    for (const player of data) { // getting usernames
      promise.push(i.mc.mojangAPI(player.uuid).then((res) => {
        if (!res.error) {
          player.name = res.username;
        } else player.name = player.uuid;
      }));
    }
    data.sort((a, b) => b.value - a.value);
    await Promise.all(promise);
    const formArr = ['Place  Username        Value'];
    const space = ' ';
    let colorAlt = '+';
    for (const index in data) {
      let numSpace = 3;
      if (index > 8) numSpace = 2;
      const player = data[index];
      let val = +player.value;
      if (+val >= 1000) {
        if (+val >= 1000000) {
          if (+val >= 1000000000) {
            if (+val >= 100000000000) {
              val = `${(+val / 1000000000).toFixed(1)}B`;
            } else {
              val = `${(+val / 1000000000).toFixed(2)}B`;
            }
          }
          if (+val >= 100000000) {
            val = `${(+val / 1000000).toFixed(1)}M`;
          } else {
            val = `${(+val / 1000000).toFixed(2)}M`;
          }
        }
        if (val >= 100000) {
          val = `${(+val / 1000).toFixed(1)}k`;
        } else {
          val = `${(+val / 1000).toFixed(2)}k`;
        }
      }
      const spaces = 17 - player.name.length;
      formArr.push(`${colorAlt} ${+index + 1}${space.repeat(numSpace)}${player.name}${space.repeat(spaces)}${val}`);
      if (colorAlt === '+') colorAlt = '-';
      else colorAlt = '+';
    }
    const res = formArr.join('\n');
    leaderMsgCache.set(eventID, res);
    return res;
  }
  return null;
}

async function eventNotify(eventID, firstSend) { // events updated, update stands + val events
  const event = await i.data.getValue('eventinfo', 'event_id', eventID,
    [
      'leader', 'start_date', 'end_value', 'discordguildid', 'update_channel',
      'message_id', 'value_type', 'update_interval', 'last_updated', 'perm',
      'event_name', 'creator_discordid', 'end_condition', 'track_type',
    ]);
  let data = await i.data.sortedList('eventdata', 'value', ['uuid', 'value'],
    ['event_id', 'time'], [eventID, event.last_updated], 'DESC');
  let top;
  if (data != null) {
    data = [data];
    data = data.flat();
    if (event.value_type === 'gain') { // calculate for gain value
      const gainValues = [];
      for (const val of data) {
        gainValues.push(new Promise((resolve) => {
          i.data.firstValue(eventID, val.uuid).then((res) => {
            if (res[0].first === -1) {
              i.data.writeFirst(eventID, val.uuid, val.value).then(() => {
                resolve({
                  uuid: val.uuid,
                  value: 0,
                  time: event.last_updated,
                });
              });
            } else {
              resolve({
                uuid: val.uuid,
                value: val.value - res[0].first,
                time: event.last_updated,
              });
            }
          });
        }));
      }
      const values = await Promise.all(gainValues);
      values.sort((a, b) => b.value - a.value);
      data = values;
      top = values[0];
    } else { // regular value
      top = data[0];
    }
  }
  const args = { // args for graph function
    event_id: eventID,
    time: event.last_updated,
    value_type: event.value_type,
    update_interval: event.update_interval,
    last_updated: event.last_updated,
    end_condition: event.end_condition,
    end_value: event.end_value,
  };
  const graph = await eventGraph(args, data);
  const channel = await dc.client.channels.fetch(event.update_channel);
  const message = await channel.messages.fetch(event.message_id);
  if (event.end_condition === 'value') { // calculate the lead to do minute refreshes with, or finish event
    const curVal = top.value;
    if (curVal >= event.end_value) { // event complete
      eventComplete(eventID, event, data, graph, message);
      return;
    }
    const percDone = curVal / event.end_value;
    if (percDone > i.config.eventTopPercThresh
        && (event.leader == null || top.uuid !== event.leader)) { // in win thresh
      i.data.writeValue('eventinfo', 'event_id', eventID, 'leader', top.uuid);
    }
  } else if (event.end_condition === 'time' && event.last_updated >= event.end_value) {
    await message.edit('Event ended, awaiting final results', { embed: message.embeds[0] });
    setTimeout(() => { // 2 min to allow for api to update, get everyones data in
      eventComplete(eventID, event, data, graph, message);
    }, 1000 * 60 * 2);
    return;
  }

  const eventDesc = [];
  if (event.end_condition === 'time') { // formatting different kinds of end states
    const dateEnd = new Date(parseInt(event.end_value));
    eventDesc.push(`[End Time] ${dateEnd.toLocaleDateString()} ${dateEnd.toLocaleTimeString()} EST`);
    if (event.value_type === 'gain') {
      eventDesc.push(`[How to Play] Gain the most ${event.track_type} over the course of the event`
      + '\nNOTE: Make sure to have all API turned on!');
    } else {
      eventDesc.push(`[How to Play] Have the most total ${event.track_type} by the end of the event`
      + '\nNOTE: Make sure you have all API turned on!');
    }
  } else if (event.value_type === 'gain') {
    eventDesc.push(`[How to Play] Be the first to gain ${event.end_value} ${event.track_type}`
    + '\nNOTE: Make sure to have all API turned on!');
  } else {
    eventDesc.push(`[How to Play] Be the first to have a total of ${event.end_value} ${event.track_type}`
    + '\nNOTE: Make sure you have all API turned on!');
  }

  if (event.perm === 'public') {
    eventDesc.push(`[How to Join] React 🖋️ or use\n{prefix} event join ${event.event_name}`);
  } else {
    eventDesc.push('[How to Join] Ask the creator of the event to add you!');
  }
  elog(`Event ${eventID} message update [eventNotify]`);
  const now = new Date(Date.now());
  const newMsg = new MessageEmbed()
    .setTitle(`[Active Event] ${event.event_name}`)
    .setColor('00FF00')
    .addField('Event Details', '```ini\n' + eventDesc.join('\n') + '\n```\n' + `Event created by <@${event.creator_discordid}>`)
    .setFooter(`[Page 1/3]  Last Updated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()} EST`);
  if (graph !== 'none') {
    newMsg.setImage(graph);
  } else {
    newMsg.addField('Top Participants', '```\n' + 'No data recorded' + '\n```');
  }
  eventMsgCache.set(eventID, newMsg);
  await message.edit('', { embed: newMsg });
  if (firstSend) {
    await message.react('⬅️');
    await message.react('➡️');
    if (event.perm === 'public') {
      await message.react('🖋️');
    }
  }
  // UPDATE MESSAGE IN CHANNELS HERE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
}

const eventProfiles = limiter((args) => { // rate limit call, updates individual people
  hclient.getSkyblockProfiles(args.uuid).then((res) => {
    if (res == null || !res.success) {
      return;
    }
    let profile;
    if (args.prof == null) { // finding max profile, if specified or not
      profile = i.mc.mainProfile(res.profiles, args.uuid);
    } else {
      profile = res.profiles.find((prof) => prof.profile_id === args.prof);
    }
    const data = eventParticipantValue(profile, args.uuid, args.track);
    if (args.uuid === '4316657338a94da3a0dfb6da9f39c170' && args.id === 89) { // SHUDUKI TROLL, REMOVE THIS
      i.data.insertValue('eventdata', ['uuid', 'event_id', 'time', 'value'],
        [args.uuid, args.id, args.time, 17185557]).then(() => {
        if (args.last === true) { // data finished, putting up
          elog('eventProfiles finished for ' + args.id);
          eventNotify(args.id, false);
        }
      });
    } else {
      i.data.insertValue('eventdata', ['uuid', 'event_id', 'time', 'value'],
        [args.uuid, args.id, args.time, data]).then(() => {
        if (args.last === true) { // data finished, putting up
          elog('eventProfiles finished for ' + args.id);
          eventNotify(args.id, false);
        }
      });
    }
  });
}, 1000);

async function eventUpdate(updateArr, time) { // updates given events
  let arr = [updateArr];
  arr = arr.flat();
  for (const e of arr) {
    i.data.writeValue('eventinfo', 'event_id', e.event_id, 'last_updated', time);
    const players = e.participants.split(',');
    const each = [];
    const timeObj = await i.data.sortedList('eventdata', 'time', 'time',
      'event_id', e.event_id, 'DESC'); // gets most recent time
    const order = [];
    let timeArr = [];
    timeArr = timeArr.concat(timeObj);
    if (timeArr != null || timeArr[0].time != null) {
      const remPlayers = players;
      const isGain = await i.data.getValue('eventinfo', 'event_id', e.event_id, 'value_type');
      let values;
      if (isGain.value_type === 'gain') {
        const vals = [];
        const firstVals = await i.data.firstValue(e.event_id, players);
        const newVals = await i.data.sortedList('eventdata', 'time', ['value', 'uuid'], 'event_id', e.event_id, 'DESC');
        for (const player of players) {
          const first = firstVals.find((pred) => pred.uuid === player);
          const now = newVals.find((pred) => pred.uuid === player);
          if (first != null && now != null) {
            if (first.first === -1) {
              vals.push({
                uuid: player,
                value: 0,
              });
            } else {
              vals.push({
                uuid: player,
                value: now.value - first.first,
              });
            }
          } else {
            vals.push({ uuid: player, value: 0 });
          }
        }
        values = vals.sort((a, b) => b.value - a.value);
      } else {
        values = await i.data.sortedList('eventdata', 'value', 'uuid',
          ['event_id', 'time'], [e.event_id, timeObj.time], 'DESC');
      }
      for (const particObj of values) {
        const index = remPlayers.indexOf(particObj.uuid);
        if (index > -1) { // hasn't left event
          order.push(particObj.uuid);
          remPlayers.splice(index, 1);
        }
      }
      order.concat(remPlayers); // new players, not in eventdata yet
      if (order.length === 0) order.concat(players);
    } else order.concat(players);
    const argsArr = [];
    for (const index in order) {
      const uuid = order[index];
      // eslint-disable-next-line no-loop-func
      each.push(i.data.getValue('members', 'uuid', uuid, 'mainprofile').then((main) => {
        let profile = null;
        if (main != null && main.mainprofile != null) profile = main.mainprofile;
        const args = {
          id: e.event_id,
          uuid,
          track: e.track_type,
          time,
          prof: profile,
          condition: e.condition,
          last: index - -1 === order.length,
        };
        argsArr.push(args);
      }));
    }

    Promise.all(each).then(async () => {
      const sortArgs = argsArr.sort((a, b) => {
        if (a.last === true) {
          return 1;
        }
        return -1;
      });
      await elog('[eventUpdate] sortArgs (check for double update here)');
      await elog(sortArgs);
      for (const playerArg of sortArgs) {
        eventProfiles(playerArg);
      }
    });
  }
}

async function eventEndSoonNotif(eventID) { // updates event message to say event ending soon
  const e = await i.data.getValue('eventinfo', 'event_id', eventID, ['update_channel', 'message_id']);
  const channel = await dc.client.channels.fetch(e.update_channel);
  const message = await channel.messages.fetch(e.message_id);
  const curEmbed = message.embeds[0];
  curEmbed
    .setColor('#FFFF00')
    .setDescription('```\n' + 'Event ended, awaiting final results' + '\n```');
  message.edit('', { embed: curEmbed });
}

async function eventIntervalCheck() { // finds events that have passed interval
  const res = await i.data.getValue('eventinfo', ['started', 'ended', 'confirmed'],
    ['true', 'false', 'true'], ['event_id', 'update_interval', 'last_updated',
      'end_condition', 'start_date', 'end_value', 'participants', 'track_type']);
  if (res == null) return;
  const time = Date.now();
  const events = [res];
  const updateEvents = [];
  for (const event of events.flat()) {
    let updateTime = event.last_updated;
    if (updateTime == null) updateTime = 0;

    const diff = time - parseInt(updateTime);
    const arg = {
      event_id: event.event_id,
      track_type: event.track_type,
      participants: event.participants,
      condition: event.end_condition,
    };
    if (diff / (1000 * 60) > parseInt(event.update_interval)) { // events to update
      if (res.end_condition === 'time') {
        const timeLeft = event.end_value - time;
        if (timeLeft <= 1000 * 60) { // end soon, do timeout for api update
          eventEndSoonNotif(event.event_id);
          setTimeout(() => {
            elog('[eventIntervalCheck setTimeout] eventUpdate');
            eventUpdate(arg, event.end_value + 1);
          }, timeLeft);
        } else if ((time + (event.update_interval * 1000 * 60) >= event.end_value)
        && time < event.end_value) { // changes update_interval if regular update is too late
          const newInterval = Math.round((event.end_value - time) / (1000 * 60));
          await i.data.writeValue('eventinfo', 'event_id', event.event_id,
            'update_interval', newInterval);
          updateEvents.push(arg);
        }
      } else {
        updateEvents.push(arg);
      }
      if (event.end_condition === 'value'
        && time - event.start_date >= 1000 * 60 * 60 * 25) { // value event, past a day
        const topPlayer = await i.data.sortedList('eventdata', 'value', ['value', 'time'],
          'event_id', event.event_id, 'DESC', '=', 1);
        if (topPlayer != null && topPlayer.value != null) {
          const progress = parseInt(topPlayer.value) / parseInt(event.end_value);
          const passedTime = time - parseInt(topPlayer.time);
          const estTimeRem = Math.round(time + passedTime / progress);
          let partic = [];
          if (event.participants != null) partic = event.participants.split(',');
          const newInterval = eventInterval(partic.length, Math.round(estTimeRem / (1000 * 60)));
          if (newInterval !== parseInt(event.update_interval)) { // changes update interval
            i.data.writeValue('eventinfo', 'event_id', event.event_id, 'update_interval', newInterval);
          }
        }
      }
    }
  }
  if (updateEvents.length > 0) {
    await elog('[eventIntervalCheck] updateEvents');
    await elog(updateEvents);
    updateEvents.sort((a, b) => a.event_id - b.event_id);
    elog('[eventIntervalCheck] eventUpdate');
    eventUpdate(updateEvents, time);
  }
}

async function eventParticipants(msg, eventID) { // does list of participants
  const date = new Date();
  let list = await i.data.getValue('eventinfo', 'event_id', eventID, ['participants', 'event_name', 'started']);
  const name = list.event_name;
  const start = list.started;
  list = list.participants.split(',');
  let title = `[Upcomming Event] ${name}`;
  let color = '#FFFF00';
  let foot = '[Page 2/2]';
  if (start === 'true') {
    title = `[Active Event] ${name}`;
    color = '#00FF00';
    foot = '[Page 3/3]';
  }
  if (list.length > 20) {
    const loadEmbed = new MessageEmbed()
      .setTitle(title)
      .setColor(color)
      .addField('Participants', '```\nLoading...\n```')
      .setFooter(foot);
    msg.edit('', { embed: loadEmbed });
  }
  const promArr = [];
  for (const uuid of list) {
    promArr.push(i.mc.mojangAPI(uuid));
  }
  const participants = [];
  const userArr = await Promise.all(promArr);
  for (const acct of userArr) {
    if (!acct.error) {
      participants.push(acct.username);
    }
  }
  const fields = [];
  if (participants.length < 64) { // Handling 1024 limit, REWRITE, BAD CODE, REWRITE LATER
    fields.push({ name: `(${participants.length}) Participants`, value: '```\n' + participants.join(', ') + '\n```' });
  } else {
    const arr1 = participants.slice(0, Math.floor((participants.length - 1) / 2));
    // eslint-disable-next-line max-len
    const arr2 = participants.slice(Math.floor((participants.length - 1) / 2), participants.length);
    if (arr1.length >= 64) {
      const arr1a = arr1.slice(0, Math.floor((arr1.length - 1) / 2));
      const arr1b = arr1.slice(Math.floor((arr1.length - 1) / 2), arr1.length);
      const arr2a = arr2.slice(0, Math.floor((arr2.length - 1) / 2));
      const arr2b = arr2.slice(Math.floor((arr2.length - 1) / 2), arr2.length);
      fields.push({ name: `(${participants.length}) Participants`, value: '```\n' + arr1a.join(', ') + '\n```' });
      fields.push({ name: 'Cont.', value: '```\n' + arr1b.join(', ') + '\n```' });
      fields.push({ name: 'Cont.', value: '```\n' + arr2a.join(', ') + '\n```' });
      fields.push({ name: 'Cont.', value: '```\n' + arr2b.join(', ') + '\n```' });
    } else {
      fields.push({ name: `(${participants.length}) Participants`, value: '```\n' + arr1.join(', ') + '\n```' });
      fields.push({ name: 'Cont.', value: '```\n' + arr2.join(', ') + '\n```' });
    }
  }
  const participantEmbed = new MessageEmbed()
    .setTitle(title)
    .setColor(color)
    .addFields(fields)
    .setFooter(foot + ` Last Updated: ${date.toLocaleDateString()} ${date.toLocaleTimeString()} EST`);
  msg.edit('', { embed: participantEmbed });
}

async function eventFirst(msg, eventID, firstTime) {
  const eventInfo = await i.data.getValue('eventinfo', 'event_id', eventID, ['event_name', 'start_date', 'end_condition', 'track_type',
    'end_value', 'value_type', 'creator_discordid', 'perm']);

  const eventDesc = [];
  const startDate = new Date(parseInt(eventInfo.start_date));
  const date = new Date();
  let timeUntil = parseInt(eventInfo.start_date) - Date.now();
  timeUntil /= (1000 * 60);
  if (timeUntil < 1.5) {
    timeUntil = 'Starting Shortly!';
  } else {
    let days = Math.floor(timeUntil / (24 * 60));
    let hours = Math.floor((timeUntil / 60) % 24);
    if (hours === 24) {
      hours = 0;
      days += 1;
    }
    let mins = Math.ceil(timeUntil % 60);
    if (mins === 60) {
      mins = 0;
      hours += 1;
      if (hours === 12) {
        hours = 0;
        days += 1;
      }
    }
    timeUntil = `${days}d ${hours}h ${mins}m`;
  }

  if (eventInfo.end_condition === 'time') { // formatting different kinds of end states
    const dateEnd = new Date(parseInt(eventInfo.end_value));
    eventDesc.push(`[End Time] ${dateEnd.toLocaleDateString()} ${dateEnd.toLocaleTimeString()} EST`);
    if (eventInfo.value_type === 'gain') {
      eventDesc.push(`[How to Play] Gain the most ${eventInfo.track_type} over the course of the event`
      + '\nNOTE: Make sure to have all API turned on!');
    } else {
      eventDesc.push(`[How to Play] Have the most total ${eventInfo.track_type} by the end of the event`
      + '\nNOTE: Make sure you have all API turned on!');
    }
  } else if (eventInfo.value_type === 'gain') {
    eventDesc.push(`[How to Play] Be the first to gain ${eventInfo.end_value} ${eventInfo.track_type}`
    + '\nNOTE: Make sure to have all API turned on!');
  } else {
    eventDesc.push(`[How to Play] Be the first to have a total of ${eventInfo.end_value} ${eventInfo.track_type}`
    + '\nNOTE: Make sure you have all API turned on!');
  }

  if (eventInfo.perm === 'public') {
    eventDesc.push(`[How to Join] React 🖋️ or use\n{prefix} event join ${eventInfo.event_name}`);
  } else {
    eventDesc.push('[How to Join] Ask the creator of the event to add you!');
  }

  const message = new MessageEmbed()
    .setTitle(`[Upcomming Event] ${eventInfo.event_name}`)
    .setColor('FFFF00')
    .addFields(
      { name: 'Start Time', value: '```ini\n' + `[${timeUntil}] ${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()} EST` + '\n```' },
      { name: 'Event Details', value: '```ini\n' + eventDesc.join('\n') + '\n```\n' + `Event created by <@${eventInfo.creator_discordid}>` },
    )
    .setFooter(`[Page 1/2]  Last Updated: ${date.toLocaleDateString()} ${date.toLocaleTimeString()} EST`);
  await msg.edit('', { embed: message });
  if (firstTime) {
    await msg.react('⬅️');
    await msg.react('➡️');
    if (eventInfo.perm === 'public') {
      await msg.react('🖋️');
    }
  }
}

async function eventReact(react, user) { // handles reactions given to event messages
  if (user.bot) return;
  const msg = react.message;
  const isEvent = await i.data.getValue('eventinfo', ['message_id', 'ended'], [msg.id, 'false'],
    ['event_id', 'confirmed', 'creator_discordid', 'started', 'event_name', 'participants',
      'perm', 'last_updated', 'end_condition', 'value_type', 'track_type',
      'update_channel', 'message_id']);
  if (isEvent == null || isEvent.event_id == null || isEvent.ended === 'true') { // no incorrect events or ended events
    return;
  }

  if (isEvent.confirmed === 'false' && (user.id === isEvent.creator_discordid // unconfirmed, confirming.
    || await checkStaff(react.message, react.message.channel.guild.members.cache.get(user.id)))) {
    switch (react.emoji.name) {
      case '✅': {
        msg.reactions.removeAll();
        const confirmMessage = new MessageEmbed()
          .setColor('#00FF00')
          .setTitle('Event Settings and Confirmation')
          .addFields(
            msg.embeds[0].fields[0],
            msg.embeds[0].fields[1],
            { name: 'Event Confirmed', value: 'Showing Event Info in 5 Seconds' },
          );
        msg.edit('', { embed: confirmMessage });
        setTimeout(async () => { await eventFirst(msg, isEvent.event_id, true); }, 1000 * 5);
        i.data.writeValue('eventinfo', 'event_id', isEvent.event_id, 'confirmed', 'true');
        break;
      }
      case '❌': {
        msg.reactions.removeAll();
        const deleteMessage = new MessageEmbed()
          .setColor('#FF0000')
          .setTitle('Event Settings and Confirmation')
          .addFields(
            msg.embeds[0].fields[0],
            msg.embeds[0].fields[1],
            { name: 'Event Canceled', value: 'Message Deleting in 5 Seconds' },
          );
        await msg.edit('', { embed: deleteMessage });
        i.data.deleteValue('eventinfo', 'event_id', isEvent.event_id);
        setTimeout(async () => { await msg.delete(); }, 1000 * 5);
        break;
      }
      default:
        break;
    }
  }

  if (react.emoji.name === '🖋️') { // joining the event
    const cache = reactEventCool.get(user.id);
    if (cache != null) {
      if (cache === 'used') return;
      if (cache === 'warn') {
        react.users.remove(user);
        const warnMsg = await msg.channel.send(`<@${user.id}>, wait before reacting again.`);
        reactEventCool.set(user.id, 'used');
        setTimeout(async () => { await warnMsg.delete(); }, 3000);
        return;
      }
    }
    if (isEvent.perm === 'public') {
      const fakemsg = { author: user };
      const uuid = await i.data.isVerified(fakemsg);
      if (!uuid) {
        const noLink = await msg.channel.send(`<@${user.id}>, link your discord account to a Hypixel account to join events.`);
        reactEventCool.set(user.id, 'warn');
        setTimeout(async () => { await noLink.delete(); }, 5000);
      } else {
        let reply;
        let fail = false;
        let particArr = [];
        if (isEvent.participants != null) {
          particArr = isEvent.participants.split(',');
        }
        let inEvent = false;
        for (const index in particArr) {
          const person = particArr[index];
          if (person === uuid) {
            particArr.splice(index, 1);
            inEvent = true;
            break;
          }
        }
        if (inEvent) {
          await i.data.writeValue('eventinfo', 'event_id', isEvent.event_id, 'participants', particArr.join(','));
          reply = await msg.channel.send(`<@${user.id}>, you have left the event.`);
          fail = true;
        } else particArr.push(uuid);
        if (particArr.length > i.config.maximumEventParticipants) {
          reply = await msg.channel.send(`<@${user.id}>, this event is full.`);
          fail = true;
        }
        if (!fail) {
          reactEventCool.set(user.id, 'warn');
          await i.data.writeValue('eventinfo', 'event_id', isEvent.event_id, 'participants', particArr.join(','));
          reply = await msg.channel.send(`<@${user.id}> successfully joined the event!`
          + '\n**Note:** Make sure you have all API turned on!');
          if (isEvent.started === 'true') { // if user already in the event before
            const existData = await i.data.getValue('eventdata', ['event_id', 'uuid'],
              [isEvent.event_id, uuid], 'value');
            if (existData == null) { // adds data to the list if not in event before
              const mainprof = await i.data.getValue('members', 'uuid', uuid, 'mainprofile');
              const args = {
                id: isEvent.event_id,
                uuid,
                track: isEvent.track_type,
                time: isEvent.last_updated,
                prof: mainprof.mainprofile,
                condition: isEvent.end_condition,
                last: false,
              };
              eventProfiles(args);
            }
          }
        }
        reactEventCool.set(user.id, 'warn');
        setTimeout(async () => { await reply.delete(); }, 5000);
        react.users.remove(user);
        return;
      }
    } else {
      const noPerm = await msg.channel.send(`<@${user.id}>, this event is set to` + form('private')
      + '. Ask the creator to add you if you want to participate');
      reactEventCool.set(user.id, 'warn');
      setTimeout(async () => { await noPerm.delete(); }, 5000);
      react.users.remove(user);
      return;
    }
  }

  // PAGE CHECKS //
  if (isEvent.confirmed === 'true' && isEvent.started === 'false') { // event hasn't started
    react.users.remove(user);
    const page = msg.embeds[0].footer.text.slice(6, 7);
    if (page === '1' && react.emoji.name === '➡️') {
      eventParticipants(msg, isEvent.event_id);
    } else if (page === '2' && react.emoji.name === '⬅️') {
      eventFirst(msg, isEvent.event_id, false);
    }
  }

  if (isEvent.confirmed === 'true' && isEvent.started === 'true') { // event has started
    react.users.remove(user);
    const page = msg.embeds[0].footer.text.slice(6, 7);
    if ((page === '1' && react.emoji.name === '➡️') || (page === '3' && react.emoji.name === '⬅️')) { // go to page 2
      const board = await eventLeaderboard(isEvent.event_id,
        isEvent.last_updated, isEvent.value_type, i.config.eventLeaderSize);
      const channel = await dc.client.channels.fetch(isEvent.update_channel);
      const message = await channel.messages.fetch(isEvent.message_id);
      const now = new Date(Date.now());
      const embed = new MessageEmbed()
        .setColor('#00FF00')
        .setTitle(`[Active Event] ${isEvent.event_name}`)
        .addField(`Top ${i.config.eventLeaderSize} Participants`, '```diff\n' + board + '\n```')
        .setFooter(`[Page 2/3] Last Updated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()} EST`);
      await message.edit({ embed });
    } else if (page === '2') {
      if (react.emoji.name === '⬅️') { // go to page 1
        const cache = eventMsgCache.get(isEvent.event_id);
        if (cache != null) {
          elog('[eventReact] using msg cache');
          msg.edit('', { embed: cache });
        } else {
          eventNotify(isEvent.event_id, false);
        }
      } else if (react.emoji.name === '➡️') { // go to page 3
        eventParticipants(msg, isEvent.event_id);
      }
    }
  }
}

function eventCreateHelp(msg) { // shows format of event create function
  // eslint-disable-next-line no-template-curly-in-string
  // eslint-disable-next-line no-multi-str
  const str = '```ini\n[name:{text}] == The name for the event.\n[start:{millis, hours from now; default: 10 mins from command}] == Time to start the event at.\
  \n[perm:{public,private; default: private}] == If anyone can add themselves to the event, or if the event owner can only add people.\
  \n[type:{a collection, skill, catacombs, sck, mythos, etc.}] == The value tracked for the event.\
  \n[endtype:{time, value, duration}] == How the event ends. Value is the amount of whatever type tracked for event, time is a date in millis since unix epoch, duration is time in hours from start date.\
  \n[valuetype:{gain,total}] == Whether the standings are decided by value gained during the event (everyone starts at zero), or if it includes previous progress\
  \n[endvalue:{number}] == The number for the endtype chosen. Use millis since unix epoch for time, or hours from start date for duration.\
  \n[channel:{discord channel id, default: channel command is executed in}] == The id of the channel (or its mention) to post event data and updates to.```'
  + '**Example**: ' + form('[prefix] event create name:example start:1615073444094 perm:public type:enchanting endtype:value valuetype:gain endvalue:1000000 channel:752587897277906966')
  + '\n**Note**: "millis" means milliseconds from unix epoch (January 1st, 1970). Use a converter like `currentmillis.com` to convert a date and time to this format.';
  msg.channel.send('This command allows you to start events for members to participate in.\nTo start an event, use the command with specified arguments. Those arguments are:\n' + str);
}

async function eventCreate(msg, command) { // creates events
  // CHECKING IF COMMAND ALLOWED //
  command.splice(0, 2);
  if (command[0] === 'help') {
    eventCreateHelp(msg);
    return;
  }
  if (msg.channel.type !== 'text') {
    msg.channel.send('Use this command in a server.');
    return;
  }
  const uuid = await i.data.isVerified(msg);
  if (!uuid) {
    msg.channel.send('Verify your discord account before creating an event.');
    return;
  }

  const totalEvents = await i.data.getValue('eventinfo', ['confirmed', 'ended'], ['true', 'false'], 'event_id');
  if (Array.isArray(totalEvents) && totalEvents.length >= i.config.maximumEvents) {
    msg.channel.send('The maximum amount of pending or active events has been reached. Try again later.');
    return;
  }
  const userNames = [];
  const userEvents = await i.data.getValue('eventinfo', ['creator_uuid', 'ended'], [uuid, 'false'], ['confirmed', 'update_channel', 'event_name']);
  if (Array.isArray(userEvents)) {
    for (const nameEvents of userEvents) {
      userNames.push(nameEvents.event_name);
    }
  } else if (userEvents != null) {
    userNames.push(userEvents.event_name);
  }
  if (userEvents != null && userEvents.length >= i.config.eventsPerUUID) {
    let unconfirmed = false;
    let channel = 'none';
    for (const event of userEvents) {
      if (event.confirmed === 'false') {
        unconfirmed = true;
        channel = `<#${event.update_channel}>`;
      }
    }
    if (unconfirmed) {
      msg.channel.send(`Maximum amount of active events started for this user.\nTo open space up, cancel the event in ${channel} by reacting.\n\nNote: staff can cancel other people's unconfirmed events`);
    } else {
      msg.channel.send('Maximum amount of active events started for this user.');
    }
    return;
  }
  const guildEvents = await i.data.getValue('eventinfo', ['discordguildid', 'ended'], [msg.guild.id, 'false'], ['confirmed', 'update_channel']);
  if (guildEvents != null && guildEvents.length >= i.config.eventsPerServer) {
    let unconfirmed = false;
    let channel = 'none';
    for (const event of guildEvents) {
      if (event.confirmed === 'false') {
        unconfirmed = true;
        channel = `<#${event.update_channel}>`;
        break;
      }
    }
    if (unconfirmed) {
      msg.channel.send(`Maximum amount of active events started for this server.\nTo open space up, cancel the event in ${channel} by\nhaving the creator react.\nNote: staff can cancel other people's unconfirmed events`);
    } else {
      msg.channel.send('Maximum amount of active events started for this server.');
    }
    return;
  }

  // FORMATTING ARGUMENTS //
  let isDuration = false;
  const formArgs = [`${msg.author.username}'s Event`, Date.now() + 1000 * 60 * 10, 'private', 0, 0, 0, uuid, msg.guild.id, 'false', 'false', msg.channel.id, 'none', uuid, 'false', msg.author.id, 0];
  for (const arg of command) {
    const type = arg.substring(0, arg.indexOf(':'));
    const data = arg.substring(arg.indexOf(':') + 1, arg.length);
    const intVer = parseInt(data);
    // eslint-disable-next-line no-self-compare
    const isInt = (intVer === intVer);
    switch (type) {
      case 'name':
        if (userNames.indexOf(data) > -1) {
          msg.channel.send('An active event by ' + form(msg.author.tag) + ' with the name ' + form(data) + ' already exists. Use a different name.');
          return;
        }
        if (data.includes(',')) {
          msg.channel.send('Invalid event name');
          return;
        }
        formArgs[0] = data;
        break;
      case 'type':
        if (i.config.eventTypes[data] != null) {
          formArgs[3] = data;
        } else {
          msg.channel.send('Event type ' + form(data) + ' was not found. Use ' + form('guild event types') + ' for a list of supported event types.');
          return;
        }
        break;
      case 'start':
        if (!isInt) {
          msg.channel.send('Event start dates must be milliseconds since January 1st, 1970. Convert at ' + form('currentmillis.com'));
          return;
        }
        if (data - Date.now() < 0 && Date.now() - data < 1000000) {
          msg.channel.send('Events cannot start in the past.');
          return;
        }
        formArgs[1] = data;
        break;
      case 'perm':
        if (data === 'public' || data === 'private') {
          formArgs[2] = data;
        } else {
          msg.channel.send('Event perm ' + form(data) + ' was not found.');
          return;
        }
        break;
      case 'endtype':
        if (i.config.eventEndConditions.indexOf(data) > -1) {
          if (data === 'duration') {
            isDuration = true;
            formArgs[4] = 'time';
          } else {
            formArgs[4] = data;
          }
        } else {
          msg.channel.send('Event endtype ' + form(data) + ' was not found. Supported types: ' + form('time, value'));
          return;
        }
        break;
      case 'valuetype':
        if (data === 'gain' || data === 'total') {
          formArgs[15] = data;
        } else {
          msg.channel.send('Event valuetype ' + form(data) + ' was not found. Supported types: ' + form('gain, total'));
          return;
        }
        break;
      case 'endvalue':
        if (!isInt) {
          msg.channel.send('Event endvalues must be a number, or milliseconds since January 1st, 1970,'
          + 'or hours from start date. Convert at ' + form('currentmillis.com'));
          return;
        }
        formArgs[5] = data;
        break;
      case 'channel':
        formArgs[10] = data.replace(/[<>#]/g, '');
        break;
      default:
        msg.channel.send('Argument ' + form(arg) + ' does not have an attached identifier.');
        return;
    }
  }
  if (formArgs[3] === 0 || formArgs[4] === 0 || formArgs[5] === 0 || formArgs[15] === 0) {
    msg.channel.send('Incomplete event details. Try again.');
    return;
  }
  if (formArgs[1] < 300000) { // assume hours, not time
    formArgs[1] = Date.now() + formArgs[1] * 1000 * 60 * 60;
  }
  if (isDuration || (formArgs[4] === 'time' && formArgs[5] < 1000)) {
    formArgs[5] = parseInt(formArgs[1]) + parseInt(formArgs[5]) * 1000 * 60 * 60;
  } // ^^ duration, converting from hours in value slot to millis AFTER start date
  const channel = msg.guild.channels.cache.get(formArgs[10]);
  if (channel == null) {
    msg.channel.send('Update channel not found.');
    return;
  }

  // MESSAGE CREATE

  let sendmessage = 'hi';
  let finalValue = formArgs[5];
  if (formArgs[4] === 'time') {
    const length = formArgs[5] - formArgs[1];
    if (formArgs[5] - formArgs[1] < 1000 * 60 * 60) {
      msg.channel.send('Event too short. Events must be at least one hour long');
      return;
    }
    if (length > 1000 * 60 * 60 * 24 * 30) {
      msg.channel.send('Event too long. Events must be at max thirty days long');
    }
    const endDate = new Date(parseInt(formArgs[5]));
    finalValue = `${endDate.toLocaleDateString()} ${endDate.toLocaleTimeString()} EST`;
  }

  const startDate = new Date(parseInt(formArgs[1]));

  sendmessage = new MessageEmbed()
    .setColor('#FFFF00')
    .setTitle('Event Settings and Confirmation')
    .addFields(
      {
        name: 'Event Settings',
        value: '```ini\n'
        + `[Event Name]: ${formArgs[0]}\n`
        + `[Start Date]: ${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()} EST\n`
        + `[Tracking Type]: ${formArgs[3]}\n`
        + `[End Condition]: ${formArgs[4]}\n`
        + `[End Value]: ${finalValue}\n`
        + `[Permissions]: ${formArgs[2]}\n`
        + '```',
      },
      { name: 'Adding Participants', value: 'After the event is confirmed, use\n`[prefix] event add {username1,username2,etc.}`\nto add specific usernames to the event, or\n`[prefix] event add {guild}`\nto add everyone in the guild' },
      { name: 'Confirmation', value: 'React ✅ to confirm event.\nReact ❌ to cancel event.' },
      { name: 'Event Creator', value: `<@${msg.author.id}>` },
    )
    .setFooter("Brought to you by Rajah's finest spaghetti code");

  const updateMessage = await channel.send(`The event details will be posted and updated here.\nReview the event settings before confirming event.\n||<@${msg.author.id}>||`, { embed: sendmessage });
  msg.react('👍');

  // DATABASE WRITING

  await updateMessage.react('✅');
  await updateMessage.react('❌');

  const nameArgs = [
    'event_name', 'start_date', 'perm', 'track_type', 'end_condition',
    'end_value', 'creator_uuid', 'discordguildid', 'started', 'ended',
    'update_channel', 'message_id', 'participants', 'confirmed',
    'creator_discordid', 'value_type',
  ];
  formArgs[11] = updateMessage.id;

  await i.data.insertValue('eventinfo', nameArgs, formArgs);
}

function eventTypes(msg) {
  const vals = Object.keys(i.config.eventTypes);
  msg.channel.send('**Supported Event Types**\n```' + vals.join(', ') + '```');
}

async function eventAdd(msg, command) { // adds people to an event
  if (msg.channel.type !== 'text') {
    msg.channel.send('This is a server-only command');
    return;
  }
  command.splice(0, 2);
  let eventID;
  let eventNameArg = 'N0NE SPECIFI3D';
  let particArg;

  if (command.length === 0) {
    msg.channel.send('No event or participants specified.');
    return;
  }
  if (command.length > 2) {
    msg.channel.send('Too many arguments.\nNote: Specify multiple users by separating by **commas only**, not spaces.');
    return;
  }
  for (const entry of command) {
    if (entry.includes('name:')) {
      eventNameArg = entry.slice(5, entry.length);
    } else {
      particArg = entry;
    }
  }

  // GETTING EVENT ID //
  if (eventNameArg !== 'N0NE SPECIFI3D') { // specified event name
    const eventObj = await i.data.getValue('eventinfo',
      ['event_name', 'discordguildid', 'confirmed', 'ended'],
      [eventNameArg, msg.guild.id, 'true', 'false'],
      ['start_date', 'creator_discordid', 'event_id', 'event_name']);
    if (eventObj == null) {
      msg.channel.send('No active event with name ' + form(eventNameArg) + ' found.');
    }
    if (Array.isArray(eventObj)) { // more than one with the name
      let latestDate = 0;
      let dateIndex;
      let author = false;
      for (const index in eventObj) {
        const event = eventObj[index];
        if (msg.author.id === event.creator_discordid) { // is the creator of the event
          eventID = event.event_id;
          author = true;
          break;
        } else if (event.start_date > latestDate) { // finds most recent event
          latestDate = event.start_date;
          dateIndex = index;
        }
      }
      if (!author) {
        eventID = eventObj[dateIndex].event_id;
      }
    } else {
      eventID = eventObj.event_id;
    }
  } else {
    const eventObj = await i.data.sortedList('eventinfo', 'start_date',
      ['start_date', 'event_id', 'event_name'], ['creator_discordid', 'discordguildid', 'confirmed', 'ended'],
      [msg.author.id, msg.guild.id, 'true', 'false'], 'DESC');
    if (eventObj == null) {
      msg.channel.send('No event specified, or ' + form(msg.author.tag) + ' has no active events');
      return;
    }
    if (Array.isArray(eventObj)) {
      eventID = eventObj[0].event_id;
    } else {
      eventID = eventObj.event_id;
    }
  }

  const infoArg = await i.data.getValue('eventinfo', 'event_id', eventID, ['event_name', 'participants', 'creator_uuid']);
  const name = infoArg.event_name;
  let oldPart = [];
  let uuidArr = [];
  if (infoArg.participants != null) {
    oldPart = infoArg.participants.split(',');
    uuidArr = oldPart;
  }
  // PARSING PARTICIPANTS
  const members = particArg.split(',');
  const checkedUsers = [];
  const successUsers = [];
  const alrOnUsers = []; // users already in the list of participants
  const failUsers = [];
  if (particArg !== 'guild') {
    for (const mem of members) {
      checkedUsers.push(i.mc.mojangAPI(mem).then((res) => {
        if (!res.error) {
          const uuid = res.uuid.replace(/-/g, '');
          if (oldPart.indexOf(uuid) > -1) {
            alrOnUsers.push(mem);
          } else {
            successUsers.push(mem);
            uuidArr.push(uuid);
          }
        } else {
          failUsers.push(mem);
        }
      }));
    }
    await Promise.all(checkedUsers);
  } else { // 'guild' used
    const guild = await i.data.getValue('members', 'uuid', infoArg.creator_uuid, 'mcguild');
    if (guild == null || guild.mcguild == null) {
      msg.channel.send('User is not in a Hypixel guild.');
      return;
    }
    let sucAmt = 0;
    let alrAmt = 0;
    const guildObj = await i.mc.getGuild(guild.mcguild);
    for (const member of guildObj.members) {
      const uuid = member.uuid;
      if (oldPart.indexOf(uuid) > -1) {
        alrAmt += 1;
      } else {
        sucAmt += 1;
        uuidArr.push(uuid);
      }
    }
    successUsers.push(sucAmt);
    alrOnUsers.push(alrAmt);
  }
  if (uuidArr.length > i.config.maximumEventParticipants) {
    msg.channel.send('Maximum amount of participants in event (150) exceeded.');
    return;
  }
  if (uuidArr.length > 0) {
    const uuids = uuidArr.toString();
    console.log(uuidArr);
    await i.data.writeValue('eventinfo', 'event_id', eventID, 'participants', uuids);
  } else {
    msg.channel.send('No valid users found. Check syntax and spelling?');
    return;
  }
  const fields = [];
  if (particArg !== 'guild') {
    const success = successUsers.join('\n');
    const alr = alrOnUsers.join('\n');
    const fail = failUsers.join('\n');
    if (successUsers.length > 0) {
      fields.push({ name: 'Users added to event', value: '```\n' + success + '\n```' });
    }
    if (alrOnUsers.length > 0) {
      fields.push({ name: 'Users already in event', value: '```\n' + alr + '\n```' });
    }
    if (failUsers.length > 0) {
      fields.push({ name: 'Invalid users to add', value: '```\n' + fail + '\n```' });
    }
  } else {
    console.log(successUsers);
    console.log(alrOnUsers);
    if (successUsers[0] > 0) {
      fields.push({ name: 'Guild members added to event', value: '```\n' + successUsers[0] + ' members\n```' });
    }
    if (alrOnUsers[0] > 0) {
      fields.push({ name: 'Guild members already in event', value: '```\n' + alrOnUsers[0] + ' members\n```' });
    }
  }
  const returnMsg = new MessageEmbed()
    .setTitle('Adding users to ' + name)
    .addFields(fields)
    .setFooter('event id: ' + eventID);
  const final = await msg.channel.send(returnMsg);
  msg.react('👍');
  setTimeout(async () => { await final.delete(); }, 1000 * 10);
}

async function eventRemove(msg, command) { // removes people from an event
  if (msg.channel.type !== 'text') {
    msg.channel.send('This is a server-only command');
    return;
  }
  command.splice(0, 2);
  let eventID;
  let eventNameArg = 'N0NE SPECIFI3D';
  let particArg;

  if (command.length === 0) {
    msg.channel.send('No event or participants specified.');
    return;
  }
  if (command.length > 2) {
    msg.channel.send('Too many arguments.\nNote: Specify multiple users by separating by **commas only**, not spaces.');
    return;
  }
  for (const entry of command) {
    if (entry.includes('name:')) {
      eventNameArg = entry.slice(5, entry.length);
    } else {
      particArg = entry;
    }
  }

  // GETTING EVENT ID //
  if (eventNameArg !== 'N0NE SPECIFI3D') { // specified event name
    const eventObj = await i.data.getValue('eventinfo', ['event_name', 'discordguildid', 'confirmed', 'creator_discordid', 'ended'], [eventNameArg, msg.guild.id, 'true', msg.author.id, 'false'], ['start_date', 'event_id', 'event_name']);
    if (eventObj == null) {
      msg.channel.send('No active event by ' + form(msg.author.tag) + ' with name ' + form(eventNameArg) + ' found.');
      return;
    }
    eventID = eventObj.event_id;
  } else {
    const eventObj = await i.data.sortedList('eventinfo', 'start_date',
      ['start_date', 'event_id', 'event_name'], ['creator_discordid', 'discordguildid', 'confirmed', 'ended'],
      [msg.author.id, msg.guild.id, 'true', 'false'], 'DESC');
    if (eventObj == null) {
      msg.channel.send('No event specified, or ' + form(msg.author.tag) + ' has no active events');
      return;
    }
    if (Array.isArray(eventObj)) {
      eventID = eventObj[0].event_id;
    } else {
      eventID = eventObj.event_id;
    }
  }

  const infoArg = await i.data.getValue('eventinfo', 'event_id', eventID, ['event_name', 'participants']);
  const name = infoArg.event_name;
  const oldPart = infoArg.participants.split(',');
  // PARSING PARTICIPANTS
  const members = particArg.split(',');
  const checkedUsers = [];
  const successUsers = [];
  const alrOnUsers = []; // users already in the list of participants
  const failUsers = [];
  const uuidArr = oldPart;
  for (const mem of members) {
    checkedUsers.push(i.mc.mojangAPI(mem).then((res) => {
      if (!res.error) {
        const uuid = res.uuid.replace(/-/g, '');
        if (uuidArr.indexOf(uuid) > -1) {
          uuidArr.splice(uuidArr.indexOf(uuid), 1);
          successUsers.push(mem);
        } else {
          alrOnUsers.push(mem);
        }
      } else {
        failUsers.push(mem);
      }
    }));
  }
  await Promise.all(checkedUsers);
  let writeValue = uuidArr.join(',');
  if (writeValue.length === 0) {
    writeValue = null;
  }
  await i.data.writeValue('eventinfo', 'event_id', eventID, 'participants', writeValue);
  const fields = [];
  const success = successUsers.join('\n');
  const alr = alrOnUsers.join('\n');
  const fail = failUsers.join('\n');
  if (successUsers.length > 0) {
    fields.push({ name: 'Users removed from event', value: '```\n' + success + '\n```' });
  }
  if (alrOnUsers.length > 0) {
    fields.push({ name: 'Already not in event', value: '```\n' + alr + '\n```' });
  }
  if (failUsers.length > 0) {
    fields.push({ name: 'Invalid users to remove', value: '```\n' + fail + '\n```' });
  }
  const returnMsg = new MessageEmbed()
    .setTitle('Removing users from ' + name)
    .addFields(fields)
    .setFooter('event id: ' + eventID);
  const final = await msg.channel.send(returnMsg);
  msg.react('👍');
  setTimeout(async () => { await final.delete(); }, 1000 * 10);
}

async function eventStart(args) { // starts the event
  let hours;
  if (args.end_condition === 'time') {
    hours = Math.round((args.end_value - args.start_date) / (1000 * 60 * 60));
  }
  let amt = args.participants.split(',');
  if (amt == null) amt = [];
  const interval = eventInterval(amt.length, hours);
  const time = Date.now();
  await i.data.writeValue('eventinfo', 'event_id', args.event_id,
    ['started', 'update_interval', 'last_updated'], ['true', interval, time]);
  elog('[eventStart] eventUpdate');
  eventUpdate(args, time);

  console.log(`Function to start event with id ${args.event_id} has fired.`);
}

async function eventTimeout() { // finds events that should have started / ended on time
  const events = await i.data.getValue('eventinfo', 'ended', 'false',
    ['event_id', 'started', 'start_date', 'end_condition', 'end_value',
      'track_type', 'participants']);
  if (events == null) return; // no events

  const now = Date.now();
  const arr = [];
  arr.push(events);
  for (const event of arr.flat()) {
    const args = {
      event_id: event.event_id,
      track_type: event.track_type,
      participants: event.participants,
      condition: event.end_condition,
      end_value: event.end_value,
      start_date: event.start_date,
    };
    if (event.started === 'false' && now >= parseInt(event.start_date)) { // events that should start
      elog(`event start: ${event.event_id}`);
      eventStart(args);
    }
  }
}

const eventLeaderProfile = limiter(async (args) => { // checks leaders
  const res = await hclient.getSkyblockProfiles(args.uuid);
  if (res != null || res.success) {
    let profile;
    if (args.prof == null) { // finding max profile, if specified or not
      profile = i.mc.mainProfile(res.profiles);
    } else {
      profile = res.profiles.find((prof) => prof.profile_id === args.prof);
    }
    const data = eventParticipantValue(profile, args.uuid, args.track);
    let final;
    if (args.value_type === 'gain') { // must subtract first value for gains
      const oldData = await i.data.sortedList('eventdata', 'time', 'value',
        ['uuid', 'event_id'], [args.uuid, args.id], 'ASC', '=', 1);
      if (oldData != null && oldData[0] != null && oldData[0].value != null) {
        final = data - parseInt(oldData[0].value);
      } else {
        final = data;
      }
    } else final = data;

    const args2 = {
      event_id: args.id,
      track_type: args.track,
      participants: args.participants,
      condition: 'value',
    };
    elog(`leader final value: ${final}, leader uuid: ${args.uuid}`);
    elog(res);
    if (final >= args.end_value) {
      elog('[eventLeaderProfile] eventUpdate');
      eventUpdate(args2, Date.now());
    }
  }
}, 1000 * (60 / i.config.maximumEvents) - 20); // makes interval longest so none will ever pile up.

async function leaderCheck() { // gets leaders of value events, passes to leaderProfile
  const res = await i.data.getValue('eventinfo', ['started', 'ended', 'end_condition'],
    ['true', 'false', 'value'], ['event_id', 'track_type', 'end_value', 'leader',
      'value_type', 'participants']);
  if (res == null) return;
  const events = [res];
  for (const e of events.flat()) {
    if (e.leader != null) {
      let profile = null;
      const main = await i.data.getValue('members', 'uuid', e.leader, 'mainprofile');
      if (main != null && main.mainprofile != null) profile = main.mainprofile;
      const args = {
        id: e.event_id,
        track: e.track_type,
        end_value: e.end_value,
        value_type: e.value_type,
        participants: e.participants,
        uuid: e.leader,
        prof: profile,
      };
      await elog('[leaderCheck]');
      await elog(args);
      eventLeaderProfile(args);
    }
  }
}

async function eventEnd(msg, command) { // ends event, deals with user interaction
  if (msg.channel.type !== 'text') {
    msg.channel.send('This is a server-only command');
    return;
  }
  command.splice(0, 2);
  let eventID;
  let eventNameArg = 'N0NE SPECIFI3D';

  if (command.length === 1) {
    eventNameArg = command[0];
  }

  // GETTING EVENT ID //
  if (eventNameArg !== 'N0NE SPECIFI3D') { // specified event name
    const eventObj = await i.data.getValue('eventinfo', ['event_name', 'discordguildid', 'confirmed', 'creator_discordid', 'ended'], [eventNameArg, msg.guild.id, 'true', msg.author.id, 'false'], ['start_date', 'event_id', 'event_name']);
    if (eventObj == null) {
      msg.channel.send('No active event by ' + form(msg.author.tag) + ' with name ' + form(eventNameArg) + ' found.');
      return;
    }
    eventID = eventObj.event_id;
  } else {
    const eventObj = await i.data.getValue('eventinfo', ['creator_discordid', 'discordguildid', 'confirmed', 'ended'], [msg.author.id, msg.guild.id, 'true', 'false'], ['start_date', 'event_id', 'event_name']);
    if (eventObj == null) {
      msg.channel.send('No event specified, or ' + form(msg.author.tag) + ' has no active events');
      return;
    }
    if (Array.isArray(eventObj)) {
      let latestDate = 0;
      let dateIndex;
      for (const index in eventObj) {
        const event = eventObj[index];
        if (event.start_date > latestDate) { // finds most recent event
          latestDate = event.start_date;
          dateIndex = index;
        }
      }
      eventID = eventObj[dateIndex].event_id;
    } else {
      eventID = eventObj.event_id;
    }
  }

  const infoArg = await i.data.getValue('eventinfo', 'event_id', eventID, ['event_name', 'participants', 'started', 'track_type']);
  const name = infoArg.event_name;
  const confirmMessage = new MessageEmbed()
    .setColor('#FFFF00')
    .setTitle(`End ${name} Now?`)
    .addField('Are you sure you want to end this event?', '**IMPORTANT: This cannot be undone**\nReact ✅ to confirm\nReact ❌ to cancel.')
    .setFooter('event id: ' + eventID);
  const sent = await msg.channel.send(confirmMessage);
  await sent.react('✅');
  await sent.react('❌');
  const result = await awaitReaction(sent, ['✅', '❌']);
  let updateMsg;
  if (result === '✅') {
    if (infoArg.started === 'false') {
      i.data.deleteValue('eventinfo', 'event_id', eventID);
    } else {
      const now = Date.now();
      i.data.writeValue('eventinfo', 'event_id', eventID, ['end_condition', 'end_value'], ['time', now - 1]);
      const args = {
        event_id: eventID,
        track_type: infoArg.track_type,
        participants: infoArg.participants,
        condition: 'time',
      };
      elog('[eventEnd] eventUpdate');
      eventUpdate(args, now);
    }
    updateMsg = new MessageEmbed()
      .setColor('#00FF00')
      .setTitle(`${name} Ended`)
      .addField('The event has been ended', 'Event details will no longer update\nThis message will delete in 5 seconds.')
      .setFooter('event id: ' + eventID);
  } else {
    updateMsg = new MessageEmbed()
      .setColor('#FF0000')
      .setTitle('Command Cancelled')
      .addField('The event will continue', 'This message will delete in 5 seconds')
      .setFooter('event id: ' + eventID);
  }
  await sent.edit('', { embed: updateMsg });
  setTimeout(async () => { await sent.delete(); }, 1000 * 5);
}

async function eventRelocate(msg, command) { // relocates event message
  if (msg.channel.type !== 'text') {
    msg.channel.send('This is a server-only command');
    return;
  }
  command.splice(0, 2);
  let eventID;
  let eventNameArg = 'N0NE`SPECIFI3DD8Xy';

  if (command.length === 1) {
    eventNameArg = command[0];
  }

  // GETTING EVENT ID // name:hello
  if (eventNameArg !== 'N0NE`SPECIFI3DD8Xy') { // specified event name
    if (eventNameArg.includes('name:')) eventNameArg = eventNameArg.slice(5, eventNameArg.length);
    const eventObj = await i.data.getValue('eventinfo',
      ['event_name', 'discordguildid', 'confirmed', 'creator_discordid', 'ended'],
      [eventNameArg, msg.guild.id, 'true', msg.author.id, 'false'],
      ['start_date', 'event_id', 'event_name']);
    if (eventObj == null) {
      msg.channel.send('No active event by ' + form(msg.author.tag) + ' with name ' + form(eventNameArg) + ' found.');
      return;
    }
    eventID = eventObj.event_id;
  } else {
    const eventObj = await i.data.sortedList('eventinfo', 'start_date',
      ['start_date', 'event_id', 'event_name'], ['creator_discordid', 'discordguildid', 'confirmed', 'ended'],
      [msg.author.id, msg.guild.id, 'true', 'false'], 'DESC');
    console.log(eventObj);
    if (eventObj == null) {
      msg.channel.send('No event specified, or ' + form(msg.author.tag) + ' has no active events');
      return;
    }
    if (Array.isArray(eventObj)) {
      eventID = eventObj[0].event_id;
    } else {
      eventID = eventObj.event_id;
    }
  }

  const infoArg = await i.data.getValue('eventinfo', 'event_id', eventID, ['event_name', 'message_id', 'update_channel', 'started']);
  const name = infoArg.event_name;
  const confirmMessage = new MessageEmbed()
    .setColor('#FFFF00')
    .setTitle(`Relocate ${name} Here?`)
    .addField('Are you sure you want to move the event to here?',
      'This message will be the new event hub\nReact ✅ to confirm\nReact ❌ to cancel.')
    .setFooter('event id: ' + eventID);
  const sent = await msg.channel.send(confirmMessage);
  await sent.react('✅');
  await sent.react('❌');
  const result = await awaitReaction(sent, ['✅', '❌']);
  let updateMsg;
  if (result === '✅') {
    await i.data.writeValue('eventinfo', 'event_id', eventID, ['message_id', 'update_channel'], [sent.id, sent.channel.id]);
    const channel = await dc.client.channels.fetch(infoArg.update_channel);
    const message = await channel.messages.fetch(infoArg.message_id);
    updateMsg = new MessageEmbed()
      .setColor('#00FF00')
      .setTitle(`${name} Moved`)
      .addField('The event has been moved', 'Showing event details in 5 seconds.')
      .setFooter('event id: ' + eventID);
    setTimeout(async () => {
      message.delete();
      if (infoArg.started === 'true') {
        await eventNotify(eventID, true);
      } else {
        await eventFirst(sent, eventID, 'true');
      }
    }, 1000 * 5);
  } else {
    updateMsg = new MessageEmbed()
      .setColor('#FF0000')
      .setTitle('Command Cancelled')
      .addField("The event won't move", 'This message will delete in 5 seconds')
      .setFooter('event id: ' + eventID);
    setTimeout(async () => { await sent.delete(); }, 1000 * 5);
  }
  await sent.edit('', { embed: updateMsg });
}

async function eventJoin(msg, command) { // joins events if they're public
  command.splice(0, 2);
  if (command.length === 0) {
    msg.channel.send('Please specify an event name to join');
    return;
  }
  const uuid = await i.data.isVerified(msg);
  if (!uuid) {
    msg.channel.send('Please link your account to a Hypixel account before attempting to join events.\nThe command is [prefix] verify [username]');
    return;
  }
  const events = await i.data.sortedList('eventinfo', 'start_date', ['event_id', 'perm', 'participants', 'started'],
    ['event_name', 'confirmed', 'ended'], [command[0], 'true', 'false'], 'DESC');
  let event;
  if (Array.isArray(events)) {
    event = events[0];
  } else {
    event = events;
  }
  if (event == null) {
    msg.channel.send('No active events found with the name ' + form(command[0]));
    return;
  }
  if (event.perm === 'private') {
    msg.channel.send(form(command[0]) + ' is a private event. Ask the creator to add you.');
    return;
  }
  let particArr = [];
  if (event.participants != null) {
    particArr = event.participants.split(',');
  }
  let inEvent = false;
  for (const user of particArr) {
    if (user === uuid) {
      inEvent = true;
      break;
    }
  }
  if (inEvent) {
    msg.channel.send('User already in event.');
    return;
  }
  particArr.push(uuid);
  if (particArr.length > i.config.maximumEventParticipants) {
    msg.channel.send('This event is full.');
    return;
  }
  await i.data.writeValue('eventinfo', 'event_id', event.event_id, 'participants', particArr.join(','));
  msg.channel.send('Successfully joined ' + form(command[0])
  + '!\n**Note:** Make sure you have all API turned on!');
  if (event.started === 'true') { // event started, get first point for this dude
    const e = await i.data.getValue('eventinfo', 'event_id', event.event_id,
      ['track_type', 'last_updated', 'end_condition']);
    const existData = await i.data.getValue('eventdata', ['event_id', 'uuid'],
      [event.event_id, uuid], 'value');
    if (existData == null) { // adds data to the list if not in event before
      const mainprof = await i.data.getValue('members', 'uuid', uuid, 'mainprofile');
      const args = {
        id: e.event_id,
        uuid,
        track: e.track_type,
        time: e.last_updated,
        prof: mainprof.mainprofile,
        condition: e.end_condition,
        last: false,
      };
      eventProfiles(args);
    }
  }
}

async function eventLeave(msg, command) { // leaves events
  command.splice(0, 2);
  if (command.length === 0) {
    msg.channel.send('Please specify an event name to leave');
    return;
  }
  const uuid = await i.data.isVerified(msg);
  if (!uuid) {
    msg.channel.send('User does not have linked account. Link discord to Hypixel account before using this command.');
    return;
  }
  const events = await i.data.sortedList('eventinfo', 'start_date', ['event_id', 'participants'],
    ['event_name', 'confirmed', 'ended'], [command[0], 'true', 'false'], 'DESC');
  let event;
  if (Array.isArray(events)) {
    event = events[0];
  } else {
    event = events;
  }

  let particArr = [];
  if (event.participants != null) {
    particArr = event.participants.split(',');
  }

  let inEvent = false;
  let index;
  for (index in particArr) {
    const user = particArr[index];
    if (user === uuid) {
      inEvent = true;
      break;
    }
  }
  if (inEvent) {
    particArr.splice(index, 1);
    let writeValue = particArr.join(',');
    if (writeValue.length === 0) {
      writeValue = null;
    }
    await i.data.writeValue('eventinfo', 'event_id', event.event_id, 'participants', writeValue);
    msg.channel.send('Successfully left ' + form(command[0]) + '!');
  } else {
    msg.channel.send('User is not in ' + form(command[0]));
  }
}

async function eventList(msg) { // lists active events in server
  if (msg.channel.type !== 'text') {
    msg.channel.send('This command is server-only.');
    return;
  }
  const events = await i.data.getValue('eventinfo', ['discordguildid', 'confirmed'], [msg.guild.id, 'true'], ['creator_discordid', 'confirmed', 'started', 'ended', 'event_name', 'participants']);
  if (events == null) {
    msg.channel.send('This server has no upcomming, active, or past events to list.');
    return;
  }
  const upcomming = [];
  const active = [];
  const past = [];
  for (const event of events) {
    let amount = 0;
    if (event.participants != null) {
      amount = event.participants.split(',').length;
    }
    if (event.ended === 'true' && past.length < 25) past.push(`[Name]: ${event.event_name}  [Participants]: ${amount}`);
    if (event.ended === 'false' && event.started === 'true') active.push(`[Name]: ${event.event_name}  [Participants]: ${amount}`);
    if (event.ended === 'false' && event.started === 'false') upcomming.push(`[Name]: ${event.event_name}  [Participants]: ${amount}`);
  }
  const fields = [];
  if (active.length > 0) fields.push({ name: 'Ongoing Events', value: '```ini\n' + active.join('\n') + '\n```' });
  if (upcomming.length > 0) fields.push({ name: 'Upcomming Events', value: '```ini\n' + upcomming.join('\n') + '\n```' });
  if (past.length > 0 && past.length < 25) {
    fields.push({ name: 'Past Events', value: '```ini\n' + past.join('\n') + '\n```' });
  } else if (past.length > 0) {
    fields.push({ name: 'Some Past Events', value: '```ini\n' + past.join('\n') + '\n```' });
  }

  const listMsg = new MessageEmbed()
    .setTitle(`${msg.guild.name}'s Events`)
    .addFields(fields)
    .setFooter("Brought to you by Rajah's finest spaghetti code");
  msg.channel.send(listMsg);
}

async function eventDebug(msg) {
  if (isBotDev(msg)) {
    const current = await i.data.getValue('info', 'id', 1, 'eventdebug');
    if (current.eventdebug === 'false') {
      i.data.writeValue('info', 'id', 1, 'eventdebug', 'true');
      msg.channel.send('Event debug mode is now ' + form('enabled'));
    } else {
      i.data.writeValue('info', 'id', 1, 'eventdebug', 'false');
      msg.channel.send('Event debug mode is now ' + form('disabled'));
    }
  }
}

function eventMain(msg, command) {
  switch (command[1]) {
    case 'create':
      eventCreate(msg, command);
      break;
    case 'end':
      eventEnd(msg, command);
      break;
    case 'add':
      eventAdd(msg, command);
      break;
    case 'remove':
      eventRemove(msg, command);
      break;
    case 'list':
      eventList(msg);
      break;
    case 'types':
      eventTypes(msg);
      break;
    case 'join':
      eventJoin(msg, command);
      break;
    case 'leave':
      eventLeave(msg, command);
      break;
    case 'move':
      eventRelocate(msg, command);
      break;
    case 'debug':
      eventDebug(msg);
      break;
    default:
      msg.channel.send('Unknown event command.');
      break;
  }
}

// BOT DEV COMMANDS //

async function test1(msg, command) {
  if (isBotDev(msg)) {
    weeklyGEXPList('5eb4d01f8ea8c94128915a85', 0);
  }
}

async function test2(msg, command) {
  if (isBotDev(msg)) {
    const test = {
      yo: 'foo',
      hi: 'bar',
    };
    console.trace(test);
    // console.trace();
  }
}

function updateDiscordUsers(msg) { // gets all users and, if not in already, adds id to database
  if (isBotDev(msg)) {
    const oldDate = Date.now();
    const promiseArr = [];
    const guilds = Array.from(dc.client.guilds.cache.values());
    for (const guild of guilds) {
      const members = Array.from(guild.members.cache.values());
      for (const member of members) {
        promiseArr.push(i.data.fastDiscordIDStore(member.id));
      }
    }
    Promise.all(promiseArr).then((values) => {
      console.log(values);
      msg.channel.send(`Completed in ${Date.now() - oldDate} millis.`);
    });
  }
}

async function updateMCMembers(msg) { // runs the update members function in mcModule
  if (isBotDev(msg)) {
    const timObj = await i.data.getValue('info', 'id', 1, 'memberupdatetime');
    await i.mc.updateMembers(timObj.memberupdatetime);
    msg.channel.send('Members updated.');
  }
}

// HUB FUNCTION //

function hub(msg, index, command) { // called from commandParse. Sends to response functions
  switch (index) {
    case 0:
      test1(msg, command);
      break;
    case 1:
      test2(msg, command);
      break;
    case 2:
      changePrefix(msg, command);
      break;
    case 3:
      checkTimeRank(msg, command);
      break;
    case 4:
      addStaffRole(msg, command);
      break;
    case 5:
      linkGuild(msg, command);
      break;
    case 6:
      verify(msg, command);
      break;
    case 7:
      updateDiscordUsers(msg);
      break;
    case 8:
      updateMCMembers(msg);
      break;
    case 9:
      eventMain(msg, command);
      break;
    case 10:
      updateHours(msg, command);
      break;
    case 11:
      xpResponse(msg, command);
      break;
    case 12:
      addPass(msg, command);
      break;
    case 13:
      overrideProfile(msg, command);
      break;
    default: // this should not happen, ever
      msg.channel.send('Internal error');
      console.log('Index value for command not -1, but not found in switch case.');
      break;
  }
}

module.exports = {
  hub,
  newGuild,
  memberAndRank,
  eventReact,
  eventTimeout,
  eventUnconfirm,
  leaderCheck,
  eventIntervalCheck,
};
