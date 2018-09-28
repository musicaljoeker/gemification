'use strict';
/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This is a sample Slack Button application that adds a bot to one or many slack
teams.

RUN THE APP:
Create a Slack app. Make sure to configure the bot user!
  -> https://api.slack.com/applications/new
  -> Add the Redirect URI: http://gemification.mio.uwosh.edu/oauth
Run your bot from the command line:
clientId=<my client id> clientSecret=<my client secret> port=3000 node
  gemification.js
# USE THE APP
  Add the app to your Slack by visiting the login page:
    -> http://gemification.mio.uwosh.edu/login
  After you've added the app, try talking to your bot!
# EXTEND THE APP:
  botkit has many features for building cool and useful bots!
  Read all about it here:
    -> http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

/* Uses the slack button feature to offer a real time bot to multiple teams */
let Botkit = require('./lib/Botkit.js');
// MySQL ORM package
let mysql = require('mysql');
// Gemification server credentials
let DBCredentials = require('./db-credentials.js');
// Instantiating memory object caching
let redis = require('redis');
let redisClient = redis.createClient();
redisClient.on('error', function(err) {
  console.log('Error in Redis Client: ' + err);
});
// including the dateformat library
let dateFormat = require('dateformat');

// If the user who starts Gemification doesn't have all the proper information,
// then error.
if (!process.env.clientId ||
    !process.env.clientSecret ||
    !process.env.port ||
    !process.env.redirectUri) {
  console.log('Error: Specify clientId clientSecret ' +
  'redirectUri and port in environment');
  process.exit(1);
}

// Setting up the Slack controller
let controllerOptions = {
  json_file_store: './db_slackbutton_bot/',
  interactive_replies: true,
  retry: Infinity,
};
let controller = Botkit.slackbot(controllerOptions);

// Configuring the controller for the Slack app
let slackAppOptions = {
  clientId: process.env.clientId,
  clientSecret: process.env.clientSecret,
  redirectUri: process.env.redirectUri,
  scopes: ['bot'],
};
controller.configureSlackApp(slackAppOptions);

// Instantiating the Gemification database pool
let DBPool = mysql.createPool({
  host: DBCredentials.HOST,
  user: DBCredentials.USERNAME,
  password: DBCredentials.PASSWORD,
  database: DBCredentials.DATABASE,
});

// Setting up a webserver so that users can install Gemification to their Slack
// team. http://gemification.mio.uwosh.edu/login
controller.setupWebserver(process.env.port, function(err, webserver) {
  controller.createWebhookEndpoints(controller.webserver);
  controller.createHomepageEndpoint(controller.webserver);
  controller.createOauthEndpoints(controller.webserver,
    function(err, req, res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('You have successfully connected Gemification to your team!');
    }
  });
});

let _bots = {};
/**
 * just a simple way to make sure we don't connect to the RTM twice for the same
 * team messages back a parsed list of admins.
 * @param {string} bot The bot.
 */
function trackBot(bot) {
  _bots[bot.config.token] = bot;
}

// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function(bot) {
  console.log('** The RTM api just connected!');
});

controller.storage.teams.all(function(err, teams) {
  if (err) {
    throw new Error(err);
  }
  // connect all teams with bots up to slack!
  for (let t in teams) {
    if (teams[t].bot) {
      controller.spawn(teams[t]).startRTM(function(err, bot) {
        if (err) {
          console.log('Error connecting bot to Slack:', err);
        } else {
          trackBot(bot);
        }
      });
    }
  }
});

/* ~~~~~~~~~~~~~~~~~~~~Begin helper functions~~~~~~~~~~~~~~~~~~~~ */

/**
 * Gets all of the members in a Slack channel
 * @param {JSON} bot The bot.
 * @param {JSON} message The message.
 * @param {function} callback The function that is executed after the Slack API
 *                             is called.
 */
function getMembersInChannel(bot, message, callback) {
  bot.api.channels.info({channel: message.channel}, function(err, response) {
    callback(response.channel.members);
  });
}

/**
 * Check if the object you are passing in is empty
 * @param {Object} obj Any object.
 * @return {boolean} Whether the object is empty or not.
 */
function isEmptyObject(obj) {
  return !Object.keys(obj).length;
}

/**
 * Gets all users in the Slack channel and runs the callback function
 * @param {JSON} bot The bot.
 * @param {function} callback The function that is executed after the Slack API
 *                             is called.
 */
function getAllSlackUsers(bot, callback) {
  const ONE_MINUTE = 60 * 1000; // milliseconds
  let currentTime = new Date();
  let teamId = bot.identifyTeam();
  let setRedis = function() {
    // call the Slack API
    bot.api.users.list({}, function(err, response) {
      if(err) throw err;
      let membersObj = {members: response.members, time: new Date()};
      redisClient.set(teamId, JSON.stringify(membersObj));
      callback(membersObj.members);
    });
  };
  redisClient.get(teamId, function(err, reply) {
    if (err) throw err;
    // cache is not set
    reply = JSON.parse(reply);
    let replyTime;
    if(reply) {
      // if there is a stored value, set the time to a new date object
      replyTime = new Date(reply.time);
    }
    if(reply==null) {
      console.log('* REDIS: Called Slack API and setting in cache.');
      setRedis();
    }else if((currentTime - replyTime) > ONE_MINUTE) {
      console.log('* REDIS: Old users list. Called Slack API and setting a new one in the cache.');
      setRedis();
    }else {
      console.log('* REDIS: Grabbing Slack users from cache.');
      callback(reply.members);
    }
  });
}

/**
 * Returns a specific Slack user object from the users.list API
 * @param {JSON} bot The bot.
 * @param {string} userId The Slack user ID that we want the user object for
 * @param {function} callback The function that is executed after the Slack API
 *                             is called.
 */
function getSlackUser(bot, userId, callback) {
  getAllSlackUsers(bot, function(users) {
    let user = users.filter(function(user) {
      return user.id == userId;
    })[0];
    callback(user);
  });
}

/**
 * Converts a Slack userId to a Slack username.
 * Function takes in a JSON object of all Slack users and the Slack userId
 * @param {JSON} slackUsers A JSON object with all of the users in the channel.
 * @param {function} id The ID of the user you wish to get the username for.
 * @return {string} The username the corresponds with the ID.
 */
function convertIdToName(slackUsers, id) {
  return slackUsers.filter(function(user) {
    return user.id == id;
  })[0].name;
}

/**
 * This function checks if the message that was typed by the user is an admin or
 * not. The callback function in this method accepts a boolean value telling if
 * the user is an admin or not. The callback function must accept a parameter, a
 * boolean value, to see if the user is currently an admin or not.
 * @param {JSON} bot The bot.
 * @param {JSON} message The message.
 * @param {function} callback The function that is executed after the Slack API
 *                             is called.
 */
function checkIsAdminByMessage(bot, message, callback) {
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    connection.query(
      'SELECT isAdmin FROM userGem WHERE userId=' +
          connection.escape(message.user) + ';',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(typeof rows[0] !== 'undefined') {
        if(rows[0].isAdmin==1) {
          // user is an admin
          callback(true);
        } else {
          // user isn't an admin
          callback(false);
        }
      } else{
        // user isn't in the table, and therefore isn't an admin
        callback(false);
      }
    });
  });
}

/**
 * Function takes an id and a callback function and performs a query to the DB
 * to see if the user exists. A boolean value is sent as a parameter to the
 * callback to say whether or not the user exists.
 * @param {string} id The ID of the Slack user
 * @param {function} callback The function that will be executed after the query
 */
function checkIfUserExists(id, callback) {
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    connection.query(
      'SELECT id FROM userGem WHERE userId=' + connection.escape(id) + ';',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(typeof rows[0] !== 'undefined') {
        // user exists
        callback(true);
      }else {
        // user doesn't exist
        callback(false);
      }
    });
  });
}

/**
 * This function checks if the id entered is an admin or not.
 * The callback function in this method accepts a boolean value telling if the
 * user is an admin or not. The callback function must accept a parameter, a
 * boolean value, to see if the user is currently an admin or not.
 * @param {string} id The ID of the Slack user
 * @param {function} callback The function that will be executed after the query
 */
function checkIsAdminById(id, callback) {
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    connection.query(
      'SELECT isAdmin FROM userGem WHERE userId=' + connection.escape(id) + ';',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(typeof rows[0] !== 'undefined') {
        if(rows[0].isAdmin==1) {
          // user is an admin
          callback(true);
        }else {
          // user isn't an admin
          callback(false);
        }
      } else{
        // user isn't in the database, and therefore isn't an admin
        callback(false);
      }
    });
  });
}

/**
 * This little function takes a list of all Slack users in the channel and a
 * user id and tells you if user id entered is a valid user in the Slack channel
 * or not. A boolean value is returned.
 * @param {JSON} allSlackUsers A JSON object of all the slack users
 * @param {function} id The ID of the user you are trying to find.
 * @return {boolean} A boolean value telling you if the letiable is found.
 */
function findUserById(allSlackUsers, id) {
  let isFound = false;
  for(let i=0; i<allSlackUsers.length; i++) {
    if(allSlackUsers[i].id == id) {
      isFound = true;
      break;
    }
  }
  return isFound;
}

/**
 * This function first checks if the user is an admin, if they are it performs a
 * query grabbing all userIds who are currently admins to gemification, then
 * messages back a parsed list of admins.
 * @param {JSON} bot The bot.
 * @param {JSON} message The message.
 */
