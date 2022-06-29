#! /usr/bin/env node

var quere = require('queue-async');
var express = require('express');
var bodyParser = require('body-parser');
var task = require('queue-async')();
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');
var app = express();
app.use(bodyParser.json());

var config, listener;

var _reload_config = function(){
	if (typeof config !== 'undefined'){
		var pwd = path.resolve() + 'config.js';
		delete require.cache[pwd];
	}
	config = require('./config.json');
	listener = {};
	for (var itemid  in config.items){
		var item = config.items[itemid];
		for (var resid in item){
			var res = item[resid];
			var name = res.name,
				branch = res.branch,
				secret = res.secret,
				keyword = res.keyword,
				customCommitActions = res.customCommitActions,
				actions = res.actions;

			if (typeof listener[name] === 'undefined'){
				listener[name] = {};
			}
			listener[name]['secret'] = secret;
			listener[name]['keyword'] = keyword;
			listener[name]['customCommitActions'] = customCommitActions;
			for (var actionType in res.actions){
				var action = res.actions[actionType];
				var arrTask = config.scripts[res.actions[actionType]];
				if (typeof arrTask === 'undefined'){
					console.log('WARNING: task [' + res.actions[actionType] + '] in ' +
							name + 'not found');
					continue;
				}
				if (typeof listener[name][actionType] === 'undefined'){
					listener[name][actionType] = {};
				} 
				if (typeof listener[name][actionType][branch] === 'undefined'){
					listener[name][actionType][branch] = [];
				} 
				for (var i in arrTask){
					listener[name][actionType][branch].push(arrTask[i]);
				}
			}
		}
	}
};

_reload_config();

var port = config.port;
app.listen(port);
console.log('Listening on port ' + port);

var _runCMDcb = function(error, stdout, stderr){
	if (error){
		console.log(error.toString());
		return false;
	}else{
		console.log(stdout);
		return true;
	}
};

app.post('*', function(req, res){
		res.send(202);
		task.defer(function(req, res){
			    var signature = req.headers["x-hub-signature-256"];
				var eType = req.headers["x-github-event"];
				var body = req.body;
                var name = body.repository.name;

				console.log('INFO: Request accepted, repo name: ' + name + ' signature: ' + signature);
				// check conf
				if((!listener[name]) || (!listener[name]['secret'])) {
					console.log('ERROR: There is no configuration for this repo: ' + name);
					return;
				}
				// check signature
				var ok = verifySignature(signature, body, listener[name]['secret']);
				if(!ok) {
					console.log('ERROR: The request is illegal, repo name: ' + name);
					return;
				}

				// check custom commit actions
				if(listener[name]['customCommitActions'] && listener[name]['customCommitActions'].length !== 0) {
					console.log("INFO: start execute custom commit actions");
					const cations = listener[name]['customCommitActions'];
					for(let i=0; i<cations.length; i++) {
						const key = cations[i]['keyword'];
						const script = cations[i]['script'];
						if(containsKeyword(body.commits, key)) {
							console.log("INFO: custom commit action match: " + key);
							const dir = path.dirname(path.resolve(script));
						    cp.execFile(script,[dir, name, branch, body.after],{}, _runCMDcb);
						}
					}
				}

				// check keyword
				if(listener[name]['keyword'] && listener[name]['keyword'] !== '') {
					console.log("INFO: start check keyword conf");
					const keyword = listener[name]['keyword'];
					const keyOk = containsKeyword(body.commits, keyword);
					if(!keyOk) {
						console.log('INFO: No matching keyword found in commits, do not trigger task. keyword: ' + keyword);
						return;
					}
				}

				var branch = body.ref.split('/')[2];
				
				var actions = (listener[name] && listener[name][eType] && listener[name][eType][branch]);
				if (typeof actions === 'undefined'){
					console.log('INFO: ' + name + ':' + branch + ' got a ' + eType + ' trigger but no action fount.');
					return;
				}
				for (var i in actions){
						console.log('INFO: ' + name + ':' + branch + ' triggered script ' + actions[i]);
						var dirname = path.dirname(path.resolve(actions[i]));
						cp.execFile(actions[i],[dirname, name, branch, body.after],{}, _runCMDcb);
				}
			}, req, res).await();
		});

var verifySignature =  function(signature, body, secret) {
	signature = signature.replace(/^sha256=/, '');
	const bodyStr = JSON.stringify(body);
	const digest = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
	if(digest !== signature) {
		return false;
	}

	console.log('verify signature success');
	return true;
}

var containsKeyword = function(commits, keyword) {
	const lowerKeyword = keyword.toLowerCase();
	
	for(let i=0; i<commits.length; i++) {
		const lowerStr = commits[i].message.toLowerCase();
		console.log("lowerMessage: " + lowerStr);
		if(lowerStr.includes(lowerKeyword)) {
			console.log("match keyword: " + lowerKeyword);
			return true;
		}
	}

	return false;
}
