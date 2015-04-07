var livedb = require('livedb');
var sharejs = require('share');
var express = require('express');
var exphbs = require('express-handlebars');
var livedbMongo = require('livedb-mongo');

var Duplex = require('stream').Duplex;
var browserChannel = require('browserchannel').server;

var config = require('./server/config.js');

// Express set up
var app = express();
app.use(express.static('public'));

// Handlebars layouts
app.engine('handlebars', exphbs({
	defaultLayout: 'main'
}));
app.set('view engine', 'handlebars');

// LiveDb & Share JS
backend = livedb.client(livedbMongo(config.mongoUrl + '?auto_reconnect', {
	safe: false
}));
var share = require('share').server.createClient({backend: backend});

// Register the Share JS rich-text custom Operational Transformation
var richText = require('rich-text');
livedb.ot.registerType(richText.type);

// Load static share.js file into front end
app.use(express.static(sharejs.scriptsDir));

// Send cursor info via Primus/SockJS
var server = require('http').createServer(app);
var Primus = require('primus');
var cursorWsServer = new Primus(server, {transformer: 'SockJS'});
cursorWsServer.on('connection', function (spark) {
	spark.on('data', function (data) {
		cursorWsServer.write(data);
	});
});


app.use(browserChannel({webserver: express}, function (client) {
	var stream = new Duplex({objectMode: true});
	stream._write = function (chunk, encoding, callback) {
		if (client.state !== 'closed') {
			client.send(chunk);
		}
		callback();
	};

	stream._read = function () {
	};

	stream.headers = client.headers;
	stream.remoteAddress = stream.address;

	client.on('message', function (data) {
		stream.push(data);
	});
	stream.on('error', function (msg) {
		client.stop();
	});
	client.on('close', function (reason) {
		stream.emit('close');
		stream.emit('end');
		stream.end();
	});

	share.listen(stream);
}));


app.get('/', function (req, res) {
	res.render('home');
});

server.listen(9999, function () {
	var host = server.address().address;
	var port = server.address().port;
	console.log('App listening at http://%s:%s', host, port);
});
