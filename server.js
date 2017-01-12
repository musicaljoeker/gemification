var express = require('express');
var http = require('http');
var https = require('https');
var fs = require('fs');
var app = express();
var httpPort = 80;
var httpsPort = 443;
var httpsCredentials = {
  key: fs.readFileSync('./ssl/StarMIO.key', 'utf8'),
  cert: fs.readFileSync('./ssl/StarMIO-cert.pem', 'utf8'),
  ca: fs.readFileSync('./ssl/StarMIO-chain.pem', 'utf8')
};

var httpServer = http.createServer(app);
var httpsServer = https.createServer(httpsCredentials, app);

app.listen(httpPort, function(){
  console.log('HTTP server running on port ' +  httpPort);
});

app.listen(httpsPort, function(){
  console.log('HTTPS server running on port ' +  httpsPort);
});

app.get('/', function(req, res){
  res.header('Content-type', 'text/html');
  return res.end('<h1>Hello, Secure World!</h1>');
});
