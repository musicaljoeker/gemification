/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a sample Slack Button application that adds a bot to one or many slack teams.

# RUN THE APP:
  Create a Slack app. Make sure to configure the bot user!
    -> https://api.slack.com/applications/new
    -> Add the Redirect URI: http://localhost:3000/oauth
  Run your bot from the command line:
    clientId=<my client id> clientSecret=<my client secret> port=3000 node slackbutton_bot.js
# USE THE APP
  Add the app to your Slack by visiting the login page:
    -> http://localhost:3000/login
  After you've added the app, try talking to your bot!
# EXTEND THE APP:
  Botkit has many features for building cool and useful bots!
  Read all about it here:
    -> http://howdy.ai/botkit
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('./lib/Botkit.js');

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

// Supply this will return a list of members in JSON
function getMembersInChannel(bot, message, callback){
  bot.api.channels.info({channel: message.channel}, function(err, response) {
    callback(response.channel.members);
  });
}

// Message data contains the following content by this association
// type, channel, user, text, ts, team, event, match
controller.hears(':gem:','ambient',function(bot,message) {
  // getting all of the usernames in the channel, then executing the callback function
  // after the task gets all the usernames
  getMembersInChannel(bot, message, function(membersInChannel){
    // Everything the user typed in the message
    var messageText = message.text;
    // Person who gave the :gem:
    var gemGiver = '<@' + message.user + '>';
    // Raw username who is getting the gem (ex. @UW392NNSK>)
    var gemReceiverRaw = String(messageText.match(/@([^\s]+)/g));
    // Trimmed raw username who is getting the gem (ex. UW392NNSK)
    var trimmedGemReceiverRaw = gemReceiverRaw.substring(1, gemReceiverRaw.length-1);
    // Encoded username who is getting the gem (ex. <@UW392NNSK>, but will display as @john.doe
    // in the Slack app)
    var gemReceiver = '<@' + trimmedGemReceiverRaw + '>';
    // Instantiating the reason variable
    var reason;
    // Checking if the user type a reason after the keyword 'for ', if not, do nothing
    if(messageText.includes('for ')){
      reason = messageText.substr(messageText.indexOf('for ') + 4);
    }

    // This if-statement checks for a variety of conditions
    // First, it checks to see if the reason is undefinied -- it requires a reason for storage to the
    // database.
    // Second, it checks to see if the member the user entered to give the gem TO is a valid username
    // in the channel.
    // Third, it checks if the :gem: is typed after the word 'for' meaning the user typed their
    // statement in the wrong order.
    // Fourth, it checks if the user typed in the message is after 'for' meaning the user typed
    // their statement in the wrong order.
    // If none of these condition are met, the user typed a valid gem statment and program execution
    // can proceed. Valid gem statements are as following...
    // :gem: [@username] for [reason] -- this is the suggested statement syntax
    // [@username] :gem: for [reason]
    var isReasonUndefined = (typeof reason === 'undefined');
    var isGemReceiverValid = !(membersInChannel.indexOf(trimmedGemReceiverRaw) > -1);
    var isGemInReason = reason.indexOf(':gem:');
    var isGemReceiverInReason = reason.indexOf(trimmedGemReceiverRaw);

    // For debugging
    console.log('Is reason undefined: ' + isReasonUndefined + '\n' +
                'Is gem receiver valid: ' + isGemReceiverValid + '\n' +
                'Is gem in reason statement: ' + isGemInReason + '\n' +
                'Is gem receiver in reason: ' + isGemReceiverInReason
            );
    if (isReasonUndefined || isGemReceiverValid || isGemInReason || isGemReceiverInReason){
      // User typed an invalid statement, output error message
      bot.reply(message, 'Sorry, ' + gemGiver + '. There was an error in your gem statement...\n' +
        'Please type your gem statement like this:\n' +
        ':gem: [@username] for [reason]'
      );
    } else{
      // User typed a valid statement, we have valid data, proceed with database calls
      bot.reply(message, 'Hello, ' + gemGiver + '! You have typed a gem!\n' +
          'Raw username: ' + trimmedGemReceiverRaw + '\n' +
          'Encoded username: ' + gemReceiver + '\n' +
          'Reason: ' + reason
      );
    }
  });
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
