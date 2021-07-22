/* eslint-disable linebreak-style */
/* eslint-disable radix */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-console */
/* eslint-disable prefer-promise-reject-errors */
/* eslint eqeqeq: ["error", "smart"] */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */

const HypixelAPI = require('hypixel-api');
const { DateTime } = require('luxon');
const Cache = require('node-cache');
const i = require('../index');

const hclient = new HypixelAPI(i.creds.hypixelKey);
const guildCache = new Cache({ stdTTL: 900 });
const memberCache = new Cache({ stdTTL: 900 }); // stores uuid/guildmember
const mojangCache = new Cache({ stdTTL: 7200 }); // stores username/uuid and uuid/username pairs

async function mojangAPI(user) { // takes username or uuid and returns Electroid's user object
  user = user.replace(/-/g, '');
  user = user.toLowerCase();
  const memCacheCheck = mojangCache.get(user);
  if (memCacheCheck != null) { // using 2hr cache
    return memCacheCheck;
  }
  const res = await i.c(`https://api.ashcon.app/mojang/v2/user/${user}`).send();
  if (res == null) return null;
  const out = JSON.parse(await res.text());
  if (!out.error) { // if previously failed cache check, store now
    mojangCache.mset([
      { key: out.username.toLowerCase(), val: out },
      { key: out.uuid.replace(/-/g, ''), val: out },
    ]); // 2hr cache
  }
  return out;
}

function setupCache(guildObj) { // sets up cache keys for everyone in a guild
  return new Promise((resolve) => {
    const cacheArr = [];
    for (const member of guildObj.guild.members) {
      const memWithID = member;
      memWithID.guildid = guildObj.guild._id;
      cacheArr.push({ key: member.uuid, val: memWithID });
    }
    memberCache.mset(cacheArr);
    resolve(true);
  });
}

async function getGuild(guildID) { // uses hclient getguild, or cache
  return new Promise((resolve) => {
    const cacheCheck = guildCache.get(guildID);
    if (cacheCheck != null) {
      resolve(cacheCheck);
    } else {
      hclient.getGuild(guildID).then((res) => {
        if (res.success && res.guild != null) {
          guildCache.set(res.guild._id, res.guild);
          setupCache(res);
          resolve(res.guild);
        } else {
          resolve(false);
        }
      });
    }
  });
}

async function findGuild(type, value) {
  return new Promise((resolve, reject) => {
    if (type === 'member') {
      const cache = memberCache.get(value);
      if (cache != null) {
        resolve(cache.guildid);
      }
    }
    hclient.findGuild(type, value).then((res) => {
      if (res != null && res.success) {
        resolve(res.guild);
      }
      resolve(false);
    });
  });
}

/* async function migrateHelp() {
  const s = await hclient.getGuild('5eb4d01f8ea8c94128915a85');
  const array = [];
  const now = Date.now();
  if (s.success) {
    for (const memObj of s.guild.members) {
      const dif = now - memObj.joined;
      const hours = parseInt((dif / (1000 * 60 * 60)).toFixed(1));
      array.push([memObj.uuid, hours]);
    }
  }
  i.data.newHours(array);
} */

function findRank(time) { // returns index value of rank for given integer input
  let curRank = 0;
  const hours = i.config.discordRankHours;
  if (time >= i.config.discordRankHours[i.config.discordRankHours.length - 1]) {
    return (parseInt(i.config.discordRankHours.length) - 1);
  }
  for (const rank in hours) { // finds the index of the next rank
    if (rank === hours.length || (time >= hours[parseInt(rank)]
      && time < hours[parseInt(rank) + 1]) || time === 0) {
      curRank = rank;
      break;
    }
  }
  return (parseInt(curRank));
}

