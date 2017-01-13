/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  _______  _______ .___  ___.  __   _______  __    ______     ___   .___________. __    ______   .__   __.
 /  _____||   ____||   \/   | |  | |   ____||  |  /      |   /   \  |           ||  |  /  __  \  |  \ |  |
|  |  __  |  |__   |  \  /  | |  | |  |__   |  | |  ,----'  /  ^  \ `---|  |----`|  | |  |  |  | |   \|  |
|  | |_ | |   __|  |  |\/|  | |  | |   __|  |  | |  |      /  /_\  \    |  |     |  | |  |  |  | |  . `  |
|  |__| | |  |____ |  |  |  | |  | |  |     |  | |  `----./  _____  \   |  |     |  | |  `--'  | |  |\   |
 \______| |_______||__|  |__| |__| |__|     |__|  \______/__/     \__\  |__|     |__|  \______/  |__| \__|


This is a sample Slack Button application that adds a bot to one or many slack teams.

# RUN THE APP:
  Create a Slack app. Make sure to configure the bot user!
    -> https://api.slack.com/applications/new
    -> Add the Redirect URI: http://gemification.mio.uwosh.edu/oauth
  Run your bot from the command line:
    clientId=<my client id> clientSecret=<my client secret> port=3000 node slackbutton_bot.js
# USE THE APP
  Add the app to your Slack by visiting the login page:
    -> http://gemification.mio.uwosh.edu/login
  After you've added the app, try talking to your bot!
# EXTEND THE APP:
  Botkit has many features for building cool and useful bots!
  Read all about it here:
    -> http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('./lib/Botkit.js');
// MySQL ORM package
var mysql = require('mysql');
// Gemification server credentials
var DBCredentials = require('./db-credentials.js');

if (!process.env.clientId || !process.env.clientSecret || !process.env.port || !process.env.redirectUri) {
  console.log('Error: Specify clientId clientSecret redirectUri and port in environment');
  process.exit(1);
}

var controller = Botkit.slackbot({
  json_file_store: './db_slackbutton_bot/',
  interactive_replies: true
  // rtm_receive_messages: false, // disable rtm_receive_messages if you enable events api
}).configureSlackApp(
  {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    redirectUri: process.env.redirectUri,
    scopes: ['bot'],
  }
);

// Instantiating the Gemification database pool
var DBPool = mysql.createPool({
  host     : DBCredentials.HOST,
  user     : DBCredentials.USERNAME,
  password : DBCredentials.PASSWORD,
  database : DBCredentials.DATABASE
});

// Supply this will return a list of members in JSON
function getMembersInChannel(bot, message, callback){
  bot.api.channels.info({channel: message.channel}, function(err, response) {
    callback(response.channel.members);
  });
}

// Check if the object you are passing in is empty
function isEmptyObject(obj) {
  return !Object.keys(obj).length;
}

// Gets all users in the Slack channel and calls the callback function
function getSlackUsers(bot, message, callback){
  bot.api.users.list({}, function(err, response) {
    callback(response.members);
  });
}

// Gets all users in the Slack channel and calls the callback function
function getSlackUsersWithoutMessage(bot, callback){
  bot.api.users.list({}, function(err, response) {
    callback(response.members);
  });
}

// Converts a Slack userId to a Slack username
// Function takes in a JSON object of all Slack users and the Slack userId
function convertIdToName(slackUsers, id){
  return slackUsers.filter(function(user){
    return user.id == id;
  })[0].name
}

controller.setupWebserver(process.env.port,function(err,webserver) {
  controller.createWebhookEndpoints(controller.webserver);
  controller.createHomepageEndpoint(controller.webserver);
  controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('You have successfully connected Gemification to your team!');
    }
  });
});

// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};
function trackBot(bot) {
  _bots[bot.config.token] = bot;
}

controller.on('create_bot',function(bot,config) {

  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {

      if (!err) {
        trackBot(bot);
      }

      bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
        if (err) {
          console.log(err);
        } else {
          convo.say('I am the gemification bot that has just joined your team');
          convo.say('Please /invite me to your channel so that people can start giving gems!');

          // Adding the user which installed gemification as an admin
          getSlackUsersWithoutMessage(bot, function(allSlackUsers){
            var createdByUsername = convertIdToName(allSlackUsers, config.createdBy);
            // Getting the database pool
            DBPool.getConnection(function(err, connection){
              if (err) throw err;
              var createAdminUserQuery = 'INSERT INTO userGem (userId, username, isAdmin) VALUES (\'' + config.createdBy + '\', \'' + createdByUsername + '\', TRUE)';
              console.log('Create Admin User Query: ' + createAdminUserQuery);
              connection.query(
                createAdminUserQuery,
                function(err, rows){
                if (err) throw err;
                // Done with connection
                connection.release();
                // Don't use connection here, it has been returned to the pool
                bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
                  if (err) {
                    console.log(err);
                  } else {
                    convo.say('Your user has been added to as an administrator to gemification');
                  }
                });
              });
            });
          });
        }
      });
    });
  }
});


// Handle events related to the websocket connection to Slack
controller.on('rtm_open',function(bot) {
  console.log('** The RTM api just connected!');
});

controller.on('rtm_close',function(bot) {
  console.log('** The RTM api just closed... attempting to reopen RTM connection');
  // you may want to attempt to re-open
  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {
      if (!err) {
        trackBot(bot);
      }
    });
  }
});

controller.storage.teams.all(function(err,teams) {
  if (err) {
    throw new Error(err);
  }
  // connect all teams with bots up to slack!
  for (var t  in teams) {
    if (teams[t].bot) {
      controller.spawn(teams[t]).startRTM(function(err, bot) {
        if (err) {
          console.log('Error connecting bot to Slack:',err);
        } else {
          trackBot(bot);
        }
      });
    }
  }
});

// Message data contains the following content by this association
// type, channel, user, text, ts, team, event, match
controller.hears(':gem:','ambient',function(bot,message) {
  // getting all of the usernames in the channel, then executing the callback function
  // after the task gets all the usernames
  getMembersInChannel(bot, message, function(membersInChannel){
    getSlackUsers(bot, message, function(allSlackUsers){
      // Logging
      console.log('***************BEGIN DEBUGGING***************');
      // Everything the user typed in the message
      var messageText = message.text;
      // Raw userId of the gem giver (ex. UW392NNSK)
      var gemGiverId = message.user;
      // Person who gave the :gem:
      var gemGiverEncoded = '<@' + gemGiverId + '>';
      // Trimmed raw username who is getting the gem (ex. UW392NNSK)
      var gemReceiverIdTemp = String(messageText.match(/@([^\s]+)/g));
      var gemReceiverId = gemReceiverIdTemp.substring(1, gemReceiverIdTemp.length-1);
      // Encoded username who is getting the gem (ex. <@UW392NNSK>, but will display as @john.doe
      // in the Slack app)
      var gemReceiver = '<@' + gemReceiverId + '>';
      // Instantiating the reason variable
      var reason = '';
      // Checking if the user type a reason after the keyword 'for ', if not, do nothing
      if(messageText.includes('for ')){
        reason = messageText.substr(messageText.indexOf('for ') + 4);
      }

      // Logging
      console.log('***************VARIABLES***************' + '\n' +
                  'Message Text: ' + JSON.stringify(messageText) + '\n' +
                  'Gem Giver ID: ' + gemGiverId + '\n' +
                  'Gem Giver Encoded: ' + gemGiverEncoded + '\n' +
                  'Gem Receiver ID: ' + gemReceiverId + '\n' +
                  'Gem Receiver Encoded: ' + gemReceiver + '\n' +
                  'Reason: ' + reason
              );

      // This if-statement checks for a variety of conditions

      // First, it checks to see if the reason is an empty string -- it requires a reason for
      // storage to the database.
      var isReasonEmpty = (reason == '');
      // Second, it checks to see if the member the user entered to give the gem TO is a valid username
      // in the channel.
      var isGemReceiverInvalid = !(membersInChannel.indexOf(gemReceiverId) > -1);
      // Third, it checks if the :gem: is typed after the word 'for' meaning the user typed their
      // statement in the wrong order.
      var isGemInReason = (reason.indexOf(':gem:') > -1);
      // Fourth, it checks if the user typed in the message is after 'for' meaning the user typed
      // their statement in the wrong order.
      var isGemReceiverInReason = (reason.indexOf(gemReceiverId) > -1);
      // Fifth, it checks to see if a user trying to give a gem to themselves.
      var isSelfGivingGem = (gemGiverId == gemReceiverId);

      // If none of these condition are met, the user typed a valid gem statment and program execution
      // can proceed. Valid gem statements are as following...
      // :gem: [@username] for [reason] -- this is the suggested statement syntax
      // [@username] :gem: for [reason]

      // Logging
      console.log('***************VALIDATIONS***************' + '\n' +
                  'Is reason undefined: ' + isReasonEmpty + '\n' +
                  'Is gem receiver invalid: ' + isGemReceiverInvalid + '\n' +
                  'Is gem in reason statement: ' + isGemInReason + '\n' +
                  'Is gem receiver in reason statement: ' + isGemReceiverInReason + '\n' +
                  'Is user giving themselves a gem: ' + isSelfGivingGem
              );


      if (isReasonEmpty || isGemReceiverInvalid || isGemInReason || isGemReceiverInReason){
        // User typed an invalid statement, output error message
        var errorMessage = 'Sorry, ' + gemGiverEncoded + ', there was an error in your gem statement because:\n';
        if(isGemReceiverInvalid){
          errorMessage += '- you didn\'t type a valid gem receiver\n';
        }
        if(isReasonEmpty){
          errorMessage += '- you didn\'t include a reason statement\n';
        }
        if(isGemInReason){
          errorMessage += '- you typed gems in your reason statement\n';
        }
        if(isGemReceiverInReason){
          errorMessage += '- you don\'t type users in your reason statement\n';
        }
        errorMessage += 'Please type your gem statement using a valid username like this:\n' +
        ':gem: [@username] for [reason]';

        // The bot private messages the gem giver and explain their error
        bot.startPrivateConversation({user: gemGiverId},function(err,convo) {
          if (err) {
            console.log(err);
          } else {
            convo.say(errorMessage);
          }
        });
      }
      // Checks if the the someone is trying to give a gem to themselves
      else if(isSelfGivingGem){
        // The bot private messages the gem giver and explain their error
        bot.startPrivateConversation({user: gemGiverId},function(err,convo) {
          if (err) {
            console.log(err);
          } else {
            convo.say('Nice try, jackwagon. You can\'t give a gem to yourself. ' +
                      'You may only give gems to other people in this channel.');
          }
        });
      } else{
        // User typed a valid statement, we have valid data, proceed with database calls

        // Getting the usernames for users involved in the gem statement
        // Username of the gem giver (ex. kerkhofj)
        var gemGiverUsername = convertIdToName(allSlackUsers, gemGiverId);
        // Username of the gem receiver (ex. emily.albulushi)
        var gemReceiverUsername = convertIdToName(allSlackUsers, gemReceiverId);
        console.log('***************CONVERTED USERNAMES***************' + '\n' +
                    'Gem Giver Username: ' + gemGiverUsername + '\n' +
                    'Gem Receiver Username: ' + gemReceiverUsername
                  );

        // Getting the database pool
        DBPool.getConnection(function(err, connection){
          if (err) throw err;
          var giveGemQuery = 'CALL incrementGems(\'' + gemGiverId + '\', \'' + gemGiverUsername + '\', \'' + gemReceiverId + '\', \'' + gemReceiverUsername + '\', \'' + reason + '\');';
          connection.query(
            giveGemQuery,
            function(err, rows){
            if (err) throw err;
            // Done with connection
            connection.release();
            // Don't use connection here, it has been returned to the pool

            // The bot private messages the gem giver and says their gem transaction was successful
            bot.startPrivateConversation({user: gemGiverId},function(err,convo) {
              if (err) {
                console.log(err);
              } else {
                convo.say(gemGiverUsername + ', you gave a gem to ' + gemReceiverUsername + '!');
              }
            });
          });
        });
      }
      // Logging
      console.log('***************END DEBUGGING***************');
    });
  });
});

// The gemification bot listens for a direct meantion followed by the leaderboard
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
controller.hears('leaderboard',['direct_mention','direct_message'],function(bot,message) {
  // Getting the database pool
  DBPool.getConnection(function(err, connection){
    if (err) throw err;
    connection.query(
      'SELECT username, currentGems FROM userGem WHERE currentGems > 0 ORDER BY currentGems DESC',
      function(err, rows){
      if (err) throw err;
      // Done with connection
      connection.release();
      // Don't use connection here, it has been returned to the pool
      if(isEmptyObject(rows)){
        bot.reply(message, 'The leaderboard is empty. Try giving someone a :gem:!');
      } else{
        // Parsing the leaderboard, looping thru everybody returned in the query
        var leaderboardStr = 'Leaderboard:\n';
        for(var i=0; i<rows.length; i++){
          if(i==rows.length-1){
            leaderboardStr += (i+1) + ".) " + rows[i].username + " " + rows[i].currentGems;
          } else{
            leaderboardStr += (i+1) + ".) " + rows[i].username + " " + rows[i].currentGems + "\n";
          }
        }
        bot.reply(message, leaderboardStr);
      }
    });
  });
});

function isAdmin(bot, message, callback){
  DBPool.getConnection(function(err, connection){
    if (err) throw err;
    connection.query(
      'SELECT isAdmin FROM userGem WHERE userId=\'' + message.user + '\';',
      function(err, rows){
      if (err) throw err;
      if(rows[0].isAdmin==1){
        // user is an admin and may proceed to clear the gem period.
        callback();
        return true;
      }else {
        // user isn't an admin and needs to be put in their place.
        return false;
      }
    });
  });
}

// This function listens for a direct message from the admin to clear the leaderboard.
// First, it checks if the user is an admin and if not, spits out an error message
// If the user is an admin, then it will submit a query to the database adding a row
// to the gemPeriod table and firing a trigger in the database to set all currentGems
// to 0 for all users.
controller.hears('clear gems','direct_message',function(bot,message) {
  // Validates if the user typed is an admin
  // Getting the database pool
  var success = isAdmin(bot, message, function(){
    DBPool.getConnection(function(err, connection){
      if (err) throw err;
      connection.query(
        'INSERT INTO gemPeriod VALUES();',
        function(err, rows){
        if (err) throw err;
        // Done with connection
        connection.release();
        // Don't use connection here, it has been returned to the pool
      });
    });
  });
  if(success){
    // The leaderboard was cleared successfully
    bot.reply(message, 'The leaderboard was cleared successfully. Now get out there and start earning yourself some gems! :gem:');
  } else{
    // The user wasn't an admin
    bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only admins can reset the gem count. :angry:');
  }
  // DBPool.getConnection(function(err, connection){
  //   if (err) throw err;
  //   connection.query(
  //     'SELECT isAdmin FROM userGem WHERE userId=\'' + message.user + '\';',
  //     function(err, rows){
  //     if (err) throw err;
  //     if(rows[0].isAdmin==1){
  //       // user is an admin and may proceed to clear the gem period.
  //       connection.query(
  //         'INSERT INTO gemPeriod VALUES();',
  //         function(err, rows){
  //         if (err) throw err;
  //         // Done with connection
  //         connection.release();
  //         // Don't use connection here, it has been returned to the pool
  //         bot.reply(message, 'The leaderboard was cleared successfully. Now get out there and start earning yourself some gems! :gem:');
  //       });
  //     }else {
  //       // user isn't an admin and needs to be put in their place.
  //       bot.reply(message, 'Nice try, wise guy, but you aren\'t an admin. Only admins can reset the gem count. :angry:');
  //     }
  //   });
  // });
});

controller.hears('add admin', 'direct_message', function(bot, message){
  bot.startConversation(message, function(err, convo) {
    convo.ask('Who would you like to add as an admin?', function(response, convo){
      convo.say('Cool, you said: ' + response.text);
      convo.next();
    });
  });
});