function listAdmins(bot, message) {
  checkIsAdminByMessage(bot, message, function(isAdmin) {
    if(isAdmin) {
      // The user who typed the message is an admin
      let teamId = bot.identifyTeam();
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        connection.query(
          'SELECT userId FROM userGem WHERE isAdmin=\'1\' AND teamId=(SELECT' +
          ' id FROM teams WHERE slackTeamId=' + connection.escape(teamId) +
          ');',
          function(err, rows) {
          connection.release();
          if (err) throw err;
          let adminsStr = 'List of current admins:\n';
          for(let i=0; i<rows.length; i++) {
            if(i==rows.length-1) {
              adminsStr += '<@' + rows[i].userId + '>';
            } else{
              adminsStr += '<@' + rows[i].userId + '>\n';
            }
          }
          bot.reply(message, adminsStr);
        });
      });
    } else{
      // User who typed the message isn't an admin
      bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only ' +
      'admins can view current admins. :angry:');
    }
  });
}

/**
 * This function first checks if the user is an admin, if they are it performs a
 * query grabbing all userIds who are currently admins to gemification, then
 * messages back a parsed list of admins.
 * @param {string} removeAdminId The ID of the admin you are trying to remove.
 * @param {function} callback The callback function.
 */
function checkIsLastAdmin(bot, removeAdminId, callback) {
  let teamId = bot.identifyTeam();
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    connection.query(
      'SELECT COUNT(userId) AS admin_count FROM userGem WHERE isAdmin=\'1\'' +
      ' AND teamId=(SELECT id FROM teams WHERE slackTeamId=' +
      connection.escape(teamId) + ');',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(rows[0].admin_count > 1) {
        // User isn't the last admin
        callback(false);
      } else{
        // User is the last admin
        callback(true);
      }
    });
  });
}

/**
 * This function takes in a bot, a userId and a callback function. It performs a
 * SQL query and passes the a boolean value back thru the callback.
 * @param {JSON} bot The bot.
 * @param {string} userId A string of a userId from the Slack API
 * @param {function} callback The function that will be executed after the query
 */
function isUserConfigured(bot, userId, callback) {
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    connection.query(
      'SELECT COUNT(groupId) as isConfigured FROM userGem WHERE userId=' +
        connection.escape(userId) + ';',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(typeof rows[0] !== 'undefined') {
        if(rows[0].isConfigured==1) {
          // user is configured
          callback(true);
        } else {
          // user is not configured
          callback(false);
        }
      } else{
        // user isn't in the table, and therefore isn't configured
        callback(false);
      }
    });
  });
}

/**
 * Performs a SQL query to find out if the team is configured and passes that
 * boolean value thru to the callback function.
 * @param {JSON} bot The bot.
 * @param {function} callback The function that is executed after the Slack API
 *                             is called.
 */
function isTeamConfigured(bot, callback) {
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    let teamId = bot.identifyTeam();
    connection.query(
      'SELECT isConfigured as isConfigured FROM teams WHERE slackTeamId=' +
        connection.escape(teamId) + ';',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(typeof rows[0] !== 'undefined') {
        if(rows[0].isConfigured==1) {
          // team is configured
          callback(true);
        } else {
          // team is not configured
          callback(false);
        }
      } else{
        // team isn't in the table, and therefore isn't configured
        callback(false);
      }
    });
  });
}

/**
 * Prints a error message for an unconfigured user who is trying to operate
 * Gemification.
 * @param {JSON} bot The bot.
 * @param {JSON} message The message.
 */
function userConfiguredError(bot, message) {
  bot.startPrivateConversation({user: message.user},
    function(err, convo) {
    if (err) {
      console.log(err);
    } else {
      convo.say('You are not configured in Gemification. Please talk to a ' +
                  'Gemification admin and have them configure you.');
    }
  });
}

/**
 * Prints a error message for an unconfigured user who is trying to operate
 * Gemification.
 * @param {string} string string which will have the first letter capitalized
 * @return {string} The string which has the first letter capitalized.
 */
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Takes the user who installed Gemification thru the steps to configure the
 * team.
 * @param {JSON} bot The bot.
 * @param {string} createdBy User who installed Gemification.
 */
function configureGemificationTeam(bot, createdBy) {
  isTeamConfigured(bot, function(isConfigured) {
    if(isConfigured) {
      // Team is already configured
      bot.startPrivateConversation({user: createdBy},
        function(err, convo) {
        if (err) {
          console.log('Error in configureGemificationTeam: ' + err);
        } else {
          convo.say('This team is already configured with Gemification.');
          console.log('info: User tried to reconfigure Gemification using initializing function.');
        }
      });
    }else {
      let groups = [];

      let getGroups = function(err, convo) {
        if (err) {
          console.log('Error in getGroups: ' + err);
        } else {
          convo.say('Let\'s begin by configuring your Slack team into groups.');
          convo.say('A group is a subset of your Slack team. For example, a' +
                    ' programming Slack team could be divided into front-end ' +
                    'and back-end groups.');
          convo.say('Each group will have their own Gemification leaderboard.');
          convo.ask('One at a time, please enter a name for a new group. A group can be up ' +
                    'to 20 characters long. You may have up to 4 groups. Type' +
                    ' `done` to finish and finalize the groups or `start ' +
                    'over` to start over.', [
            {
              pattern: 'done',
              callback: function(response, convo) {
                if(groups.length < 1) {
                  // No groups were entered
                  convo.say('Please enter at least one group for your ' +
                            'Slack team.');
                  convo.repeat();
                  console.log('info: User typed done before setting any groups.');
                  convo.next();
                }else {
                  confirmGroups(response, convo);
                  convo.next();
                }
              },
            },
            {
              pattern: 'start over',
              callback: function(response, convo) {
                console.log('info: User is starting over.');
                configureGemificationTeam(bot, createdBy);
                convo.next();
              },
            },
            {
              default: true,
              callback: function(response, convo) {
                let group = capitalizeFirstLetter(response.text);
                if(groups.indexOf(group) > -1) {
                  // group was already added
                  console.log('info: User typed a group that was already added.');
                  convo.say(group + ' was already added as a group.');
                }else if(groups.length == 4) {
                  console.log('info: User reach the number of groups allowed limit.');
                  convo.say('You may only have 4 groups set for Gemification.' +
                            ' Type `done` to move to the next step.');
                }else {
                  if(group.length > 20) {
                    console.log('info: User typed a group that was more than 20 characters.');
                    convo.say('A group must be 20 characters or less.');
                  } else{
                    // it is a new group and is added to the groups array
                    groups.push(group);
                    console.log('info: User added ' + group + ' as a group.');
                    convo.say(group + ' was added as a group');
                  }
                }
                convo.repeat();
                convo.next();
              },
            },
          ]);
        }
      };

      let confirmGroups = function(response, convo) {
        let groupsStr = groups.join(', ');
        let answerYes = ['yes', groups, createdBy];
        let answerYesJSON = JSON.stringify(answerYes);
        let answerNo = ['no', groups, createdBy];
        let answerNoJSON = JSON.stringify(answerNo);
        convo.say({
          text: 'Here are the groups you have added: ' + groupsStr,
          attachments: [
            {
              title: 'Do you wish to set these groups for your team?',
              // Set groups for team
              callback_id: '4',
              attachment_type: 'default',
              actions: [
                {
                  'name': 'yes',
                  'text': 'Yes',
                  'value': answerYesJSON,
                  'type': 'button',
                  'confirm': {
                    'title': 'Are you sure?',
                    'text': 'This will set these groups (' + groupsStr +
                              ') for your team!',
                    'ok_text': 'Yes',
                    'dismiss_text': 'No',
                  },
                },
                {
                  'name': 'no',
                  'text': 'No',
                  'value': answerNoJSON,
                  'type': 'button',
                },
              ],
            },
          ],
        });
      };

      // Configure the team
      bot.startPrivateConversation({user: createdBy}, getGroups);
    }
  });
}

/**
 * Performs a SQL query to get Gemification groups and runs the callback
 * function.
 * @param {JSON} bot The bot.
 * @param {function} callback The callback function which has the groups
 *                            passed into it.
 */
function getTeamGroups(bot, callback) {
  let teamId = bot.identifyTeam();
  DBPool.getConnection(function(err, connection) {
    if (err) throw err;
    connection.query(
      'SELECT groupName FROM teamConfiguration WHERE teamId=(SELECT id FROM teams WHERE slackTeamId=' +
          connection.escape(teamId) + ');',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      if(typeof rows[0] !== 'undefined') {
        callback(rows);
      }else {
        console.log('There aren\'t any groups set.');
      }
    });
  });
}

/**
 * Takes the user who installed Gemification thru the steps to configure all
 * the users on their team.
 * @param {JSON} bot The bot.
 * @param {string} createdBy A string of who installed Gemification.
 */
function configureGemificationUsers(bot, createdBy) {
  getAllSlackUsers(bot, function(users) {
    getTeamGroups(bot, function(groups) {
      configurePerson(bot, createdBy, users, groups, 0);
    });
  });
}

/**
 * Returns a boolean value to see if the userId is a bot or not.
 * @param {JSON} bot The bot.
 * @param {string} userId The userId we want to know is a bot or not.
 * @return {boolean} A boolean value to tell if the user is a bot or not.
 */
