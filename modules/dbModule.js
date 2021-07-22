/* eslint-disable linebreak-style */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-console */
/* eslint-disable prefer-promise-reject-errors */
/* eslint eqeqeq: ["error", "smart"] */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable radix */

const Cache = require('node-cache');

const i = require('../index');

const db = new i.sql.Database('./database.db');
const userCache = new Cache();

function getValue(table, knownColumn, knownValue, unknownColumn, equality) { // use "all" for no con
  // const date = Date.now(); // lag testing
  return new Promise((resolve, reject) => { // gets value from table following equality
    let statement = equality;
    // eslint-disable-next-line eqeqeq
    if (equality === undefined) statement = '='; // sets equality if none specified

    let condition; // allows for no filter mechanism
    let knownValueArr = [];
    if (knownColumn === 'all') {
      condition = '';
      knownValueArr = [];
    } else if (Array.isArray(knownColumn)) { // allows for multiple conditions
      condition = 'WHERE ';
      if (Array.isArray(knownValue)) {
        const conditionArr = Array.isArray(statement);
        for (const index in knownColumn) {
          let sign = statement;
          if (conditionArr) {
            sign = statement[index];
          }
          knownValueArr.push(knownValue[index]);
          condition = condition.concat(`${knownColumn[index]} ${sign} ? AND `);
        }
        condition = condition.slice(0, -5);
      } else {
        knownValueArr = [knownValue];
        for (const column of knownColumn) {
          condition = condition.concat(`${column} = ? AND `);
        }
        condition = condition.slice(0, -5);
      }
    } else {
      condition = `WHERE ${knownColumn} ${statement} ?`;
      knownValueArr = [knownValue];
    }

    let query = 'SELECT '; // creates the SQL query, has array support
    const isArray = Array.isArray(unknownColumn);
    if (isArray) {
      for (const entry of unknownColumn) {
        query = query.concat(`${entry}, `);
      }
      query = query.slice(0, -2);
    } else {
      query = query.concat(`${unknownColumn}`);
    }
    query = query.concat(` FROM ${table} ${condition}`);

    db.all(query, knownValueArr, (err, row) => { // sends, handles and formats result
      if (err) reject(err);
      if (row === undefined) {
        console.log(`getValue row undefined. Query: ${query}`);
        return;
      }
      switch (row.length) {
        case 0:
          resolve(null);
          break;
        case 1:
          resolve(row[0]);
          break;
        default:
          resolve(row);
          break;
      }
    });
  });
}

