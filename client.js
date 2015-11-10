var Readable = require('stream').Readable;
var rels = require('zetta-rels');
var Rx = require('rx');
var zrx = require('zrx');

var ZettaClient = module.exports = function(server) {
  if (!(this instanceof ZettaClient)) {
    return new ZettaClient(server);
  }

  this._subject = server || new Rx.ReplaySubject();
};

ZettaClient.prototype.connect = function(uri) {
  zrx().load(uri).subscribe(this._subject);;
  return this;
};

ZettaClient.prototype.from = function(server) {
  return new Query(server);
};

/*ZettaClient.prototype.where = function(q) {
  var query = new Query();
  query.where(q);
  return query;
};*/

ZettaClient.prototype.observe = function(queries, cb) {
  queries = Array.isArray(queries) ? queries : [queries];

  var servers = {};

  var self = this;
  queries.forEach(function(query) {
    if (!servers.hasOwnProperty(query.server)) {
      var subject = new Rx.ReplaySubject();
      zrx(self._subject).server(query.server).subscribe(subject);
      servers[query.server] = subject;
    }
  });

  var observables = queries.map(function(query) {
    var subject = servers[query.server];
    return zrx(subject).query(query.ql);
  });

  Rx.Observable.zipArray(observables)
    .map(function(devices) {
      return devices.map(function(device) {
        var uri = device.request.raw.uri;
        var subject = new Rx.ReplaySubject();
        var client = zrx();
        client
          .load(uri)
          .map(function(env) {
            device = new Device(env, env.response.body);
            return self._wrapDevice(device);
          })
          .subscribe(subject);

        return subject;
      });
    })
    .flatMap(function(devices) {
      return Rx.Observable.zipArray(devices);
    })
    .subscribe(function(devices) {
      cb.apply(null, devices);
    });
};

ZettaClient.prototype._wrapDevice = function(device) {
  device.available = function(transition) {
    var actions = device._data.actions.filter(function(action) {
      return action.name === transition;
    });

    return actions.length > 0;
  };

  device.call = function() {
    var args = Array.prototype.slice.call(arguments);

    var transition = args.shift();
    var next = args[args.length - 1];
    var rest;
    if (typeof(next) !== 'function') {
      next = function(err) {
        if (err) {
          console.error('Error calling ' + device.type + 
            ' transition ' + transition + ' (' + err + ')');
        }
      }

      rest = args.slice(0, args.length);
    } else {
      rest = args.slice(0, args.length - 1);
    }

    var actions = device._data.actions.filter(function(action) {
      return action.name === transition;
    });

    if (!actions.length) {
      return next(new Error('Transition', transition, 'is unavailable'));
    } else {
      var initial = Rx.Observable.return(device._env);
      zrx(initial).transition(transition, function(a) {
        a._data.fields.filter(function(field) {
          return field.type !== 'hidden';
        }).forEach(function(f, i) {
          if (rest[i]) {
            a.set(f.name, rest[i]);
          }
        });

        return a.submit()
      })
      .subscribe(function(env) {
        next();
      }, function(err) {
        next(err);
      });
    }
  };

  device.createReadStream = function(name) {
    var links = device._data.links.filter(function(link) {
      return link.rel.indexOf(rels.objectStream) > -1
        && link.title === name;
    });

    if (!links.length) {
      return new Readable();
    }

    var link = links[0];

    var readable = new Readable({ objectMode: true });
    var isStarted = false;
    readable._read = function() {
      var self = this;
      if (!isStarted) {
        isStarted = true;
        zrx().load(link.href).client
          .subscribe(function(env) {
            env.response.on('message', function(chunk) {
              self.push(JSON.parse(chunk.toString()));
            });

            env.response.on('error', function(err) {
              self.emit('error', err);
            });

            env.response.on('close', function() {
              self.push(null);
            });
          });
      }
    };

    return readable;
  };

  return device;
};

var Query = function(server) {
  this.server = server;
  this.ql = null;
};

Query.prototype.where = function(q) {
  if (typeof q === 'object') {
    var filters = Object.keys(q).map(function(key) {
      var filter = /\s/.test(key) ? '[' + key + ']' : key;
      filter += '=' + JSON.stringify(q[key]);
      return filter;
    });

    this.ql = 'where ' + filters.join(' and ');
  } else if (typeof q === 'string') {
    this.ql = q;
  }

  return this;
};

var Device = function(env, data) {
  this._env = env;
  this._data = data;

  if (this._data.properties) {
    var self = this;
    Object.keys(this._data.properties).forEach(function(key) {
      self[key] = self._data.properties[key];
    });
  };
};