function isBot(bot, userId, callback) {
  getSlackUser(bot, userId, function(user) {
    callback(user.is_bot);
  });
}

/**
 * Takes the user who installed Gemification thru the steps to configure a
 * specific user in their team.
 * @param {JSON} bot The bot.
 * @param {string} createdBy A string of who installed Gemification.
 * @param {JSON} users An JSON object containing all the users in the Slack team
 * @param {array} groups An array of Gemeifcation groups for the team
 * @param {int} userSelector A counter telling recurssion where to look for
 *                            which user is currently being configured.
 */
function configurePerson(bot, createdBy, users, groups, userSelector) {
  bot.startPrivateConversation({user: createdBy}, function(err, convo) {
    if (err) {
      console.log('Error in configurePerson: ' + err);
    } else {
      let isBot = users[userSelector].is_bot;
      if(isBot) {
        // user is a bot and should be skipped
        console.log('info: User ' + users[userSelector].name +
                    ' is a bot and is being skipped.');
        // Ending the conversation for the bot
        convo.stop();
        if(userSelector != users.length-1) {
          // if user isn't the last user in the list
          configurePerson(bot, createdBy, users, groups, userSelector + 1);
        }else {
          // if user is the last user in the list
          finishTeamConfiguration(bot, message);
        }
      }else {
        // user is not a bot and shouldn't be skipped
        let userId = users[userSelector].id;
        let userName;
        if(users[userSelector].real_name) {
          userName = users[userSelector].real_name;
        }else {
          userName = users[userSelector].name;
        }
        let buttons = [];
        // assigning the groups to buttons
        for(let i=0; i<groups.length; i++) {
          let answer = [groups[i].groupName,
                        userId,
                        createdBy,
                        userSelector,
                        groups];
          let answerJSON = JSON.stringify(answer);
          let button = {
            'name': groups[i].groupName,
            'text': groups[i].groupName,
            'value': answerJSON,
            'type': 'button',
          };
          buttons.push(button);
        }
        // adding the ignore button
        let ignoreAnswer = ['ignore', userId, createdBy, userSelector, groups];
        let ignoreAnswerJSON = JSON.stringify(ignoreAnswer);
        buttons.push({
          'name': 'ignore',
          'text': 'Ignore',
          'value': ignoreAnswerJSON,
          'type': 'button',
        });
        convo.ask({
          text: 'Let\'s assign ' + userName + ' to a group.',
          attachments: [
            {
              title: 'Which group would you like to set ' + userName + ' to?',
              // Assign users to group
              callback_id: '5',
              attachment_type: 'default',
              actions: buttons,
            },
          ],
        });
      }
    }
  });
}

/**
 * Prints a generic success statement to the user who finished configuring
 * Gemification.
 * @param {JSON} bot The bot.
 * @param {JSON} message The message for the bot to repond to.
 */
function finishTeamConfiguration(bot, message) {
  let teamId = bot.identifyTeam();
  DBPool.getConnection(function(err, connection) {
    if(err) throw err;
    connection.query(
      'UPDATE teams SET isConfigured = TRUE WHERE slackTeamId = ' +
        connection.escape(teamId) + ';',
      function(err, rows) {
      connection.release();
      if (err) throw err;
      // Convo end point
      console.log('info: Configuration for team ' + teamId + ' is finished.');
      bot.reply(message, 'The last step is to /invite me to the channel' +
                          ' you\'ll be using for Gemification. Without that,' +
                          ' I won\'t be able to do anything.');
      bot.reply(message, 'For a full list of commands and explaination on how' +
                          ' to use Gemification, type `help` in a direct' +
                          ' message to Gemification.');
    });
  });
}
/* ~~~~~~~~~~~~~~~~~~~~End helper functions~~~~~~~~~~~~~~~~~~~~ */

controller.on('create_bot', function(bot, config) {
  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {
      if (!err) {
        trackBot(bot);
      }

      bot.startPrivateConversation({user: config.createdBy},
        function(err, convo) {
        if (err) {
          console.log('Error in create_bot: ' + err);
        } else {
          convo.sayFirst('Welcome to Gemification! :gem:');

          // Adding the user which installed gemification as an admin
          getAllSlackUsers(bot, function(allSlackUsers) {
            let teamId = bot.identifyTeam(); // Gets the team ID
            // Getting the database pool
            DBPool.getConnection(function(err, connection) {
              if (err) throw err;
              connection.query(
                'CALL teamInit(' + connection.escape(config.createdBy) + ', ' +
                  connection.escape(teamId) + ');',
                function(err, rows) {
                if (err) {
                  console.log('Error in team init query: ' + err);
                }else {
                  // Done with connection
                  connection.release();
                  // Don't use connection here, it has been returned to the pool
                  console.log('Done with team init.');
                  configureGemificationTeam(bot, config.createdBy);
                }
              });
            });
          });
        }
      });
    });
  }
});

