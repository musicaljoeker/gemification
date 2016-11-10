// Requirements
var express = require('express');
var bodyParser = require('body-parser');
var mysql = require('mysql');

// Database Connection
var db = mysql.createConnection({
  host      : 'galerafloat.mio.uwosh.edu',
  user      : 'kerkhofj',
  password  : 'Oshkosh123!',
  database  : 'Gemification'
});

// Server Definitions
var app = express();
var port = process.env.PORT || 80;

// Body Parser Middleware
app.use(bodyParser.urlencoded({ extended: true }));

// Test Route
app.get('/', function (req, res) { res.status(200).send('Hello world!'); });

app.listen(port, function () {
  console.log('Listening on port ' + port);
});

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

// This is a test funciton to the MySQL database
app.post('/show-tables', function (req, res, next) {
  // Setting up the database connection
  db.connect(function(err){
    if (!err) {
      console.log("Database is connected");
    } else {
      // Throw an error
      console.log("Error in connecting to database: " + err);
    }
  });

  // Test query to the database
  db.query('SHOW TABLES', function(err, rows, fields){
    db.end();
    if (!err) {
      // Do some stuff
      res.status(200).send("These are the tables:\n" + rows);
    } else {
      // Throw an error
      console.log("Error in performing tables query");
    }
  });
});
