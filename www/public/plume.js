var socket = new BCSocket(null, {reconnect: true});
var sjs = new sharejs.Connection(socket);
sharejs.registerType(window.ottypes['rich-text']);

var doc = sjs.get('docs', 'hello2');

// Subscribe to changes
doc.subscribe();

// This will be called when we have a live copy of the server's data.
doc.whenReady(function () {

	var userId = 'id-' + Math.random(10) * 1000;

	console.log('doc ready, data: ', doc);


	// Create a rich-text doc
	if (!doc.type) {
		console.log('doc has not type - trying to create a rich-text doc');
		doc.create('rich-text', '');
		console.log('created as ', doc);
	}

	var editor = new Quill('#editor', {
		modules: {
			'toolbar'     : {container: '#toolbar'},
			'authorship'  : {authorId: userId, enabled: true, color:  'rgb(255, 0, 255)', button: $('#authors')[0]},
			'link-tooltip': true
		},
		theme  : 'snow'
	});

	//editor.modules.authorship.attachButton($('#authors'));
	console.log(editor);
	var multiCursor = editor.addModule('multi-cursor', {
		timeout: 10000
	});

	// Update the doc with the recent changes
	editor.updateContents(doc.getSnapshot());

	// Cursor handling managed by Primus which is a socket wrapper
	var primus = Primus.connect('', {});

	primus.on('open', function open() {
		console.log('Connection is alive and kicking');
	});

	primus.on('data', function message(data) {
		var cursor =  data.cursor;
		multiCursor.removeCursor(cursor.id);
		multiCursor.setCursor(cursor.id, cursor.start, cursor.name, cursor.colour);
		console.log('Received a new message from the server: ', data.cursor);
	});

	primus.on('error', function error(err) {
		console.error('Something horrible has happened', err.stack);
	});

	//************ end ***************//

	editor.on('selection-change', function (range) {
		var c = hexToRgb($('#cursor-colour').val());
		var colour = 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
		var cursor = {'start': range.start,
			'end': range.end,
			'colour': colour,
			'name': $('#name').val(),
			'id': userId
		}

		primus.write({'cursor': cursor});
	});

	editor.on('text-change', function (delta, source) {
		console.log('text-change', delta, source)
		doc.submitOp(delta);
	});

	doc.on('op', function (op, localContext) {
		if (!localContext) {
			editor.updateContents(op.ops);
		}
	})
});

function hexToRgb(hex) {
	var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}