// Handlers for interactive messages
controller.on('interactive_message_callback', function(bot, message) {
  let array;
  if(message.callback_id=='1' ||
      message.callback_id=='2' ||
      message.callback_id=='3' ||
      message.callback_id=='4' ||
      message.callback_id=='5' ||
      message.callback_id=='6' ||
      message.callback_id=='7') {
    try {
      array = JSON.parse(message.actions[0].value);
    } catch (ex) {
      console.error(ex);
    }
  }

  // Update the user as an admin
  if(message.callback_id=='1') {
    console.log('* CALLBACK: Begin Callback ID 1');
    // Array for this function will be array[answer, newAdminId, newAdmin]
    let answer = array[0];
    let newAdminId = array[1];
    let newAdmin = array[2];

    // unsanitizing the strings
    newAdmin = newAdmin.replace('&lt;', '<').replace('&gt;', '>');

    if(answer=='yes') {
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        connection.query(
          'UPDATE userGem SET isAdmin=\'1\' WHERE userId=' +
            connection.escape(newAdminId) + ';',
          function(err, rows) {
          connection.release();
          if (err) throw err;
          // Convo end point
          console.log('info: Setting ' + newAdmin + ' as an admin.');
          bot.replyInteractive(message, newAdmin + ' is now set as an admin.');
          // Notifying the new admin they have been set as an admin
          bot.startPrivateConversation({user: newAdminId},
            function(err, newAdminNotification) {
            if (err) {
              console.log(err);
            } else {
              newAdminNotification.say('Hey there, good looking. :wink:' +
                ' You have been set as an admin.');
            }
          });
        });
      });
    }
    if(answer=='no') {
      bot.replyInteractive(message, newAdmin + ' will not be set as an admin.');
    }
  }

  // New user will be inserted as an admin into the table
  // if(message.callback_id=='2') {
  //   // Array for this function will be array[answer, newAdminId, newAdmin]
  //   let answer = array[0];
  //   let newAdminId = array[1];
  //   let newAdmin = array[2];
  //
  //   // unsanitizing the strings
  //   newAdmin = newAdmin.replace('&lt;', '<').replace('&gt;', '>');
  //
  //   if(answer=='yes') {
  //     DBPool.getConnection(function(err, connection) {
  //       let teamId = bot.identifyTeam(); // Gets the team ID
  //       if (err) throw err;
  //       connection.query(
  //         'INSERT INTO userGem (userId, teamId, isAdmin) VALUES (' +
  //           connection.escape(newAdminId) + ', ' +
  //           connection.escape(teamId) + ', TRUE)',
  //         function(err, rows) {
  //         connection.release();
  //         if (err) throw err;
  //         // Convo end point
  //         console.log('info: Setting ' + newAdmin + ' as an admin.');
  //         bot.replyInteractive(message, newAdmin + ' is now set as an admin.');
  //       });
  //     });
  //   }
  //   if(answer=='no') {
  //     bot.replyInteractive(message, newAdmin + ' will not be set as an admin.');
  //   }
  // }

  // User will be removed as an admin from the database
  if(message.callback_id=='3') {
    console.log('* CALLBACK: Begin Callback ID 3');
    // Array for this function is array[answer, removeAdminId, removeAdmin]
    let answer = array[0];
    let removeAdminId = array[1];
    let removeAdmin = array[2];

    // unsanitizing the strings
    removeAdmin = removeAdmin.replace('&lt;', '<').replace('&gt;', '>');

    if(answer=='yes') {
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        connection.query(
          'UPDATE userGem SET isAdmin=\'0\' WHERE userId=' +
            connection.escape(removeAdminId) + ';',
          function(err, rows) {
          connection.release();
          if (err) throw err;
          // Convo end point
          console.log('info: Removing ' + removeAdmin + ' from being an admin.');
          bot.replyInteractive(message, removeAdmin + ' is now removed ' +
            'from being an admin.');
          // Sending the user a notification they have been removed as an admin
          bot.startPrivateConversation({user: removeAdminId},
            function(err, removeAdminNotification) {
            if (err) {
              console.log(err);
            } else {
              removeAdminNotification.say('You have been removed as an admin.');
            }
          });
        });
      });
    }
    if(answer=='no') {
      bot.replyInteractive(message, removeAdmin + ' will not be removed from ' +
        'being an admin.');
    }
  }

  // Set groups for team
  if(message.callback_id=='4') {
    console.log('* CALLBACK: Begin Callback ID 4');
    // Array for this function is array[answer, groups[], createdBy]
    let answer = array[0];
    let groups = array[1];
    let createdBy = array[2];
    let groupsStr = groups.join(', ');

    if(answer=='yes') {
      let teamId = bot.identifyTeam();
      // Set the groups in the database
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        let query = 'INSERT INTO teamConfiguration(groupName, teamId) VALUES ';
        for(let i=0; i<groups.length; i++) {
          if(i==groups.length-1) {
            query += '(' + connection.escape(groups[i]) +
                      ', (SELECT id FROM teams WHERE slackTeamId = ' +
                        connection.escape(teamId) + '));';
          }else {
            // the last one
            query += '(' + connection.escape(groups[i]) +
                      ', (SELECT id FROM teams WHERE slackTeamId = ' +
                        connection.escape(teamId) + ')),';
          }
        }

        connection.query(
          query,
          function(err, rows) {
          if (err) throw err;
          connection.release();
          // Setting the team as configured in it's table
          console.log('info: The groups ' + groupsStr + ' are being set for team ' + teamId + '.');
          bot.replyInteractive(message, 'Nice work! The groups ' + groupsStr + ' are set to your team! :tada:');
          bot.reply(message, 'Now that you have set up groups, let\'s assign the people to these groups.');
          configureGemificationUsers(bot, createdBy);
        });
      });
    }
    if(answer=='no') {
      bot.replyInteractive(message, 'These groups will not be set for your team.');
      bot.reply(message, 'Ok, let\'s start over.');
      // Restarting the conversation
      configureGemificationTeam(bot, createdBy);
    }
  }

  // Adding a new user to the database and setting a group for the user for init
  if(message.callback_id=='5') {
    console.log('* CALLBACK: Begin Callback ID 5');
    getAllSlackUsers(bot, function(users) {
      // Array for this function is array[answer, userId, createdBy, userSelector, groups]
      let answer = array[0];
      let userId = array[1];
      let createdBy = array[2];
      let userSelector = array[3];
      let groups = array[4];
      let teamId = bot.identifyTeam();
      let userEncoded = '<@' + userId + '>';

      console.log('* CALLBACK VARIABLES' + '\n' +
                  'answer: ' + answer + '\n' +
                  'userId: ' + userId + '\n' +
                  'createdBy: ' + createdBy + '\n' +
                  'userSelector: ' + userSelector + '\n' +
                  'number of users: ' + users.length + '\n' +
                  'groups: ' + JSON.stringify(groups) + '\n' +
                  'teamId: ' + teamId + '\n' +
                  'userEncoded: ' + userEncoded
              );

      if(answer == 'ignore') {
        // add the user to the database without assigning the user to a group
        DBPool.getConnection(function(err, connection) {
          if (err) throw err;
          let query = 'INSERT INTO userGem(userId, teamId) VALUES (' +
                        connection.escape(userId) + ', ' +
                        '(SELECT id FROM teams WHERE slackTeamId = ' + connection.escape(teamId) + ')' +
                        ')';
          connection.query(
            query,
            function(err, rows) {
            if (err) throw err;
            connection.release();
            console.log('info: Did not set user ' + userId + ' on team ' + teamId + ' to a group.');
            bot.replyInteractive(message, 'Ok, you chose to not set ' + userEncoded + ' to a group.');

            // if we currently aren't on the last user, recurse
            if(userSelector != users.length-1) {
              configurePerson(bot, createdBy, users, groups, userSelector + 1);
            }else {
              finishTeamConfiguration(bot, message);
            }
          });
        });
      }else {
        DBPool.getConnection(function(err, connection) {
          if (err) throw err;
          let query;
          if(userId==createdBy) {
            // user is assigning group to self
            query = 'UPDATE userGem SET groupId=(SELECT id FROM teamConfiguration WHERE groupName = ' +
                      connection.escape(answer) + ') WHERE userId=' + connection.escape(userId);
          }else {
            // add the user to the database and assign the user to a group
            query = 'INSERT INTO userGem(userId, teamId, groupId) VALUES (' +
                          connection.escape(userId) + ', ' +
                          '(SELECT id FROM teams WHERE slackTeamId = ' + connection.escape(teamId) + ')' + ', ' +
                          '(SELECT id FROM teamConfiguration WHERE groupName = ' +
                              connection.escape(answer) + ')' +
                          ')';
          }
          connection.query(
            query,
            function(err, rows) {
            if (err) throw err;
            connection.release();
            console.log('info: User ' + userId + ' on team ' + teamId + ' is set to the ' + answer + ' group.');
            bot.replyInteractive(message, 'Perfect! ' + userEncoded + ' is now set to the ' + answer + ' group.');

            // if we currently aren't on the last user, recurse
            if(userSelector != users.length-1) {
              configurePerson(bot, createdBy, users, groups, userSelector + 1);
            }else {
              finishTeamConfiguration(bot, message);
            }
          });
        });
      }
    });
  }

  // Changing the group for a user
  if(message.callback_id=='6') {
    // Array for this function is array[answer, reconfigureUserId]
    let answer = array[0];
    let reconfigureUserId = array[1];
    let reconfigureUserEncoded = '<@' + reconfigureUserId + '>';
    let teamId = bot.identifyTeam();

    console.log('* CALLBACK: Begin Callback ID 6');
    console.log('* CALLBACK VARIABLES' + '\n' +
                'answer: ' + answer + '\n' +
                'reconfigureUserId: ' + reconfigureUserId + '\n' +
                'reconfigureUserEncoded: ' + reconfigureUserEncoded + '\n' +
                'teamId: ' + teamId
            );
    if(answer == 'remove') {
      // user will be removed from Gemification groups
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        let query;
        // user is assigning group to self
        query = 'UPDATE userGem SET groupId=null WHERE userId=' + connection.escape(reconfigureUserId) + ' AND teamId=(SELECT id FROM teams WHERE slackTeamId=' + connection.escape(teamId) + ')';
        connection.query(
          query,
          function(err, rows) {
          if (err) throw err;
          connection.release();
          console.log('info: User ' + reconfigureUserId + ' on team ' + teamId + ' is set to the ' + answer + ' group.');
          // alerts the user who has been moved to a new group
          bot.startPrivateConversation({user: reconfigureUserId},
            function(err, convo) {
            if (err) {
              console.log(err);
            } else {
              convo.say('This is a notice that you have been removed from' +
                        ' Gemification groups. :grin:');
            }
          });
          bot.replyInteractive(message, 'Perfect! ' + reconfigureUserEncoded + ' is now removed from all Gemification groups.');
        });
      });
    }else {
      // user will be assigned to a new Gemification group
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        let query;
        // user is assigning group to self
        query = 'UPDATE userGem SET groupId=(SELECT id FROM teamConfiguration WHERE groupName = ' +
                  connection.escape(answer) + ') WHERE userId=' + connection.escape(reconfigureUserId) +
                  ' AND teamId=(SELECT id FROM teams WHERE slackTeamId=' + connection.escape(teamId) + ')';
        connection.query(
          query,
          function(err, rows) {
          if (err) throw err;
          connection.release();
          console.log('info: User ' + reconfigureUserId + ' on team ' + teamId + ' is set to the ' + answer + ' group.');
          // alerts the user who has been moved to a new group
          bot.startPrivateConversation({user: reconfigureUserId},
            function(err, convo) {
            if (err) {
              console.log(err);
            } else {
              convo.say('This is a notice that you have been moved to the ' +
                          answer + ' Gemification group. :grin:');
            }
          });
          bot.replyInteractive(message, 'Perfect! ' + reconfigureUserEncoded + ' is now set to the ' + answer + ' group.');
        });
      });
    }
  }

  // Adding a new user to the database and setting the group after init
  if(message.callback_id=='7') {
    // Array for this function is array[answer, newUserId]
    let answer = array[0];
    let newUserId = array[1];
    let newUserEncoded = '<@' + newUserId + '>';
    let teamId = bot.identifyTeam();

    console.log('* CALLBACK: Begin Callback ID 7');
    console.log('* CALLBACK VARIABLES' + '\n' +
                'answer: ' + answer + '\n' +
                'newUserId: ' + newUserId + '\n' +
                'newUserEncoded: ' + newUserEncoded + '\n' +
                'teamId: ' + teamId
            );
    if(answer == 'remove') {
      // user will not be set to a Gemification group
      console.log('* CALLBACK 7: user ' + newUserEncoded + ' will not be set to any Gemification groups.');
      bot.replyInteractive(message, 'Ok, ' + newUserEncoded + ' will not be configured to a Gemification group.');
    }else {
      // user will be added to a database and assign a group
      DBPool.getConnection(function(err, connection) {
        if (err) throw err;
        // user is assigning group to self
        let query = 'INSERT INTO userGem(userId, teamId, groupId) VALUES (' +
                      connection.escape(newUserId) + ', ' +
                      '(SELECT id FROM teams WHERE slackTeamId = ' + connection.escape(teamId) + '), ' +
                      '(SELECT id FROM teamConfiguration WHERE groupName = ' + connection.escape(answer) + ')' +
                      ')';
        connection.query(
          query,
          function(err, rows) {
          if (err) throw err;
          connection.release();
          console.log('* CALLBACK 7: User ' + newUserId + ' on team ' + teamId + ' is set to the ' + answer + ' group.');
          // alerts the user who has been moved to a new group
          bot.startPrivateConversation({user: newUserId},
            function(err, convo) {
            if (err) {
              console.log(err);
            } else {
              convo.say('This is a notice that you have been moved to the ' +
                          answer + ' Gemification group. :grin:');
            }
          });
          bot.replyInteractive(message, 'Perfect! ' + newUserEncoded + ' is now set to the ' + answer + ' group.');
        });
      });
    }
  }
});