async function dayXPFunction(days, newDate) { // takes days since lastdate and adds new gexp entries
  const startDate = new Date(); // for how long the command takes
  const gexpGuilds = await i.data.getValue('mcguilds', 'all', -1, ['guildid', 'guildname']);
  const isArray = Array.isArray(gexpGuilds);

  const guilds = [];
  if (isArray) { // generates an array of guild objects
    const guildInfo = [];
    for (const guild of gexpGuilds) {
      guildInfo.push(getGuild(guild.guildid));
    }
    const guildsObj = await Promise.allSettled(guildInfo);
    for (const index in guildsObj) { // if there are many guilds in database
      const guild = guildsObj[index];
      if (!guild.value) {
        console.log(`guildInfo failed for guildid "${gexpGuilds[index].guildid}".`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (guild.value) { // only pushes guilds if mc guild is filled
        if (gexpGuilds[index].guildname !== guild.value.name) {
          i.data.writeValue('mcguilds', 'guildid', guild.guildid, 'guildname', guild.name); // updates guild name
        }
        guilds.push(guild.value);
      }
    }
  } else { // if there is only 1 guild in database
    const guildInfo = await getGuild(gexpGuilds.guildid);

    if (!guildInfo) guilds.push(guildInfo); // only pushes guilds if has mc guild
  }

  const daysToCheck = []; let checkDay = 1; const epochTime = [];
  while (checkDay <= days) { // gets dates to check
    const checkTime = newDate - (checkDay * (1000 * 60 * 60 * 24)); // converts into millis
    epochTime.push(checkTime); // pushes to array, to add to final outputs "time" column later
    const date = DateTime.fromMillis(checkTime, { zone: 'America/New_York' }); // force converts to EST

    let { day } = date;
    let { month } = date; // makes sure its 2 digits
    if (day <= 9) day = `0${day}`;
    if (month <= 9) month = `0${month}`;

    daysToCheck.push(`${date.year}-${month}-${day}`); // pushes in hypixel api format
    checkDay += 1; // iterates upward
  }

  const outputs = [];
  const logs = [];
  for (const guild of guilds) { // generates array of (uuids, guild id, gexp, date)
    for (const member of guild.members) { // goes through every member for particular guild
      for (const day in member.expHistory) { // goes through all expHistory for particular member
        const index = daysToCheck.indexOf(day); // finds day in daysToCheck
        if (index > -1) {
          const array = [member.uuid, guild._id, member.expHistory[day],
            epochTime[index], daysToCheck[index]];
          try {
            outputs.push(i.data.insertValue('gexp', ['uuid', 'mcguildid', 'gexp', 'time', 'date'], array));
            logs.push(array); // for debug purposes, log of this down 8 lines
          } catch (err) {
            console.log(err);
          }
        }
      }
    }
  }
  await Promise.all(outputs);
  console.log(`dayXPFunction finished in: ${Date.now() - startDate} millis`);
}

async function xpCalc(uuid) { // returns gexp, guild, and placement for a user.
  // const now = Date.now();
  const cachedMember = memberCache.get(uuid); // finds guild in cache
  let memObj;
  let guildObj;
  if (cachedMember == null) {
    const idObj = await findGuild('member', uuid); // finding guild id based on username
    if (idObj) {
      guildObj = await getGuild(idObj); // finding guild info based on id
      if (!guildObj) { // fail
        return 'getGuild returned false';
      }
      memObj = guildObj.members.find((member) => member.uuid === uuid);
      memObj.guildid = guildObj._id;
    } else if (idObj === false) { // fail
      return [false, 'no guild'];
    } else {
      return [false, 'no guild'];
    }
  } else {
    memObj = cachedMember;
    guildObj = guildCache.get(cachedMember.guildid);
  }

  const date = new Date(); // EST ONLY, TIMEZONE ISSUE IF ELSEWHERE!
  let DoW = date.getDay();
  DoW += -1;
  if (DoW < 0) DoW = 6; // sunday last day, not first
  const xpList = [];

  for (const entry of guildObj.members) {
    const xpArr = Object.values(entry.expHistory).splice(0, DoW + 1);
    const xpSum = xpArr.reduce((a, b) => a + b);
    xpList.push({ uuid: entry.uuid, xp: xpSum }); // array of objects for each person
  }

  xpList.sort((a, b) => b.xp - a.xp); // sort descending
  const place = xpList.findIndex((entry) => entry.uuid === uuid) + 1;
  const cacheG = await getGuild(memObj.guildid);
  const hours = date.getHours();
  const prog = DoW * 24 + hours; // current hours out of hours in a week
  let weekTotal = Math.round((xpList[place - 1].xp / (prog)) * 7 * 24);
  // eslint-disable-next-line no-self-compare
  if (weekTotal !== weekTotal) {
    weekTotal = 0;
  }
  return [xpList[place - 1].xp, weekTotal, [place, xpList.length], cacheG.name, cacheG._id];
}

async function updateMembers(memberupdatetime) { // updates member's guild statuses
  if (memberupdatetime == null) { // if u dont set it fucks the database.
    console.log('SET MEMBERUPDATETIME!!!!!!!!!!!!');
    return;
  }
  const guilds = await i.data.getValue('mcguilds', 'all', 0, 'guildid'); // guilds in database
  const memObj = await i.data.getValue('members', 'all', 0, 'uuid'); // members in database
  const now = Date.now();
  // eslint-disable-next-line radix
  const diff = now - parseInt(memberupdatetime);
  const hoursSince = Math.round(diff / 360000) / 10; // hours since last check, rounded to 1 decimal

  const databaseMembers = []; // members already in the database holding array
  for (const obj of memObj) {
    databaseMembers.push(obj.uuid);
  }

  const rankGiving = []; // list of uuids to give ranks to, if applicable
  const rankRevoke = []; // list of uuids to remove ranks from
  const guildObjPromise = [];
  const guildDiscPromise = [];
  for (const guildObj of guilds) { // gets each guild's data
    guildObjPromise.push(getGuild(guildObj.guildid));
    guildDiscPromise.push(i.data.hasDiscordGuild(guildObj.guildid));
  }

  let guildArr;
  let idArr;
  try {
    guildArr = await Promise.all(guildObjPromise);
    idArr = await Promise.all(guildDiscPromise);
  } catch (err) {
    console.log(guilds);
    console.log(guildArr);
    console.log(guildObjPromise);
    console.log(idArr);
    console.log(guildDiscPromise);
    console.log(`[UPDATE MEMBER ERROR]: ${err}`);
    return;
  }

  for (const u in guilds) { // loops guilds in database
    const guild = guilds[u].guildid;
    const discordID = idArr[u];
    const data = guildArr[u];
    if (data) {
      for (const entry of data.members) { // loops players from API
        const uuid = entry.uuid;
        const index = databaseMembers.indexOf(uuid);
        if (index === -1) { // person new to database
          i.data.insertValue('members', ['uuid', 'mcguild'], [uuid, guild]).then(() => {
            i.data.insertValue('guildtime', ['uuid', 'mcguildid', 'time'], [uuid, guild, i.config.memberCheckUpdateFrequency]);
            i.data.insertValue('passes', ['uuid', 'mcguildid', 'amount'], [uuid, guild, 1]);
          });
          if (discordID) {
            rankGiving.push([uuid, guild, 0]);
          }
        } else { // person not new to database
          databaseMembers.splice(index, 1);

          i.data.getValue('members', 'uuid', uuid, 'mcguild').then((output) => { // updates guild affiliation if needed
            if (output.mcguild !== guild) {
              i.data.writeValue('members', 'uuid', uuid, 'mcguild', guild);
              i.data.hasDiscordGuild(output.mcguild).then((result) => {
                if (result) {
                  rankRevoke.push([uuid, result]); // [uuid, discordguildid]
                }
              });
              if (discordID) {
                i.data.getValue('guildtime', 'uuid', uuid, 'time').then((hours) => {
                  if (hours != null && hours.time != null) {
                    const rank = findRank(hours.time);
                    rankGiving.push([uuid, discordID, rank]);
                  } else {
                    rankGiving.push([uuid, discordID, 0]);
                  }
                });
              }
            }
          });

          i.data.getValue('guildtime', ['uuid', 'mcguildid'], [uuid, guild], 'time').then((dataTime) => {
            if (!dataTime) { // indicates no entry for that guild in database, person moved guilds
              i.data.insertValue('guildtime', ['uuid', 'mcguildid', 'time'], [uuid, guild, i.config.memberCheckUpdateFrequency]);
            } else if (discordID) { // indicates stayed in guild, add time
              i.data.writeValue('guildtime', ['uuid', 'mcguildid'], [uuid, guild], 'time', dataTime.time + hoursSince);
              let currentRank = i.config.discordRankHours.length - 1;
              for (const hoursRank of i.config.discordRankHours) { // deals with discord ranks
                if (dataTime.time < hoursRank) { // finds biggest rank already applicable for
                  currentRank = i.config.discordRankHours.indexOf(hoursRank);
                  break;
                }
              }
              if (currentRank < i.config.discordRankHours.length // new rank check
                && dataTime.time + hoursSince >= i.config.discordRankHours[currentRank]) {
                rankGiving.push([uuid, discordID, currentRank]);
              }
            }
          });
        }
      }
    }
  }

  for (const uuid of databaseMembers) { // in database, but not in api member lists, no guild
    i.data.getValue('members', 'uuid', uuid, 'mcguild').then((output) => {
      i.data.hasDiscordGuild(output.mcguild).then((res) => {
        if (res) {
          rankRevoke.push([uuid, res]);
        }
      });
      i.data.writeValue('members', 'uuid', uuid, 'mcguild', null);
    });
  }
  setTimeout(() => { // waits for functions to complete so rank assigning can start
    i.discModule.memberAndRank(rankGiving, rankRevoke);
    i.data.writeValue('info', 'id', 1, 'memberupdatetime', now);
    console.log('member lists and guild affliliations updated.');
  }, 5000);
}

async function getGuildInfo(input) { // getsmcguild info from input
  console.log('input');
}

function skillAverage(uuidProfile) {
  const skills = [];
  const xpArr = i.config.levelXP;
  for (const type of i.config.eventTypes.skillaverage) {
    const cap = i.config.skillCap[type];
    const val = uuidProfile[type];
    if (val != null) {
      let level;
      if (val >= xpArr[cap]) {
        level = cap;
        skills.push(level);
      } else {
        for (const ind in xpArr) {
          if (val < xpArr[ind]) {
            level = ind - 1;
            level += (val - xpArr[ind - 1]) / (xpArr[ind] - xpArr[ind - 1]);
            skills.push(level);
            break;
          }
        }
      }
    } else {
      skills.push(0);
    }
  }
  const ave = skills.reduce((a, b) => a + b) / skills.length;
  return ave;
}

function mainProfile(profiles, uuid) { // gets main profile based on skill average
  const res = [];
  for (const prof of profiles) {
    res.push([i.mc.skillAverage(prof.members[uuid]), prof]);
  }
  res.sort((a, b) => b[0] - a[0]);
  return res[0][1];
}

async function test(input) {
  updateMembers();
}

// module.exports.migrateHelp = migrateHelp;

module.exports = {
  // eslint-disable-next-line object-shorthand
  hclient: hclient,
  getGuild,
  findGuild,
  xpCalc,
  mojangAPI,
  updateMembers,
  dayXPFunction,
  getGuildInfo,
  findRank,
  skillAverage,
  mainProfile,
  test,
};
