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
  // rtm_receive_messages: false, // disable rtm_receive_messages if you enable events api
}).configureSlackApp(
  {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    redirectUri: process.env.redirectUri,
    scopes: ['bot'],
  }
);

controller.setupWebserver(process.env.port,function(err,webserver) {
  controller.createWebhookEndpoints(controller.webserver);

  controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
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
          convo.say('I am a bot that has just joined your team');
          convo.say('You must now /invite me to a channel so that I can be of use!');
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
  console.log('** The RTM api just closed');
  // you may want to attempt to re-open
});

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

// Supply this will return information about the channel
function getAllUsers(bot, message, id, callback){
  bot.api.users.list(function(err, response) {
    callback(response.members, id);
  });
}

// Converts user ID to name
function convertIDToName(id, bot, message){
    getAllUsers(bot, message, id, function(membersInChannel, id){
      console.log('Inside callback function');
      var index = membersInChannel.indexOf(id);
      console.log('Index of ' + id + ': ' + index);
      console.log('Name: ' + JSON.stringify(membersInChannel));
    });
}

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
    // Logging
    console.log('***************BEGIN DEBUGGING***************');
    // Everything the user typed in the message
    var messageText = message.text;
    // Raw user of the gem giver
    var gemGiverRaw = message.user;
    // Person who gave the :gem:
    var gemGiver = '<@' + gemGiverRaw + '>';
    // Raw username who is getting the gem (ex. @UW392NNSK>)
    var gemReceiverRaw = String(messageText.match(/@([^\s]+)/g));
    // Trimmed raw username who is getting the gem (ex. UW392NNSK)
    var trimmedGemReceiverRaw = gemReceiverRaw.substring(1, gemReceiverRaw.length-1);
    // Encoded username who is getting the gem (ex. <@UW392NNSK>, but will display as @john.doe
    // in the Slack app)
    var gemReceiver = '<@' + trimmedGemReceiverRaw + '>';
    // Instantiating the reason variable
    var reason = '';
    // Checking if the user type a reason after the keyword 'for ', if not, do nothing
    if(messageText.includes('for ')){
      reason = messageText.substr(messageText.indexOf('for ') + 4);
    }

    // Logging
    console.log('***************VARIABLES***************' + '\n' +
                'Message Text: ' + JSON.stringify(messageText) + '\n' +
                'Gem Giver Raw: ' + gemGiverRaw + '\n' +
                'Gem Giver: ' + gemGiver + '\n' +
                'Gem Receiver Raw: ' + gemReceiverRaw + '\n' +
                'Trimmed Gem Receiver Raw: ' + trimmedGemReceiverRaw + '\n' +
                'Gem Receiver: ' + gemReceiver + '\n' +
                'Reason: ' + reason
            );

    // This if-statement checks for a variety of conditions

    // First, it checks to see if the reason is an empty string -- it requires a reason for
    // storage to the database.
    var isReasonEmpty = (reason == '');
    // Second, it checks to see if the member the user entered to give the gem TO is a valid username
    // in the channel.
    var isGemReceiverInvalid = !(membersInChannel.indexOf(trimmedGemReceiverRaw) > -1);
    // Third, it checks if the :gem: is typed after the word 'for' meaning the user typed their
    // statement in the wrong order.
    var isGemInReason = (reason.indexOf(':gem:') > -1);
    // Fourth, it checks if the user typed in the message is after 'for' meaning the user typed
    // their statement in the wrong order.
    var isGemReceiverInReason = (reason.indexOf(trimmedGemReceiverRaw) > -1);
    // Fifth, it checks to see if a user trying to give a gem to themselves.
    var isSelfGivingGem = (gemGiver == gemReceiver);

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
      bot.reply(message, 'Sorry, ' + gemGiver + '. There was an error in your gem statement...\n' +
        'Please type your gem statement using a valid username like this:\n' +
        ':gem: [@username] for [reason]'
      );
    }
    // Checks if the the someone is trying to give a gem to themselves
    else if(isSelfGivingGem){
      bot.reply(message, 'Nice try, jackwagon. You can\'t give a gem to yourself. ' +
                'You may only give gems to other people in this channel.');
    } else{
      // User typed a valid statement, we have valid data, proceed with database calls

      // Getting the database pool
      DBPool.getConnection(function(err, connection){
        if (err) throw err;
        var giveGemQuery = 'CALL incrementGems(\'' + gemGiverRaw + '\', \'' + trimmedGemReceiverRaw + '\', \'' + reason + '\');';

        // For logging
        console.log('Give Gem Query: ' + giveGemQuery);

        connection.query(
          giveGemQuery,
          function(err, rows){
          if (err) throw err;
          // Done with connection
          connection.release();
          // Don't use connection here, it has been returned to the pool
          bot.reply(message, 'You have successfully given a gem to ' + gemReceiver + '!');
        });
      });
    }
    // Logging
    console.log('***************END DEBUGGING***************');
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
        bot.reply(message, 'The leaderboard is empty. Try giving someone a gem!');
      } else{
        // Parsing the leaderboard
        var leaderboardStr = 'Leaderboard:\n';
        for(var i=0; i<rows.length; i++){
          if(i==rows.length-1){
            convertIDToName(rows[i].username, bot, message);
            leaderboardStr += (i+1) + ".) <" + rows[i].username + "> " + rows[i].currentGems;
          } else{
            leaderboardStr += (i+1) + ".) <" + rows[i].username + "> " + rows[i].currentGems + "\n";
          }
        }
        bot.reply(message, leaderboardStr);
      }
    });
  });
});

// This function listens for a direct message from the admin to clear the leaderboard.
// First, it checks if the user is an admin and if not, spits out an error message
// If the user is an admin, then it will submit a query to the database adding a row
// to the gemPeriod table and firing a trigger in the database to set all currentGems
// to 0 for all users.
controller.hears('clear gems','direct_message',function(bot,message) {
  // Validates if the user typed is an admin
  // *****STILL NEED TO BUILD VALIDATION*****

  // Getting the database pool
  DBPool.getConnection(function(err, connection){
    if (err) throw err;
    connection.query(
      'INSERT INTO gemPeriod VALUES()',
      function(err, rows){
      if (err) throw err;
      // Done with connection
      connection.release();
      // Don't use connection here, it has been returned to the pool
      bot.reply(message, 'The leaderboard was cleared successfully!');
    });
  });
});