// Message data contains the following content by this association
// type, channel, user, text, ts, team, event, match
controller.hears(':gem:', 'ambient', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      // getting all of the usernames in the channel, then executing the callback
      // function after the task gets all the usernames
      getMembersInChannel(bot, message, function(membersInChannel) {
        getAllSlackUsers(bot, function(allSlackUsers) {
          // Logging
          console.log('***************BEGIN GEM TRANSACTION***************');
          // Everything the user typed in the message
          let messageText = message.text;
          // Raw userId of the gem giver (ex. UW392NNSK)
          let gemGiverId = message.user;
          // Person who gave the :gem:
          let gemGiverEncoded = '<@' + gemGiverId + '>';
          // Trimmed raw username who is getting the gem (ex. UW392NNSK)
          let gemReceiverIdTemp = String(messageText.match(/@[^\s]+/));
          let gemReceiverId = gemReceiverIdTemp.substring(1,
            gemReceiverIdTemp.length-1);
          // Encoded username who is getting the gem (ex. <@UW392NNSK>, but will
          // display as @john.doe
          // in the Slack app)
          let gemReceiver = '<@' + gemReceiverId + '>';
          // Instantiating the reason letiable
          let reason = '';
          // Checking if the user type a reason after the keyword 'for ', if not, do
          // nothing
          if(messageText.includes('for ')) {
            reason = messageText.substr(messageText.indexOf('for ') + 4);
          }
          if(messageText.includes('For ')) {
            reason = messageText.substr(messageText.indexOf('For ') + 4);
          }
          if(messageText.includes('FOR ')) {
            reason = messageText.substr(messageText.indexOf('FOR ') + 4);
          }
          // Getting the team ID
          let teamId = bot.identifyTeam();

          // Logging
          console.log('***************VARIABLES***************' + '\n' +
                      'Message Text: ' + JSON.stringify(messageText) + '\n' +
                      'Gem Giver ID: ' + gemGiverId + '\n' +
                      'Gem Giver Encoded: ' + gemGiverEncoded + '\n' +
                      'Gem Receiver ID: ' + gemReceiverId + '\n' +
                      'Gem Receiver Encoded: ' + gemReceiver + '\n' +
                      'Reason: ' + reason + '\n' +
                      'Team ID: ' + teamId
                  );


          // Checks to see if gem receiver is configured
          isUserConfigured(bot, gemReceiverId, function(isGemReceiverConfigured) {
            // This if-statement checks for a letiety of conditions
            // Checks to see if the reason is an empty string -- it requires
            // a reason for storage to the database.
            let isReasonEmpty = (reason == '');
            // Checks to see if the member the user entered to give the gem
            // TO is a valid username in the channel.
            let isGemReceiverInvalid =
              !(membersInChannel.indexOf(gemReceiverId) > -1);
            // Checks if the :gem: is typed after the word 'for' meaning the
            // user typed their statement in the wrong order.
            let isGemInReason = (reason.indexOf(':gem:') > -1);
            // Checks if the user typed in the message is after 'for'
            // meaning the user typed their statement in the wrong order.
            let isGemReceiverInReason = (reason.indexOf(gemReceiverId) > -1);
            // Checks to see if a user trying to give a gem to themselves.
            let isSelfGivingGem = (gemGiverId == gemReceiverId);

            // If none of these condition are met, the user typed a valid gem statment
            // and program execution can proceed. Valid gem statements are as
            // following...
            // :gem: [@username] for [reason] -- suggested statement syntax
            // [@username] :gem: for [reason]

            // Logging
            console.log('***************VALIDATIONS***************' + '\n' +
                        'Is reason undefined: ' + isReasonEmpty + '\n' +
                        'Is gem receiver invalid: ' + isGemReceiverInvalid +
                          '\n' +
                        'Is gem in reason statement: ' + isGemInReason + '\n' +
                        'Is gem receiver in reason statement: ' +
                          isGemReceiverInReason + '\n' +
                        'Is user giving themselves a gem: ' + isSelfGivingGem + '\n' +
                        'Is gem receiver configured: ' + isGemReceiverConfigured
                    );


            if (isReasonEmpty ||
                isGemReceiverInvalid ||
                isGemInReason ||
                isGemReceiverInReason ||
                !isGemReceiverConfigured) {
              // User typed an invalid statement, output error message
              let errorMessage = 'Sorry, ' + gemGiverEncoded + ', there was an ' +
                'error in your gem statement because:\n';
              if(isGemReceiverInvalid) {
                errorMessage += '- you didn\'t type a valid gem receiver\n';
              }
              if(isReasonEmpty) {
                errorMessage += '- you didn\'t include a reason statement\n';
              }
              if(isGemInReason) {
                errorMessage += '- you typed gems in your reason statement\n';
              }
              if(isGemReceiverInReason) {
                errorMessage += '- you don\'t type users in your reason ' +
                                  'statement\n';
              }
              if(!isGemReceiverConfigured) {
                errorMessage += '- the person you are trying to give a gem' +
                                ' to isn\'t configured with Gemification.' +
                                ' Talk to a Gemification admin to get them' +
                                ' configured with Gemification.\n';
              }
              errorMessage += 'Please type your gem statement using a valid ' +
                'username like this:\n' +
                ':gem: [@username] for [reason]';

              // The bot private messages the gem giver and explain their error
              bot.startPrivateConversation({user: gemGiverId},
                function(err, convo) {
                if (err) {
                  console.log(err);
                } else {
                  convo.say(errorMessage);
                }
              });
            } else if(isSelfGivingGem) {
              // Checks if the the someone is trying to give a gem to themselves
              // The bot private messages the gem giver and explain their error
              bot.startPrivateConversation({user: gemGiverId},
                function(err, convo) {
                if (err) {
                  console.log(err);
                } else {
                  convo.say('Nice try, jackwagon. You can\'t give a gem to ' +
                    'yourself. You may only give gems to other people in this ' +
                    'channel.');
                }
              });
            } else{
              // User typed a valid statement, we have valid data, proceed with
              // database calls

              // Getting the usernames for users involved in the gem statement
              // Username of the gem giver (ex. kerkhofj)
              let gemGiverUsername = convertIdToName(allSlackUsers, gemGiverId);
              // Username of the gem receiver (ex. emily.albulushi)
              let gemReceiverUsername = convertIdToName(allSlackUsers,
                                                          gemReceiverId);
              console.log('***************CONVERTED USERNAMES***************' +
                          '\n' + 'Gem Giver Username: ' + gemGiverUsername +
                          '\n' + 'Gem Receiver Username: ' + gemReceiverUsername
                        );

              // Truncating the reason statement to 250 characters to fit in the
              // database
              reason = reason.substring(0, 250);
              // Getting the database pool
              DBPool.getConnection(function(err, connection) {
                if (err) throw err;
                let giveGemQuery = 'CALL incrementGems(' +
                connection.escape(gemGiverId) + ', ' +
                connection.escape(gemReceiverId) + ', ' +
                connection.escape(teamId) + ', ' +
                connection.escape(reason) + ');';

                connection.query(
                  giveGemQuery,
                  function(err, rows) {
                  if (err) throw err;
                  // Done with connection
                  connection.release();
                  // Don't use connection here, it has been returned to the pool

                  // The bot private messages the gem giver and says their gem
                  // transaction was successful
                  bot.startPrivateConversation({user: gemGiverId},
                    function(err, convo) {
                    if (err) {
                      console.log(err);
                    } else {
                      convo.say(gemGiverUsername + ', you gave a gem to ' +
                        gemReceiverUsername + '!');
                    }
                  });

                  // The bot private messages the gem receiver and says their gem
                  // transaction was successful
                  bot.startPrivateConversation({user: gemReceiverId},
                    function(err, convo) {
                    if (err) {
                      console.log(err);
                    } else {
                      convo.say('You have received a gem from ' +
                        gemGiverUsername + '!');
                    }
                  });
                });
              });
            }
            // Logging
            console.log('***************END GEM TRANSACTION***************');
          });
        });
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// The gemification bot listens for a direct meantion followed by the
// leaderboard keyword. The bot then performs a query on the Gemification
// database and asks for the top 10 people that have a gem count greater than 0.
// The leaderboard is then paresed as a string in leaderboardStr like this...
//
// Leaderboard:
// 1.) emily.albulushi 5
// 2.) kerkhofj 4
// 3.) josh.schmidt 3
// 4.) kurt.kaufman 3
// 5.) likwam29 3
// 6.) sean.mitchell 2
// 7.) alex.flasch 1
// 8.) derrick.heinemann 1
// 9.) weinks15 1
// 10.) bateset39 1
controller.hears('leaderboard', ['direct_mention', 'direct_message'],
  function(bot, message) {
    isUserConfigured(bot, message.user, function(isConfigured) {
      if(isConfigured) {
        getTeamGroups(bot, function(groups) {
          for(let i=0; i<groups.length; i++) {
            let groupName = groups[i].groupName;
            // Getting the database pool
            DBPool.getConnection(function(err, connection) {
              if (err) throw err;
              let teamId = bot.identifyTeam(); // Gets the ID of the team
              let query = 'SELECT userId, currentGems FROM userGem WHERE ' +
                            'teamId=(SELECT id FROM teams WHERE slackTeamId=' + connection.escape(teamId) + ') ' +
                            'AND groupId=(SELECT id FROM teamConfiguration WHERE groupName=' + connection.escape(groupName) + ') ' +
                            'AND currentGems > 0 ORDER BY currentGems DESC';
              connection.query(
                query,
                function(err, rows) {
                if (err) throw err;
                // Done with connection
                connection.release();

                // Getting all the usernames
                getAllSlackUsers(bot, function(allSlackUsers) {
                  // Don't use connection here, it has been returned to the pool
                  if(isEmptyObject(rows)) {
                    bot.reply(message, 'The ' + groupName + ' leaderboard is empty. Try giving someone ' +
                      'a :gem:!');
                  } else{
                    // Parsing the leaderboard, looping thru everybody returned in the
                    // query
                    let leaderboardStr = groupName + ' Leaderboard:\n';
                    let numOfLoops = (rows.length > 10) ? 10 : rows.length;
                    for(let i=0; i<numOfLoops; i++) {
                      if(i == (numOfLoops-1)) {
                        leaderboardStr += '>' + (i+1) + '.) ' +
                          convertIdToName(allSlackUsers, rows[i].userId) + ' ' +
                          rows[i].currentGems;
                      } else{
                        leaderboardStr += '>' + (i+1) + '.) ' +
                          convertIdToName(allSlackUsers, rows[i].userId) + ' ' +
                          rows[i].currentGems + '\n';
                      }
                    }
                    bot.reply(message, leaderboardStr);
                  }
                });
              });
            });
          }
        });
      }else {
        userConfiguredError(bot, message);
      }
    });
});

// This function listens for a direct message from the admin to clear the
// leaderboard. First, it checks if the user is an admin and if not, spits out
// an error message. If the user is an admin, then it will submit a query to the
// database adding a row to the gemPeriod table and firing a trigger in the
// database to set all currentGems to 0 for all users.
controller.hears('clear gems', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      // Validates if the user typed is an admin
      // Getting the database pool
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          // getting the team id
          let teamId = bot.identifyTeam();
          DBPool.getConnection(function(err, connection) {
            if (err) throw err;
            connection.query(
              'CALL resetCurrentGems(' + connection.escape(teamId) + ');',
              function(err, rows) {
              if (err) throw err;
              // Done with connection
              connection.release();
              // Don't use connection here, it has been returned to the pool
              // The leaderboard was cleared successfully
              bot.reply(message, 'The leaderboard was cleared successfully. Now ' +
                'get out there and start earning yourself some gems! :gem:');
            });
          });
        } else{
          // The user wasn't an admin
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only' +
            'admins can reset the gem count. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// This function listens for the direct message command 'add admin' to add an
// admin to the database. If the user is in the database already, the user is
// bumped up to admin role. If the user isn't found in the database, the user
// is added as an admin. Only existing admins can add new admins.
controller.hears('add admin', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          // The user who typed the message is an admin
          bot.startConversation(message, function(err, convo) {
            convo.ask('Who would you like to add as an admin? Or type `cancel` ' +
              'to quit.', [
              {
                pattern: 'cancel',
                callback: function(response, convo) {
                  // Convo end point
                  convo.say('Cancel.. got it!');
                  convo.next();
                },
              },
              {
                default: true,
                callback: function(response, convo) {
                  // getAllSlackUsers asyncronously gets all all of the Slack users
                  // that are the Slack team.
                  getAllSlackUsers(bot, function(allSlackUsers) {
                    // Trimmed raw username who is getting the admin privileges
                    // (ex. UW392NNSK)
                    let newAdminTemp = String(response.text.match(/@[^\s]+/));
                    let newAdminId = newAdminTemp.substring(1,
                      newAdminTemp.length-1);
                    let newAdmin = '<@' + newAdminId + '>';
                    let isValidUsername = findUserById(allSlackUsers, newAdminId);
                    if (!isValidUsername) {
                      // The username they entered wasn't valid
                      convo.say('The username you entered isn\'t valid.');
                      convo.repeat();
                      convo.next();
                    } else{
                      // The username they entered is valid
                      checkIfUserExists(newAdminId, function(userExists) {
                        if (userExists) {
                          // The user is in the database
                          // Checks if the user you are trying to set as an admin
                          // is configured in the database.
                          isUserConfigured(bot, newAdminId, function(isNewAdminConfigured) {
                            if(isNewAdminConfigured) {
                              // Validating that the user is not already set to be an
                              // admin...
                              checkIsAdminById(newAdminId, function(isAlreadyAdmin) {
                                if (isAlreadyAdmin) {
                                  // The user that was entered is already an admin
                                  // Convo end point
                                  convo.say(newAdmin + ' is already an admin user in ' +
                                    'gemification.');
                                  convo.next();
                                } else{
                                  let newAdminName = convertIdToName(allSlackUsers,
                                                                      newAdminId);
                                  // The user that was entered is not an admin, and
                                  // should be set as an admin
                                  convo.next();
                                  // Validate the what is about to happen with the user
                                  // Array for this function is
                                  // array[answer, newAdminId, newAdmin]
                                  let answerYes = ['yes', newAdminId, newAdmin];
                                  let answerYesJSON = JSON.stringify(answerYes);
                                  let answerNo = ['no', newAdminId, newAdmin];
                                  let answerNoJSON = JSON.stringify(answerNo);
                                  bot.reply(message, {
                                    attachments: [
                                      {
                                        title: 'Are you sure you want to set ' +
                                          newAdmin + ' as an admin?',
                                        // Set admin and user is in the database
                                        callback_id: '1',
                                        attachment_type: 'default',
                                        actions: [
                                          {
                                            'name': 'yes',
                                            'text': 'Yes',
                                            'value': answerYesJSON,
                                            'type': 'button',
                                            'confirm': {
                                              'title': 'Are you sure?',
                                              'text': 'This will add ' + newAdminName +
                                                        ' as an administrator!',
                                              'ok_text': 'Yes',
                                              'dismiss_text': 'No',
                                            },
                                          },
                                          {
                                            'name': 'no',
                                            'text': 'No',
                                            'value': answerNoJSON,
                                            'type': 'button',
                                          },
                                        ],
                                      },
                                    ],
                                 });
                                }
                              });
                            }else {
                              convo.say('The user you are trying to set as an' +
                                        ' admin is not configured with' +
                                        ' Gemification. If you believe this' +
                                        ' is an error, speak to a Gemification' +
                                        ' admin and have them configure the' +
                                        ' user you are trying to set as an' +
                                        ' admin.');
                            }
                          });
                        }
                      });
                    }
                 });
               },
             },
            ]);
          });
        } else{
          // The user who typed the message isn't an admin
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only ' +
            'admins can add new admins. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

controller.hears(['list admins', 'list admin'], 'direct_message',
  function(bot, message) {
    isUserConfigured(bot, message.user, function(isConfigured) {
      if(isConfigured) {
        listAdmins(bot, message);
      }else {
        userConfiguredError(bot, message);
      }
    });
});

// This function removes an admin status for the user if the user has admin
// status. There is a check to make sure you don't remove the last admin user.
controller.hears('remove admin', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          // The user who typed the message is an admin
          bot.startConversation(message, function(err, convo) {
            convo.ask('Who would you like to remove as an admin? Type `list` to' +
                        ' show current admins or `cancel` to quit.', [
              {
                pattern: 'cancel',
                callback: function(response, convo) {
                  // Convo end point
                  convo.say('Cancel.. got it!');
                  convo.next();
                },
              },
              {
                pattern: 'list',
                callback: function(response, convo) {
                  // Listing the current admin
                  listAdmins(bot, message);
                  convo.repeat();
                  convo.next();
                },
              },
              {
                default: true,
                callback: function(response, convo) {
                  // getAllSlackUsers asyncronously gets all all of the Slack users
                  // that are the Slack team.
                  getAllSlackUsers(bot, function(allSlackUsers) {
                    // Trimmed raw username who is getting the admin privileges
                    // (ex. UW392NNSK)
                    let removeAdminTemp = String(response.text.match(/@[^\s]+/));
                    let removeAdminId =
                      removeAdminTemp.substring(1, removeAdminTemp.length-1);
                    let removeAdmin = '<@' + removeAdminId + '>';
                    checkIsLastAdmin(bot, removeAdminId, function(islastAdmin) {
                      let isValidUsername =
                        findUserById(allSlackUsers, removeAdminId);
                      if (!isValidUsername) {
                        // The username they entered wasn't valid
                        convo.say('The username you entered isn\'t valid.');
                        convo.repeat();
                        convo.next();
                      } else if(islastAdmin) {
                        // User is trying to remove himself as the last admin user
                        convo.say('You are trying to remove yourself, but you' +
                          ' are the last admin in this channel. Please add a new ' +
                          'admin before removing yourself.');
                        convo.next();
                      } else{
                        // The username they entered is valid and they are not the
                        // last admin
                        checkIfUserExists(removeAdminId, function(userExists) {
                          if (userExists) {
                            // The user is in the database
                            // Validating that the user is not already set to be
                            // an admin
                            checkIsAdminById(removeAdminId,
                              function(isAlreadyAdmin) {
                              if (isAlreadyAdmin) {
                                // The user that was entered is already an admin
                                // and should be removed
                                // Convo end point
                                convo.next();
                                // Validate the what is about to happen with the
                                // user

                                // Array for this function is
                                // array[button-value, removeAdminId, removeAdmin]
                                let answerYes = ['yes', removeAdminId, removeAdmin];
                                let answerYesJSON = JSON.stringify(answerYes);
                                let answerNo = ['no', removeAdminId, removeAdmin];
                                let answerNoJSON = JSON.stringify(answerNo);

                                let removeAdminName = convertIdToName(allSlackUsers,
                                                                    removeAdminId);

                                bot.reply(message, {
                                  attachments: [
                                    {
                                      title: 'Are you sure you want to remove ' +
                                        removeAdmin + ' as an admin?',
                                      // Remove admin
                                      callback_id: '3',
                                      attachment_type: 'default',
                                      actions: [
                                        {
                                          'name': 'yes',
                                          'text': 'Yes',
                                          'value': answerYesJSON,
                                          'type': 'button',
                                          'confirm': {
                                            'title': 'Are you sure?',
                                            'text': 'This will remove ' +
                                                removeAdminName +
                                                ' as an administrator!',
                                            'ok_text': 'Yes',
                                            'dismiss_text': 'No',
                                          },
                                        },
                                        {
                                          'name': 'no',
                                          'text': 'No',
                                          'value': answerNoJSON,
                                          'type': 'button',
                                        },
                                      ],
                                    },
                                  ],
                               });
                              } else{
                                // The user that was entered is not an admin, and
                                // should not be set as an admin
                                convo.say(removeAdmin + ' is currently not' +
                                                          ' an admin.');
                                convo.next();
                              }
                            });
                          } else{
                            // The user is not in the database and therefore isn't
                            // an admin
                            convo.say(removeAdmin + ' is currently not an admin.');
                            convo.next();
                          }
                        });
                      }
                    });
                 });
               },
             },
            ]);
          });
        } else{
          // The user who typed the message isn't an admin
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only' +
                      ' admins can add new admins. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// This function queries the database for the leader of each group in
// Gemification, returns, and prints out the reasons they were given gems
controller.hears('get reasons', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          // User who entered the message is an admin
          let reasonsPersonTemp = String(message.text.match(/@[^\s]+/));
          // Trimmed raw username who is getting the gem (ex. UW392NNSK)
          let reasonsPersonId = reasonsPersonTemp.substring(1,
            reasonsPersonTemp.length-1);
          // Encoded username who is getting the gem (ex. <@UW392NNSK>, but will
          // display as @john.doe in the Slack app)
          let reasonsPerson = '<@' + reasonsPersonId + '>';
          console.log('* get reasons variables:\n' +
                      'reasonsPersonId: ' + reasonsPersonId + '\n' +
                      'reasonsPerson: ' + reasonsPerson);
          getAllSlackUsers(bot, function(allUsers) {
            let isReasonPersonInvalid =
              !(allUsers.some(function(member) {
                return member.id == reasonsPersonId;
              }));
            console.log('isReasonPersonInvalid: ' + isReasonPersonInvalid);
            if(isReasonPersonInvalid) {
              bot.reply(message, 'The username you entered isn\'t valid.\n' +
                        'Proper usage: `get reasons @slackusername`');
            }else {
              // Getting the database pool
              DBPool.getConnection(function(err, connection) {
                if (err) throw err;
                let getReasonsQuery = 'SELECT reason, timestamp FROM' +
                            ' gemTransactions	WHERE' +
                            ' gemReceiver=(SELECT id FROM userGem WHERE' +
                            ' userId=' +
                            connection.escape(reasonsPersonId) + ') ' +
                            'AND timestamp > (' +
                            'SELECT resetTime' +
                            ' FROM gemPeriod' +
                            ' ORDER BY resetTime DESC' +
                            ' LIMIT 1' +
                            ' OFFSET 1)';
                connection.query(
                  getReasonsQuery,
                  function(err, rows) {
                  if (err) throw err;
                  // Done with connection
                  connection.release();
                  // Don't use connection here, it has been returned to the pool
                  let reasonStr = 'Below are the Gem transaction reasons for ' +
                                  reasonsPerson + ' from the last two gem periods.\n';
                  if(rows.length==0) {
                    reasonStr += reasonsPerson + ' doesn\'t have any gems.';
                  }else {
                    rows.reverse(); // reversing so that the most recent gem appears on top
                    for(let i=0; i<rows.length; i++) {
                      let timestamp = new Date(rows[i].timestamp);
                      if(i == (rows.length-1)) {
                        reasonStr += '>' + (i+1) + '.) ' +
                          rows[i].reason + '\n>\t-given on '
                          + dateFormat(timestamp,
                              "dddd, mmmm dS, yyyy, h:MM:ss TT");
                      }else {
                        reasonStr += '>' + (i+1) + '.) ' +
                           rows[i].reason + '\n>\t-given on '
                           + dateFormat(timestamp,
                              "dddd, mmmm dS, yyyy, h:MM:ss TT") + '\n';
                      }
                    }
                  }
                  // The bot talks back to the user
                  bot.reply(message, reasonStr);
                });
              });
            }
          });
        }else {
          // The user who typed the message isn't an admin
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin.' +
                              ' Only admins can get the reasons for' +
                              ' Gemification leaders. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// This function displays the current Gemification configuration set for your
// team.
controller.hears('team configuration', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          getTeamGroups(bot, function(groups) {
            let configurationStr = 'Below is the current Gemification configuration for your team.\n';
            configurationStr += 'Your team has ' + groups.length + ' groups. They are:\n';
            // printing the configured groups
            for(let i=0; i<groups.length; i++) {
              let groupName = groups[i].groupName;
              if(i == (groups.length-1)) {
                configurationStr += '>' + (i+1) + '.) ' +
                  groupName;
              }else {
                configurationStr += '>' + (i+1) + '.) ' +
                   groupName + '\n';
              }
            }
            // printing the users assigned to the groups
            for(let i=0; i<groups.length; i++) {
              let groupName = groups[i].groupName;
              // Getting the database pool
              DBPool.getConnection(function(err, connection) {
                if (err) throw err;
                let query = 'SELECT userId ' +
                              'FROM userGem ' +
                              'WHERE groupId=' +
                              '(SELECT id FROM teamConfiguration' +
                              ' WHERE groupName=' + connection.escape(groupName) + ');';
                connection.query(
                  query,
                  function(err, rows) {
                  if (err) throw err;
                  // Done with connection
                  connection.release();
                  configurationStr += '\n\nUsers in ' + groupName + ' group:\n';
                  for(let j=0; j<rows.length; j++) {
                    let user = '<@' + rows[j].userId + '>';
                    if(j == (rows.length-1)) {
                      configurationStr += '>' + user;
                    }else {
                      configurationStr += '>' + user + '\n';
                    }
                  }
                  // if is the last element, have the bot reply
                  if(i==groups.length-1) {
                    bot.reply(message, configurationStr);
                  }
                });
              });
            }
          });
        }else {
          // The user who typed the message isn't an admin
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin.' +
                              ' Only admins can get the reasons for' +
                              ' Gemification leaders. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// This function will take an admin thru reassigning a user to a different
// Gemification group.
controller.hears('reconfigure user', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          // The user who typed the message is an admin
          bot.startConversation(message, function(err, convo) {
            convo.ask('Who would you like to reconfigure? Or type `cancel` ' +
              'to quit.', [
              {
                pattern: 'cancel',
                callback: function(response, convo) {
                  // Convo end point
                  convo.say('Cancel.. got it!');
                  convo.next();
                },
              },
              {
                default: true,
                callback: function(response, convo) {
                  // getAllSlackUsers asyncronously gets all all of the Slack users
                  // that are the Slack team.
                  getAllSlackUsers(bot, function(allSlackUsers) {
                    // Trimmed raw username who is getting the admin privileges
                    // (ex. UW392NNSK)
                    let reconfigureUserTemp = String(response.text.match(/@[^\s]+/));
                    let reconfigureUserId = reconfigureUserTemp.substring(1,
                      reconfigureUserTemp.length-1);
                    let reconfigureUser = '<@' + reconfigureUserId + '>';
                    let isValidUsername = findUserById(allSlackUsers, reconfigureUserId);
                    if (!isValidUsername) {
                      // The username they entered wasn't valid
                      convo.say('The username you entered isn\'t valid.');
                      convo.repeat();
                      convo.next();
                    }else{
                      isBot(bot, reconfigureUserId, function(isReconfiguredUserABot) {
                        if(isReconfiguredUserABot) {
                          convo.say('The user you entered is a bot and cannot' +
                                      ' be configured for Gemification.');
                          convo.repeat();
                          convo.next();
                        }else{
                          // The username they entered is valid
                          // Getting the groups for the team
                          getTeamGroups(bot, function(groups) {
                            let buttons = [];
                            // assigning the groups to buttons
                            for(let i=0; i<groups.length; i++) {
                              let answer = [groups[i].groupName, reconfigureUserId];
                              let answerJSON = JSON.stringify(answer);
                              let button = {
                                'name': groups[i].groupName,
                                'text': groups[i].groupName,
                                'value': answerJSON,
                                'type': 'button',
                              };
                              buttons.push(button);
                            }
                            // adding the remove button
                            let ignoreAnswer = ['remove', reconfigureUserId];
                            let ignoreAnswerJSON = JSON.stringify(ignoreAnswer);
                            buttons.push({
                              'name': 'remove',
                              'text': 'Remove From Group',
                              'value': ignoreAnswerJSON,
                              'type': 'button',
                            });
                            // all team groups now have their own button
                            checkIfUserExists(reconfigureUserId, function(isReconfiguringUserInDB) {
                              if(isReconfiguringUserInDB) {
                                // user is in database
                                console.log('* reconfigure user: User ' + reconfigureUserId + ' is in database.');
                                DBPool.getConnection(function(err, connection) {
                                  // getting the current group of the user
                                  if (err) throw err;
                                  let query;
                                  let teamId = bot.identifyTeam();
                                  // user is assigning group to self
                                  query = 'SELECT groupName FROM teamConfiguration' +
                                          ' WHERE id=(SELECT groupId FROM userGem' +
                                          ' WHERE userId=' +
                                          connection.escape(reconfigureUserId) +
                                          ' AND teamId=(SELECT id FROM teams' +
                                          ' WHERE slackTeamId=' +
                                          connection.escape(teamId) + '))';
                                  connection.query(
                                    query,
                                    function(err, rows) {
                                    if (err) throw err;
                                    connection.release();
                                    convo.next();
                                    let groupText = '';
                                    if(typeof rows[0] !== 'undefined') {
                                      // user was set to a group
                                      let currentGroup = rows[0].groupName;
                                      groupText = ' This person is currently set' +
                                                  ' to ' + currentGroup + ' group.';
                                    }else {
                                      // user wasn't set to a group
                                      groupText = ' This person isn\'t currently' +
                                                  ' assigned to a group.';
                                    }
                                    convo.ask({
                                      text: 'Let\'s reconfigure ' + reconfigureUser +
                                            '.' + groupText,
                                      attachments: [
                                        {
                                          title: 'Which group would you like to set ' + reconfigureUser + ' to?',
                                          // Assign users to group
                                          callback_id: '6',
                                          attachment_type: 'default',
                                          actions: buttons,
                                        },
                                      ],
                                    });
                                  });
                                });
                              }else {
                                // user isn't in database, need to create a new row
                                console.log('* reconfigure user: User ' + reconfigureUserId + ' is not in database.');
                                convo.next();
                                convo.ask({
                                  text: 'Let\'s reconfigure ' + reconfigureUser +
                                        '. This person isn\'t currently' +
                                        ' assigned to a group.',
                                  attachments: [
                                    {
                                      title: 'Which group would you like to set ' + reconfigureUser + ' to?',
                                      // Assign users to group
                                      callback_id: '7',
                                      attachment_type: 'default',
                                      actions: buttons,
                                    },
                                  ],
                                });
                              }
                            });
                          });
                        }
                      });
                    }
                 });
               },
             },
            ]);
          });
        } else{
          // The user who typed the message isn't an admin
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only ' +
            'admins reconfigure users. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// This function gives a bit of documentation help to the user
// It listens for a direct message or direct me
controller.hears('help', 'direct_message',
  function(bot, message) {
    isUserConfigured(bot, message.user, function(isConfigured) {
      if(isConfigured) {
        checkIsAdminByMessage(bot, message, function(isAdmin) {
          if(isAdmin) {
            let helpStr = 'Need some help? We all do sometimes...\nHere are a list' +
                ' of commands that you can use to interact with Gemification:\n\n';

            let publicCommands = '*Public commands*\n';
            publicCommands += '1) How to give someone a gem :gem:\n';
            publicCommands += 'Type `:gem: [@username] for [reason]`\n\n';
            publicCommands += '2) How to show the leaderboard\n';
            publicCommands += 'In a direct message to Gemification, type `leaderboard`\n';
            publicCommands += 'In a channel, type `@gemification leaderboard`\n\n';

            let adminCommands = '*Admin commands (these can only be run if you\'re' +
                ' an admin)*\n';
            adminCommands += '1) How to clear the gem leaderboard\n';
            adminCommands += 'In a direct message to Gemification, type `clear gems`\n\n';
            adminCommands += '2) How to list the current admins in Gemification\n';
            adminCommands += 'In a direct message to Gemification, type `list admins`\n\n';
            adminCommands += '3) How to add an admin to Gemification\n';
            adminCommands += 'In a direct message to Gemification, type `add admin` and follow' +
                ' the prompts\n\n';
            adminCommands += '4) How to remove an admin from Gemification\n';
            adminCommands += 'In a direct message to Gemification, type `remove admin` and follow' +
                ' the prompts\n\n';
            adminCommands += '5) Get a full list of gems given in the current' +
                ' time period.\n';
            adminCommands += 'In a direct message to Gemification, type `all gems`\n\n';
            adminCommands += '6) Show a list of gem statement reasons for' +
                              ' a Gemification user.\n';
            adminCommands += 'In a direct message to Gemification, type `get reasons @slackuser`\n\n';
            adminCommands += '7) List all of the Gemification user and which group they are assigned to.\n';
            adminCommands += 'In a direct message to Gemification, type `team configuration`\n\n';
            adminCommands += '8) Reconfigure a user to a different Gemification group.\n';
            adminCommands += 'In a direct message to Gemification, type `reconfigure user`\n\n';

            helpStr += publicCommands + adminCommands;
            bot.reply(message, helpStr);
          } else{
            let helpStr = 'Need some help? We all do sometimes...\nHere are a' +
                ' list of commands that you can use to interact with ' +
                'Gemification:\n\n';

            let publicCommands = '1) How to give someone a gem :gem:\n';
            publicCommands += 'Type `:gem: [@username] for [reason]`\n\n';
            publicCommands += '2) How to show the leaderboard\n';
            publicCommands += 'In a direct message to Gemification, type `leaderboard`\n';
            publicCommands += 'In a channel, type `@gemification leaderboard`\n\n';

            helpStr += publicCommands;
            bot.reply(message, helpStr);
          }
        });
      }else {
        userConfiguredError(bot, message);
      }
    });
});

// Gemification bot listens for a direct meantion followed by the leaderboard
// keyword. The bot then performs a query on the Gemification database and asks
// for the top 10 people that have a gem count greater than 0.
// The leaderboard is then paresed as a string in leaderboardStr like this...
//
// Leaderboard:
// 1.) emily.albulushi 5
// 2.) kerkhofj 4
// 3.) josh.schmidt 3
// 4.) kurt.kaufman 3
// 5.) likwam29 3
// 6.) sean.mitchell 2
// 7.) alex.flasch 1
// 8.) derrick.heinemann 1
// 9.) weinks15 1
// 10.) bateset39 1
controller.hears('all gems', 'direct_message', function(bot, message) {
  isUserConfigured(bot, message.user, function(isConfigured) {
    if(isConfigured) {
      checkIsAdminByMessage(bot, message, function(isAdmin) {
        if(isAdmin) {
          getTeamGroups(bot, function(groups) {
            for(let i=0; i<groups.length; i++) {
              let groupName = groups[i].groupName;
              // Getting the database pool
              DBPool.getConnection(function(err, connection) {
                if (err) throw err;
                let teamId = bot.identifyTeam(); // Gets the ID of the team
                let query = 'SELECT userId, totalGems FROM userGem WHERE ' +
                              'teamId=(SELECT id FROM teams WHERE slackTeamId=' + connection.escape(teamId) + ') ' +
                              'AND groupId=(SELECT id FROM teamConfiguration WHERE groupName=' + connection.escape(groupName) + ') ' +
                              'AND totalGems > 0 ORDER BY totalGems DESC';
                connection.query(
                  query,
                  function(err, rows) {
                  if (err) throw err;
                  // Done with connection
                  connection.release();
                  // Don't use connection here, it has been returned to the pool

                  // Getting all the usernames
                  getAllSlackUsers(bot, function(allSlackUsers) {
                    if(isEmptyObject(rows)) {
                      bot.reply(message, 'Nobody has received any gems yet in the ' + groupName + ' group. :sob: Try' +
                                          ' giving someone a :gem:!');
                    } else{
                      // Parsing the leaderboard, looping thru everybody returned in the
                      // query
                      let leaderboardStr = groupName + ' All Gems Leaderboard:\n';
                      for(let i=0; i<rows.length; i++) {
                        if(i==rows.length-1) {
                          leaderboardStr += '>' + (i+1) + '.) ' +
                          convertIdToName(allSlackUsers, rows[i].userId) + ' ' +
                          rows[i].totalGems;
                        } else{
                          leaderboardStr += '>' + (i+1) + '.) ' +
                          convertIdToName(allSlackUsers, rows[i].userId) + ' ' +
                          rows[i].totalGems + '\n';
                        }
                      }
                      bot.reply(message, leaderboardStr);
                    }
                  });
                });
              });
            }
          });
        } else{
          bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only' +
            ' admins can list all gems. :angry:');
        }
      });
    }else {
      userConfiguredError(bot, message);
    }
  });
});

// This method causes the bot to react with a cow-hat to everything Austin says
controller.hears('', ['direct_mention', 'direct_message', 'ambient'],
  function(bot, message) {
  let austin = 'U20T30X6Z';
  if(message.user === austin) {
    bot.api.reactions.add({
      timestamp: message.ts,
      channel: message.channel,
      name: 'cow-hat',
    }, function(err) {
      if (err) {
        console.log(err);
      }
    });
  }
});
