
/**
 * Module dependencies.
 */

var debug = require('debug')('duo-test:saucelabs');
var Emitter = require('events').EventEmitter;
var Remote = require('./browsers/remote');
var wdparse = require('wd-browser');
var thunkify = require('thunkify');
var fmt = require('util').format;
var join = require('path').join;
var assert = require('assert');
var _ = require('koa-route');
var fs = require('fs');
var wd = require('wd');

/**
 * window.saucelabs(mocha.run())
 */

var js = fs.readFileSync(join(__dirname, '..', 'client', 'build.js'));

/**
 * Expose `Saucelabs`.
 */

module.exports = Saucelabs;

/**
 * Initialize `Saucelabs`.
 *
 * @param {App} app
 * @param {String} user
 * @param {String} key
 * @api public
 */

function Saucelabs(app, user, key){
  if (!(this instanceof Saucelabs)) return new Saucelabs(app, user, key);
  Emitter.call(this);
  assert(user, '"user" required');
  assert(key, '"key" required');
  assert(app, '"app" required');
  this.clients = {};
  this.browsers = [];
  this.user = user;
  this.key = key;
  this.app = app;
}

/**
 * Inherit `Emitter`
 */

Saucelabs.prototype.__proto__ = Emitter.prototype;

/**
 * Add `browser`.
 *
 * @param {String} name
 * @api public
 */

Saucelabs.prototype.add = function(name){
  debug('add %s', name);
  var all = wdparse(name).map(Remote);
  this.browsers = this.browsers.concat(all);
  return this;
};

/**
 * Send the client side script.
 *
 * @return {Generator}
 * @api public
 */

Saucelabs.prototype.script = function(){
  return function*(){
    debug('sent saucelabs.js');
    this.type = 'js';
    this.body = js;
  };
};

/**
 * Receive mocha events.
 *
 * @return {Generator}
 * @api public
 */

Saucelabs.prototype.receive = function(){
  var self = this;
  return function*(){
    debug('got %j', this.query);
    var data = decodeURIComponent(this.query.data);
    debug('data=%s', data);
    var id = this.query.id;
    var client = self.clients[id];
    var json = JSON.parse(data);

    // edge-case
    if (!client) throw new Error('client "' + id + '" was not found');

    // HACK
    if (json.obj) {
      json.obj.slow = function(){ return this._slow; };
      json.obj.fullTitle = function(){ return this._fullTitle; };
    }

    // runner
    var runner = client.runner;

    // HACK
    if (!runner.emittedStart) {
      debug('emit start');
      runner.emittedStart = true;
      runner.emit('start');
    }

    debug('emit %s', json.event);
    runner.emit(json.event, json.obj, (json.obj || {}).err);
    var fn = this.query.callback;
    var js = fmt('(this.%s && %s());', fn, fn);
    debug('sent js %s', js);
    this.type = 'js';
    this.body = js;
  };
};

/**
 * Run the test on all browsers.
 *
 * @param {String} title
 * @api public
 */

Saucelabs.prototype.run = function*(title){
  var name = name || 'test';
  var test = this.test.bind(this);
  var app = this.app;

  // test title
  this.title = title;

  // routes.
  app.use(_.get('/saucelabs.js', this.script()));
  app.use(_.get('/saucelabs', this.receive()));

  // start the app.
  yield app.listen();
  yield app.expose();

  // test all browsers.
  yield this.browsers.map(test);

  // destroy the app.
  app.destroy();
};

/**
 * Register `browser`.
 *
 * @param {Browser} browser
 * @return {Saucelabs}
 * @api private
 */

Saucelabs.prototype.register = function(browser){
  assert(!this.clients[browser.id], 'browser "' + browser.id + '" already registered');
  this.clients[browser.id] = browser;
  this.emit('browser', browser);
  return this;
};

/**
 * Debug.
 *
 * Creates a fake `browser` and
 * returns a local url to debug
 * sauceclient locally.
 *
 * @return {String}
 * @api private
 */

Saucelabs.prototype.debug = function*(){
  var app = this.app;
  app.use(_.get('/saucelabs.js', this.script()));
  app.use(_.get('/saucelabs', this.receive()));
  yield app.listen(3000);
  var browser = {};
  browser.id = 'debug';
  browser.runner = new Emitter;
  browser.toString = Function('return "debug"');
  this.register(browser);
  return this.url(browser);
};

/**
 * Test a single browser.
 *
 * @param {Browser} browser
 * @api private
 */

Saucelabs.prototype.test = function(browser){
  var self = this;

  return function*(){
    self.register(browser);
    var url = self.url(browser);
    yield browser.connect(self.title, self.user, self.key);

    try {
      yield [browser.get(url), quit];
    } catch (e) {
      if (!e.timeout) throw e;
      yield browser.quit.bind(browser);
      throw new Error(fmt('%s: timed out'
        + ' make sure the tests pass locally'
        + ' and saucelabs(mocha.run()) is called'
        , browser));
    }
  };

  function quit(done){
    browser.runner.once('end', function(){
      browser.quit(done);
    });
  }
};

/**
 * Get url of `browser`.
 *
 * @param {Browser} browser
 * @return {String}
 * @api private
 */

Saucelabs.prototype.url = function(browser){
  var url = this.app.url();
  url += ~url.indexOf('?') ? '&' : '?';
  return url + '__id__=' + browser.id;
};