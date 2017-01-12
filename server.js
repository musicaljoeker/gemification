var fs = require('fs'),
https = require('https'),
express = require('express'),
app = express();

https.createServer({
  key: fs.readFileSync('./ssl/StarMIO.key', 'utf8'),
  cert: fs.readFileSync('./ssl/StarMIO-cert.pem', 'utf8'),
  ca: fs.readFileSync('./ssl/StarMIO-chain.pem', 'utf8')
}, app).listen(443);

app.get('/', function(req, res){
  res.header('Content-type', 'text/html');
  return res.end('<h1>Hello, Secure World!</h1>');
});
