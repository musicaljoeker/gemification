// Requirements
var fs = require('fs');
var http = require('http');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var mysql = require('mysql');

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

// Body Parser Middleware
app.use(bodyParser.urlencoded({ extended: true }));

// Test Route
app.get('/', function (req, res) { res.status(200).send('Hello world!'); });

// Server Listners
server.listen(port, function(){
  console.log('Listening on port ' + port);
});
// app.listen(port, function () {
//   console.log('Listening on port ' + port);
// });

// Gemification Posts
app.post('/gem', function (req, res, next) {
  var userFrom = req.body.user_name;
  var text = req.body.text;
  var botResponse = {
    text : "This is your username " + userFrom + "\nThis is what you entered after your username: " + text
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
app.get('/show-tables', function(req, res){
  handle_database(req, res);
});
