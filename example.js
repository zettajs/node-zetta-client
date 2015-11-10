var zetta = require('./client');

var server = zetta().connect('http://45.55.169.202:3000/');

var microphoneQuery = server
  .from('bork')
  .where({ type: 'microphone' });

var displayQuery = server
  .from('bork')
  .where({ type: 'display' });

server.observe([microphoneQuery, displayQuery], function(microphone, display) {
  var stream = microphone.createReadStream('volume');
  stream.on('data', function(msg) {
    if (msg.data > 0.5) {
      if (display.available('change')) {
        var line = 'value: ' + msg.data;
        display.call('change', line, function(err) {
          if (err) {
            console.error(err);
          } else {
            console.log('changing display to ' + line);
          }
        });
      }
    }
  });
});
