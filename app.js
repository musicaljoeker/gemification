// Requirements
var fs = require('fs');
var http = require('http');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var mysql = require('mysql');
var botkit = require('botkit');

// SSL Certificate Configuration
var httpsOptions = {
  key   :  fs.readFileSync('ssl/StarMIO.key', 'utf8'),
  cert  :  fs.readFileSync('ssl/StarMIO-cert.pem', 'utf8'),
  ca    :  fs.readFileSync('ssl/StarMIO-chain.pem', 'utf8')
}

// Server Definitions
var app = express();
var port = process.env.PORT || 443;
var server = https.createServer(httpsOptions, app);

// Database Configuration
var pool = mysql.createPool({
    connectionLimit : 100, //important
    host      : 'galerafloat.mio.uwosh.edu',
    user      : 'gemification',
    password  : 'car owner drivers seat',
    database  : 'Gemification',
    debug     :  false
});

// Gemification Slackbot Configuration
var controller = botkit.slackbot();
var bot = controller.spawn({
  token: a3f0961b70c2ebec94c83b7f507de574
})
bot.startRTM(function(err,bot,payload) {
  if (err) {
    throw new Error('Could not connect to Slack');
  }

  // close the RTM for the sake of it in 5 seconds
  setTimeout(function() {
      bot.closeRTM();
  }, 5000);
});

// Body Parser Middleware
app.use(bodyParser.urlencoded({ extended: true }));

// Gemification Posts
app.post('/gem', function (req, res, next) {
  var userFrom = req.body.user_name;
  var text = req.body.text;
  var botResponse = {
    text : "This is your username " + userFrom + "\nThis is what you entered after your /gem command: " + text
  };

  // Loop otherwise..
  if (userFrom !== 'slackbot') {
    return res.status(200).json(botResponse);
  } else {
    return res.status(200).end();
  }
});

// This is a test pool connection function to the MySQL database
function handle_database(req,res) {
    pool.getConnection(function(err,connection){
      if (err) {
        res.json({"code" : 100, "status" : "Error in connection database"});
        return;
      }
      console.log('connected as id ' + connection.threadId);
      connection.query("SHOW TABLES",function(err,rows){
        connection.release();
        if(!err) {
          res.json(rows);
        }
      });
      connection.on('error', function(err) {
        res.json({"code" : 100, "status" : "Error in connection database"});
        return;
      });
  });
}

// Handling the GET request
app.post('/show-tables', function(req, res){
  handle_database(req, res);
});

// Server Listner
server.listen(port, function(){
  console.log('Listening on port ' + port);
});
