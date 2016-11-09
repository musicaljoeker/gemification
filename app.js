var express = require('express');
var bodyParser = require('body-parser');

var app = express();
var port = process.env.PORT || 1337;

// body parser middleware
app.use(bodyParser.urlencoded({ extended: true }));

// test route
app.get('/', function (req, res) { res.status(200).send('Hello world!'); });

app.listen(port, function () {
  console.log('Listening on the port ' + port);
});

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
