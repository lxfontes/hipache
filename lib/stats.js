'use strict';

/*
 * This module handles all IO called on the cache (currently Redis)
 */

var url = require('url'),
    redis = require('redis'),
    async = require('async'),
    lruCache = require('lru-cache');

function Stats(config) {
    if (!(this instanceof Stats)) {
        return new Stats(config);
    }

    this.config = config;
    this._queue = {};
    //update stats back to redis every sec
    this.timer = setInterval(this.updateStats.bind(this), 1000);

    this.redisClient = redis.createClient(
            this.config.redisPort,
            this.config.redisHost
            );
            
    if (this.config.redisDatabase) {
        this.redisClient.select(this.config.redisDatabase);
    }       
    
    if (this.config.redisPassword) {
        this.redisClient.auth(this.config.redisPassword);
    }             
};

Stats.prototype.updateStats = function() {
    var self = this;
    //we will work on this, so no more increments during that time
    var queue = this._queue;
    this._queue = {};

    var r = self.redisClient;

    async.each(Object.keys(queue), function(sid) {
        //only increment stats per backend per id
        //format in redis
        //stats:frontend:bkid = {2xx: i 3xx: i, 4xx: i, 5xx: i}
        var stat = queue[sid];
        var masterKey = "stats:" + stat.frontend + ":" + stat.backendId; 

        var multi = self.redisClient.multi();
        multi.hincrby(masterKey, "2xx", stat['2xx']);
        multi.hincrby(masterKey, "3xx", stat['3xx']);
        multi.hincrby(masterKey, "4xx", stat['4xx']);
        multi.hincrby(masterKey, "5xx", stat['5xx']);
        multi.hincrby(masterKey, "refused", stat['refused']);
        multi.hincrby(masterKey, "error", stat['error']);
        multi.exec();
    }, function(err) {
        if (err) {
            console.log("Saving stats " + err);
        }
    });
};

Stats.prototype.countTransaction = function(req, res) {
    if (!res.internal) {
        var timeSpent = res.timer.end - res.timer.start;
        var backendSpent = res.timer.end - res.timer.startBackend;
    }
    var status = res.statusCode;
    var backendId = req.meta.backendId;
    var frontend = req.meta.frontend;

//    console.log("Spent " + timeSpent + " backend " + backendSpent + " status " + status + " id " + backendId + " frontend " + frontend);
    var k = frontend + ":" + backendId;
    if (!(k in this._queue)) {
        this._queue[k] = {
            'frontend': frontend,
            'backendId': backendId,
            'refused': 0,
            'error': 0,
            '2xx': 0,
            '3xx': 0,
            '4xx': 0,
            '5xx': 0
        };
    }

    if (res.internal) {
        this._queue[k][res.internal] += 1;
    }else if (200 <= status < 300) {
        this._queue[k]['2xx'] += 1;
    }else if(300 <= status < 400) {
        this._queue[k]['3xx'] += 1;
    }else if(400 <= status < 500) {
        this._queue[k]['4xx'] += 1;
    }else if(500 <= status < 600) {
        this._queue[k]['5xx'] += 1;
    }

};
module.exports = Stats;
