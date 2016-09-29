/*
 * grunt-autoshot
 * https://github.com//grunt-autoshot
 *
 * Copyright (c) 2013 Ferrari Lee
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function (grunt) {
    var phantom = require('node-phantom-simple');
    var st = require('st');
    var http = require('http');
    var async = require('async');

    process.setMaxListeners(0);
    grunt.registerMultiTask('autoshot', 'Create a quick screenshot for your site which could help for document or testing.', function () {
        var done = this.async();
        var options = this.options({
            remote: false,//don't fill in any defaultsc
            local: false,
            phantomParams: {},
            verbose: false
        });

        var phantomOptions = {
            path: require('phantomjs-prebuilt').path,
            parameters: options.phantomParams || {}
        };

        var renderOptions = options.renderOptions || {
                quality: 100
            };

        console.log('phantomOptions = ', phantomOptions);

        // Core screenshot function using phamtonJS
        var screenshot = function (opts, cb) {
            var viewport = opts.viewport;
            var type = opts.type;
            var path = opts.path;
            var src = opts.src;
            var dest = opts.dest;
            var delay = opts.delay;
            var timerId;
            var target;

            phantom.create(phantomOptions, function (err, ph) {
                if (err) {
                    grunt.fail.warn((err && err.message) || err);
                    return;
                }
                return ph.createPage(function (err, page) {
                    if (viewport) {
                        var sets = viewport.match(/(\d+)x(\d+)/);
                        if (sets[1] && sets[2]) {
                            //console.log("Restricting to resolution: " + sets[1] + 'x' + sets[2]);
                            page.set('viewportSize', {
                                width: sets[1],
                                height: sets[2]
                            });
                        }
                    }

                    function delayedScreenshot(){
                        page.render(path + '/' + target, renderOptions, function () {
                            grunt.log.writeln('Delay ' + delay + ' to take a screenshot to ' + target);
                            ph.exit();
                            cb();
                        });
                    }

                    page.set('zoomFactor', 1);

                    page.onConsoleMessage = function (msg) {
                        if (options.verbose) {
                            grunt.log.writeln('CONSOLE: ' + msg);
                        }

                        //no need to wait for delay, it was bypassed by "autoshot-ready" appearing
                        if(msg && msg.indexOf && msg.indexOf('autoshot-ready') !== -1) {
                            clearTimeout(timerId);
                            timerId = 0;

                            grunt.log.writeln('CONSOLE: <AUTOSHOT TRIGGERED BY console.log("autoshot-ready")>');

                            delayedScreenshot();
                        }
                    };

                    return page.open(src, function (err, status) {
                        target = type + '-' + viewport + '-' + dest;

                        // Background problem under self-host server
                        page.evaluate(function () {
                            var style = document.createElement('style');
                            var text = document.createTextNode('body { background: #fff }');
                            style.setAttribute('type', 'text/css');
                            style.appendChild(text);
                            document.head.insertBefore(style, document.head.firstChild);
                        });


                        if (delay) {
                            timerId = setTimeout(delayedScreenshot.bind(this, target), delay);
                        } else {
                            page.render(path + '/' + target, function () {
                                grunt.log.writeln('Take a screenshot to ' + target);
                                ph.exit();
                                cb();
                            });
                        }
                    });
                });
            });
        };

        // At least local or remote url should be assigned
        if (!options.remote && !options.local) {
            grunt.fail.fatal('At least need one either remote or local url');
        }

        var hasRemote = false;
        if (options.remote) {
            hasRemote = true;
            async.eachSeries(options.remote.files, function (file, outerCb) {
                async.eachSeries(options.viewport, function (view, cb) {
                    screenshot({
                        path: options.path,
                        type: "remote",
                        viewport: view,
                        src: file.src,
                        dest: file.dest,
                        delay: file.delay
                    }, function () {
                        cb();
                    });
                }, function () {
                    outerCb();
                });
            }, function () {
                grunt.event.emit('finish', 'remote');
            });
        }

        var hasLocal = false;
        if (options.local) {
            hasLocal = true;
            async.eachSeries(options.local.files, function (file, outerCb) {
                var mount = st({path: options.local.path, index: file.src});
                var server = http.createServer(function (req, res) {
                    mount(req, res);
                }).listen(options.local.port, function () {
                    async.eachSeries(options.viewport, function (view, cb) {
                        screenshot({
                            path: options.path,
                            type: 'local',
                            viewport: view,
                            src: 'http://localhost:' + options.local.port + '/' + file.src,
                            dest: file.dest,
                            delay: file.delay
                        }, function () {
                            cb();
                        });
                    }, function () {
                        server.close();
                        outerCb();
                    });
                });
            }, function () {
                grunt.event.emit('finish', 'local');
            });
        }

        // Listen event to decide when can stop the task
        grunt.event.on('finish', function (eventType) {
            if (eventType === 'remote') {
                hasRemote = false;
            }
            if (eventType === 'local') {
                hasLocal = false;
            }
            if (!hasRemote && !hasLocal) {
                done();
            }
        });
    });
};