// eslint-disable-next-line no-shadow
function writeValue(table, knownColumn, knownValue, writeColumn, writeValue, equality) {
  return new Promise((resolve, reject) => { // writes value(s) to row(s) in a table
    let statement = equality;
    let condition;
    if (equality === undefined) statement = '='; // sets equality if none specified

    let query = `UPDATE ${table} SET `;

    const isArrayColumn = Array.isArray(writeColumn); // array support detection writeColumn and
    const isArrayValue = Array.isArray(writeValue); // writeValue must be lined up and equal lengths
    const values = [];
    if (isArrayColumn || isArrayValue) {
      if (isArrayColumn !== isArrayValue) reject('writeColumn and writeValue not same data type (one array, one not)'); // syntax error checks
      if (writeColumn.length !== writeValue.length) reject('writeColumn and writeValue different lengths');
      for (const index in writeColumn) { // does if write columns and values are arrays
        query = query.concat(`${writeColumn[index]} = ?, `);
        values.push(writeValue[index]);
      }
      query = query.slice(0, -2);
    } else { // does if they are not arrays
      query = query.concat(`${writeColumn} = ?`);
      values.push(writeValue);
    }
    if (Array.isArray(knownColumn)) { // allows for multiple conditions
      condition = ' WHERE ';
      if (Array.isArray(knownValue)) {
        const conditionArr = Array.isArray(statement);
        for (const index in knownColumn) {
          let sign = statement;
          if (conditionArr) {
            sign = statement[index];
          }
          values.push(knownValue[index]);
          condition = condition.concat(`${knownColumn[index]} ${sign} ? AND `);
        }
        condition = condition.slice(0, -5);
      } else {
        values.push(knownValue);
        for (const column of knownColumn) {
          condition = condition.concat(`${column} = ? AND `);
        }
        condition = condition.slice(0, -5);
      }
    } else {
      condition = ` WHERE ${knownColumn} ${statement} ?`;
      values.push(knownValue);
    }
    query = query.concat(condition);

    db.run(query, values, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}

// eslint-disable-next-line no-shadow
function insertValue(table, writeColumn, writeValue) {
  return new Promise((resolve, reject) => {
    let query = `INSERT INTO ${table}(`;

    const isArrayColumn = Array.isArray(writeColumn); // array support detection, writeColumn and
    const isArrayValue = Array.isArray(writeValue); // writeValue must be lined up and equal lengths
    if (isArrayColumn || isArrayValue) { // deals with writeColumn syntax
      if (isArrayColumn !== isArrayValue) reject('writeColumn and writeValue not same data type (one array, one not)'); // syntax error checks
      if (writeColumn.length !== writeValue.length) reject('writeColumn and writeValue different lengths');
      for (const column of writeColumn) {
        query = query.concat(`${column}, `);
      }
      query = query.slice(0, -2);
    } else {
      query = query.concat(`${writeColumn}`);
    }
    query = query.concat(') VALUES(');

    let values;
    if (isArrayColumn || isArrayValue) { // deals with writeValue syntax
      const question = '?, ';
      query = query.concat(question.repeat(writeValue.length));
      query = query.slice(0, -2);
      values = writeValue;
    } else {
      query = query.concat('?');
      values = [writeValue];
    }
    query = query.concat(')'); // FINISH QUERY SYNTAX

    db.run(query, values, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}

function deleteValue(table, whereColumn, whereValue, equality) { // deletes all rows with condition
  return new Promise((resolve, reject) => {
    let statement = equality;
    if (equality === undefined) statement = '='; // sets equality if none specified

    const query = `DELETE FROM ${table} WHERE ${whereColumn} ${statement} ?`;

    db.all(query, [whereValue], (err) => { // sends request
      if (err) reject(err);
      resolve();
    });
  });
}

async function addValue(table, knownColumn, knownValue, addColumn, addAmount, equality) { // add int
  let equal = '=';
  if (equality != null) {
    equal = equality;
  }
  let val = await getValue(table, knownColumn, knownValue, addColumn, equal);
  let newVal = 0;
  if (val == null) {
    await insertValue(table, knownColumn, knownValue);
    newVal = addAmount;
  } else if (val[addColumn] == null) {
    newVal = addAmount;
  } else {
    val = parseInt(val[addColumn]);
    newVal = val + addAmount;
  }

  if (newVal < 0) {
    newVal = 0;
  }

  await writeValue(table, knownColumn, knownValue, addColumn, newVal, equal);
}

function hasDiscordGuild(minecraftGuildID) { // returns with discord id if the guild has a discord
  return new Promise((resolve, reject) => {
    const query = 'SELECT g.discordguildid discord, g.mcguildid mc FROM guilds g JOIN mcguilds m ON(m.guildid == g.mcguildid);';
    db.all(query, [], (err, rows) => { // make this run for array once, not each entry [PERFORMANCE]
      if (err) reject(err);
      for (const row of rows) {
        if (row.mc === minecraftGuildID) {
          resolve(row.discord);
        }
      }
      resolve(false);
    });
  });
}

function hasDiscordAccount(uuid) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT u.discordid discord, u.uuid mc FROM users u JOIN members m ON(m.uuid == u.uuid);';
    db.all(query, [], (err, rows) => {
      if (err) reject(err);
      for (const row of rows) {
        if (row.mc === uuid) {
          resolve(row.discord);
        }
      }
      resolve(false);
    });
  });
}

function isVerified(msg) { // looks for a uuid connected to a discord id
  return new Promise((resolve, reject) => {
    const query = `SELECT uuid FROM users WHERE discordid = "${msg.author.id}"`;
    db.all(query, [], (err, row) => {
      if (err) reject(err);
      if (row != null && row[0].uuid != null) {
        resolve(row[0].uuid);
      } else {
        resolve(false);
      }
    });
  });
}

function sortedList(table, columnToSort, columnToGet, conditionColumn,
  conditionValue, sortDirection, conditionEquality, limit) {
  return new Promise((resolve, reject) => {
    let cond = conditionEquality;
    let condition;
    const conditionValueArr = [];
    let query = `SELECT ${columnToGet} FROM ${table} `;
    if (cond == null) cond = '=';
    if (Array.isArray(conditionColumn)) { // allows for multiple conditions
      condition = 'WHERE ';
      if (Array.isArray(conditionValue)) {
        const conditionArr = Array.isArray(cond);
        for (const index in conditionColumn) {
          let sign = cond;
          if (conditionArr) {
            sign = cond[index];
          }
          conditionValueArr.push(conditionValue[index]);
          condition = condition.concat(`${conditionColumn[index]} ${sign} ? AND `);
        }
        condition = condition.slice(0, -5);
      } else {
        conditionValueArr.push(conditionValue);
        for (const column of conditionColumn) {
          condition = condition.concat(`${column} = ? AND `);
        }
        condition = condition.slice(0, -5);
      }
    } else {
      condition = `WHERE ${conditionColumn} ${cond} ?`;
      conditionValueArr.push(conditionValue);
    }
    query = query.concat(`${condition} ORDER BY ${columnToSort} ${sortDirection}`);
    if (limit != null) {
      query = query.concat(` LIMIT ${limit}`);
    }
    db.all(query, conditionValueArr, (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
}

async function placement(table, columnToSort, columnToGet, conditionColumn, // returns place in list
  conditionValue, sortDirection, get, conditionEquality) {
  const list = await sortedList(table, columnToSort, columnToGet, conditionColumn,
    conditionValue, sortDirection, conditionEquality);
  let place = 'none';
  for (const index in list) {
    const entry = list[index];
    if (entry[columnToGet] === get) {
      place = parseInt(index) + 1;
      break;
    }
  }

  return [place, list.length];
}

function fastDiscordIDStore(id) { // fastest, streamlined command to make sure user is in database
  return new Promise((resolve, reject) => {
    const res = userCache.get(id);
    if (res !== 'cached') {
      userCache.set(id, 'cached', 43200);
      db.run('SELECT discordid FROM users WHERE discordid = ?', [id], (err, row) => {
        if (err) {
          reject(err);
        }
        if (row == null) {
          db.run('INSERT INTO users(discordid) VALUES(?)', [id], (err2) => {
            if (err2) {
              reject(err);
            } else {
              resolve(true);
            }
          });
        }
        resolve(false);
      });
    } else {
      resolve(true);
    }
  });
}

async function firstValue(eventID, uuidIn) { // finds first value in database (if any)
  const uuids = [uuidIn];
  const eventData = await getValue('eventdata', 'event_id', eventID,
    ['uuid', 'value', 'time']);
  if (eventData == null) return [];
  const data = [eventData].flat();
  data.sort((a, b) => a.time - b.time);
  const res = [];
  for (const uuid of uuids.flat()) {
    let early = data.find((pred) => pred.uuid === uuid);
    if (early === -1) early = -1;
    else if (early == null) early = 0;
    else early = early.value;
    res.push({
      uuid,
      first: early,
    });
  }
  return res.sort((a, b) => b.first - a.first);
}

async function writeFirst(eventID, uuid, val) {
  const eventData = await getValue('eventdata', 'event_id', [eventID, uuid], 'time');
  if (eventData != null) {
    const data = [eventData].flat();
    data.sort((a, b) => a.time - b.time);
    if (val == null) val = 0;
    await writeValue('eventdata', ['event_id', 'uuid', 'time'],
      [eventID, uuid, data[0].time], 'value', val);
  }
}

/* function newHours(array) { // sets hours of [uuid, time] format
  const finish = [];
  for (const entry of array) {
    finish.push(writeValue('guildtime', 'uuid', entry[0], 'time', entry[1]));
  }
  Promise.all(finish).then(() => {
    console.log('newHours complete.');
  });
} */

async function reducePasses() { // removes 1 from pass holders
  const amtObj = await getValue('passes', 'all', 'all', ['uuid', 'mcguildid', 'amount']);
  if (amtObj == null) return;
  const promArr = [];
  for (const entry of amtObj) {
    if (entry.amount != null && entry.amount > 0) {
      promArr.push(writeValue('passes', ['uuid', 'mcguildid'], [entry.uuid, entry.mcguildid], 'amount', entry.amount - 1));
    }
  }
  await Promise.all(promArr);
}

function test(input) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT members.uuid, users.discordid, members.jointime FROM members JOIN users ON (members.uuid = users.uuid);';
    db.all(query, [], (err, output) => {
      if (err) reject(err);
      resolve(output);
    });
  });
}

// module.exports.test = test
// module.exports.newHours = newHours; // only used for migration
module.exports = {
  getValue,
  writeValue,
  insertValue,
  deleteValue,
  addValue,
  hasDiscordGuild,
  hasDiscordAccount,
  isVerified,
  sortedList,
  placement,
  fastDiscordIDStore,
  reducePasses,
  firstValue,
  writeFirst,
  test,
};
