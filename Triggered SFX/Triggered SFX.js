var bshields = bshields || {};
bshields.sfx = (function() {
    'use strict';
    
    var version = 0.1,
        commands = {
            deletetriggersfx: function(args, msg) {
                var trigger = args[0] ? args[0].toLowerCase().replace('-', ':') : '',
                    triggerData = state.bshields.sfx.triggers[trigger],
                    who = getObj('player', msg.playerid).get('displayname');
                
                if (args.length === 0) {
                    sendError(msg.playerid, 'Specify a trigger event to delete from, and optionally a specific code piece to delete.');
                    return;
                }
                if (!triggerData) {
                    sendError(msg.playerid, 'Can\'t find data for trigger "' + trigger + '"');
                    return;
                }
                if (args[1] && (parseInt(args[1]) < 0 || parseInt(args[1]) >= triggerData.length)) {
                    sendError(msg.playerid, 'Code index ' + args[1] + ' out of range for trigger "' + trigger + '".');
                    return;
                }
                
                if (args[1]) {
                    state.bshields.sfx.triggers[trigger].splice(parseInt(args[1]), 1);
                    if (state.bshields.sfx.triggers[trigger].length === 0) {
                        delete state.bshields.sfx.triggers[trigger];
                    }
                } else {
                    delete state.bshields.sfx.triggers[trigger];
                }
                sendChat('System', '/w "' + who + '" You have deleted a scripted trigger, however its effects will remain until the API sandbox restarts.');
                commands.listtriggerssfx([], msg);
            },
            reviewtriggersfx: function(args, msg) {
                var trigger = args[0] ? args[0].toLowerCase().replace('-', ':') : '',
                    triggerData = state.bshields.sfx.triggers[trigger],
                    who = getObj('player', msg.playerid).get('displayname'),
                    message = '/w "' + who + '" ',
                    code;
                
                if (args.length != 2) {
                    sendError(msg.playerid, 'Trigger event and code index required to review full code source.');
                    return;
                }
                if (!triggerData) {
                    sendError(msg.playerid, 'Can\'t find data for trigger "' + trigger + '"');
                    return;
                }
                if (parseInt(args[1]) < 0 || parseInt(args[1]) >= triggerData.length) {
                    sendError(msg.playerid, 'Code index ' + args[1] + ' out of range for trigger "' + trigger + '".');
                    return;
                }
                
                code = triggerData[parseInt(args[1])];
                code = code.replace('->','&#9658;');
                code = code.replace(/('|").*?\1|[+*/=!<>\-]|\b(obj|prev|msg)\b/g, function($0, $1) {
                    if ($1 === '"' || $1 === '\'') {
                        return '<span style="color:#008">' + $0 + '</span>';
                    } else if ($0 === 'obj' || $0 === 'prev' || $0 === 'msg') {
                        return '<strong style="color:#080">' + $0 + '</strong>';
                    } else {
                        return '<strong style="color:#800">' + $0 + '</strong>';
                    }
                });
                
                message += '<br>' + code;
                sendChat('System', message);
            },
            listtriggerssfx: function(args, msg) {
                var who = getObj('player', msg.playerid).get('displayname'),
                    message = '/w "' + who + '" ';
                
                _.chain(state.bshields.sfx.triggers)
                 .map(function(functions, trigger) { return { trigger: trigger, functions: functions }; })
                 .sortBy(function(data) { return data.trigger; })
                 .each(function(data) {
                    var trigger = data.trigger.replace(':', '-');
                    
                    if (data.functions.length === 0) {
                        delete state.bshields.sfx.triggers[data.trigger];
                        return;
                    }
                    
                    message += '<br><strong style="display:inline-block;margin-top:5px;width:69.96%;text-align:center;height:29px;overflow:hidden">'
                        + data.trigger + '</strong>' + '<a href="!deletetriggersfx ' + trigger + '" style="float:right">DEL All</a>';
                    _.each(data.functions, function(code, index) {
                        var body = code.substring(code.indexOf('-> ') + 3);
                        
                        message += '<br><a href="!reviewtriggersfx ' + trigger + ' ' + index
                            + '" style="margin:0;padding:0;border:0;background:transparent;color:teal;text-decoration:underline;'
                            + 'display:inline-block;width:79.8%;overflow:hidden;height:29px">' + body + '</span>'
                            + '<a href="!deletetriggersfx ' + trigger + ' ' + index + '" style="float:right">DEL</a>';
                    });
                 });
                
                if (_.size(state.bshields.sfx.triggers) === 0) {
                    message += '**No triggers registered.**';
                }
                sendChat('System', message);
            },
            triggersfx: function(args, msg) {
                var bareArgs = _.rest(msg.content.split(' ')),
                    func = _.rest(bareArgs).join(' '),
                    eventParts;
                
                if (bareArgs.length <= 1) {
                    sendError(msg.playerid, 'You must supply a trigger event and event code.');
                    return;
                }
                
                if (!_.has(state.bshields.sfx.triggers, bareArgs[0].toLowerCase())) {
                    state.bshields.sfx.triggers[bareArgs[0].toLowerCase()] = [];
                }
                
                if (bareArgs[0].toLowerCase() === 'ready') {
                    func = '-> ' + func;
                } else if (bareArgs[0].toLowerCase() === 'chat:message') {
                    func = 'msg -> ' + func;
                } else {
                    eventParts = bareArgs[0].toLowerCase().split(':');
                    if (eventParts < 2 || (eventParts[0] !== 'add' && eventParts[0] !== 'change' && eventParts[0] !== 'destroy')) {
                        sendError(msg.playerid, 'Event triggers should be "ready", "chat:message", "add:*object-type*[:*property*]", '
                            + '"change:*object-type*[:*property*]", or "destroy:*object-type*[:*property*]".');
                        return;
                    }
                    
                    func = 'obj prev -> ' + func;
                }
                state.bshields.sfx.triggers[bareArgs[0].toLowerCase()].push(func.replace(/\bplay\(/, 'this.play('));
                on(bareArgs[0].toLowerCase(), wrapLambda(_.last(state.bshields.sfx.triggers[bareArgs[0].toLowerCase()]).lambda()));
            },
            deletesfx: function(args, msg) {
                var alias;
                
                if (args.length === 0) {
                    sendError(msg.playerid, 'Please supply an alias to review.');
                    return;
                }
                
                alias = (args[0] === '[null]' && !_.has(state.bshields.sfx.aliases, '[null]') ? '' : args[0]);
                if (!_.has(state.bshields.sfx.aliases, alias)) {
                    sendError(msg.playerid, 'Alias "' + alias + '" not found. Please check the name and try again.');
                    return;
                }
                delete state.bshields.sfx.aliases[alias];
                commands.listsfx([], msg);
            },
            reviewsfx: function(args, msg) {
                if (args.length === 0) {
                    sendError(msg.playerid, 'Please supply an alias to review.');
                    return;
                }
                if (!_.has(state.bshields.sfx.aliases, args[0])) {
                    sendError(msg.playerid, 'Alias "' + args[0] + '" not found. Please check the name and try again.');
                    return;
                }
                sendAlias(msg.playerid, args[0], state.bshields.sfx.aliases[args[0]]);
            },
            listsfx: function(args, msg) {
                var who = getObj('player', msg.playerid).get('displayname'),
                    message = '/w "' + who + '" ';
                
                _.chain(state.bshields.sfx.aliases)
                 .map(function(data, alias) {
                    var result = _.extend({ alias: alias }, data);
                    
                    if (alias.length === 0) result.alias = '<em>[null]</em>';
                    return result;
                 })
                 .sortBy(function(data) { return data.alias; })
                 .each(function(data) {
                    message += '<br><a href="!reviewsfx ' + data.alias + '" style="width:70%">' + data.alias + '</a>'
                        + '<a href="!deletesfx ' + data.alias + '" style="float:right">DEL</a>';
                 });
                 
                 if (_.size(state.bshields.sfx.aliases) === 0) {
                    message += '**No aliases registered.**';
                 }
                 sendChat('System', message);
            },
            aliassfx: function(args, msg) {
                var aliasName, playlistName, trackName, playInorder, i, potentials, id,
                    playRandom = _.contains(args, '-random'),
                    playAll = _.contains(args, '-all'),
                    playTime = 1,
                    timeOptionIdx = _.indexOf(args, '-time'),
                    playlistNameStart = _.indexOf(args, '-playlist'),
                    trackNameStart = _.indexOf(args, '-track');
                
                // playAll will play all tracks in the playlist at once if a playlist is supplied
                // playRandom will play a random track from the playlist each time
                // playInorder will play each track in order each time
                playRandom = playRandom && !playAll;
                playInorder = !playRandom && !playAll;
                
                // Time defaults to 1s
                if (timeOptionIdx > 0 && args.length > timeOptionIdx + 1) {
                    playTime = parseInt(args[timeOptionIdx + 1]);
                }
                
                // Parse the name of the playlist/track
                if (trackNameStart > 0 && args.length > trackNameStart + 1) {
                    for (i = trackNameStart + 1; i < args.length; i++) {
                        if (args[i].indexOf('-') === 0) break;
                    }
                    trackName = args.slice(trackNameStart + 1, i).join(' ');
                } else if (playlistNameStart > 0 && args.length > playlistNameStart + 1) {
                    for (i = playlistNameStart + 1; i < args.length; i++) {
                        if (args[i].indexOf('-') === 0) break;
                    }
                    playlistName = args.slice(playlistNameStart + 1, i).join(' ');
                } else {
                    sendError(msg.playerid, 'You must supply either a playlist name or a track name.');
                    return;
                }
                
                // Parse the name of the alias; spaces in the alias will be replaced with hyphens
                aliasName = args.slice(0, Math.max(trackNameStart, playlistNameStart)).join(' ').toLowerCase().replace(' ', '-');
                if (_.has(state.bshields.sfx.aliases, aliasName)) {
                    sendError(msg.playerid, 'Alias "' + aliasName + '" is already registered. You must delete the alias before assigning it a different value.');
                    return;
                }
                
                // Find the full name of the track/playlist
                if (trackName) {
                    potentials = filterObjs(function(obj) {
                        if (obj.get('type') !== 'jukeboxtrack') return false;
                        return obj.get('title').toLowerCase().indexOf(trackName) >= 0;
                    });
                    if (potentials.length > 1) {
                        sendError(msg.playerid, 'Multiple tracks matching "' + trackName + '" found. Please be more specific.');
                        return;
                    }
                    if (potentials.length === 0) {
                        sendError(msg.playerid, 'No tracks matching "' + trackName + '" found. Please check the name and try again.');
                        return;
                    }
                    trackName = potentials[0].get('title');
                    id = potentials[0].id;
                }
                if (playlistName) {
                    potentials = _.filter(JSON.parse(Campaign().get('jukeboxfolder')), function(folder) {
                        if (!_.isObject(folder)) return false;
                        return folder.n.toLowerCase().indexOf(playlistName) >= 0;
                    });
                    if (potentials.length > 1) {
                        sendError(msg.playerid, 'Multiple playlists matching "' + playlistName + '" found. Please be more specific.');
                        return;
                    }
                    if (potentials.length === 0) {
                        sendError(msg.playerid, 'No playlists matching "' + playlistName + '" found. Please check the name and try again.');
                        return;
                    }
                    playlistName = potentials[0].n;
                    id = potentials[0].id;
                }
                
                state.bshields.sfx.aliases[aliasName] = {
                    playlistName: playlistName,
                    trackName: trackName,
                    playRandom: playRandom,
                    playAll: playAll,
                    playInorder: playInorder,
                    duration: playTime,
                    nextIdx: 0,
                    id: id
                };
                sendAlias(msg.playerid, aliasName, state.bshields.sfx.aliases[aliasName]);
            },
            help: function(command, args, msg) {
                if (_.isFunction(commands['help_' + command])) {
                    commands['help_' + command](args, msg);
                }
            }
        };
    
    function play(alias) {
        var data = state.bshields.sfx.aliases[alias],
            track, playlist;
        
        if (!data) {
            sendChat('System', '/w gm Tried to play "' + alias + '", but alias does not exist.');
            return;
        }
        
        if (data.trackName) {
            track = getObj('jukeboxtrack', data.id);
            if (!track) {
                sendChat('System', '/w gm Tried to play "' + data.trackName + '", but track no longer exists!');
                return;
            }
            track.set('playing', true);
            setTimeout(function(trackObj) { trackObj.set('playing', false); }, data.duration * 1000, track);
        } else {
            playlist = _.find(JSON.parse(Campaign().get('jukeboxfolder')), function(folderObj) { return _.isObject(folderObj) && folderObj.id === data.id; });
            if (!playlist) {
                sendChat('System', '/w gm Tried to play "' + data.playlistName + '", but playlist no longer exists!');
                return;
            }
            if (data.playAll) {
                _.each(playlist.n, function(trackId) {
                    track = getObj('jukeboxtrack', trackId);
                    track.set('playing', true);
                    setTimeout(function(trackObj) { trackObj.set('playing', false); }, data.duration * 1000, track);
                });
            } else if (data.playRandom) {
                track = getObj('jukeboxtrack', _.sample(playlist.n));
                track.set('playing', true);
                setTimeout(function(trackObj) { trackObj.set('playing', false); }, data.duration * 1000, track);
            } else {
                if (data.nextIdx >= playlist.n.length) {
                    data.nextIdx = 0;
                }
                track = getObj('jukeboxtrack', playlist.n[data.nextIdx]);
                data.nextIdx = data.nextIdx + 1;
                track.set('playing', true);
                setTimeout(function(trackObj) { trackObj.set('playing', false); }, data.duration * 1000, track);
            }
        }
    }
    
    function sendAlias(playerid, alias, data) {
        var who = getObj('player', playerid).get('displayname');
        
        sendChat('System', '/w "' + who + '" &{template:default} '
            + '{{name=Alias: ' + alias + '}} '
            + '{{Type:=**' + (data.trackName ? 'Track' : 'Playlist') + '**}} '
            + '{{Name:=' + (data.trackName ? data.trackName : data.playlistName) + '}} '
            + '{{Mode:=' + (data.playInorder ? 'Inorder' : (data.playAll ? 'All' : 'Random')) + '}} '
            + '{{Duration:=' + data.duration + 's}}');
    }
    
    function sendError(playerid, message) {
        var who = getObj('player', playerid).get('displayname');
        
        sendChat('System', '/w "' + who + '" **Error:** ' + message);
    }
    
    function handleInput(msg) {
        var isApi = msg.type === 'api',
            args = msg.content.trim().splitArgs(),
            command, arg0, isHelp;
        
        if (!playerIsGM(msg.playerid)) return;
        
        if (isApi) {
            command = args.shift().substring(1).toLowerCase();
            arg0 = args.shift() || '';
            isHelp = arg0.toLowerCase() === 'help' || arg0.toLowerCase() === 'h';
            
            if (!isHelp) {
                if (arg0) {
                    args.unshift(arg0);
                }
                
                if (_.isFunction(commands[command])) {
                    commands[command](args, msg);
                }
            } else if (_.isFunction(commands.help)) {
                commands.help(command, args, msg);
            }
        } else if (_.isFunction(commands['msg_' + msg.type])) {
            commands['msg_' + msg.type](args, msg);
        }
    }
    
    function checkInstall() {
        if (!state.bshields ||
            !state.bshields.sfx ||
            !state.bshields.sfx.version ||
             state.bshields.sfx.version !== version) {
            state.bshields = state.bshields || {};
            state.bshields.sfx = {
                version: version,
                aliases: {},
                triggers: {}
            };
        }
    }
    
    function registerEventHandlers() {
        on('chat:message', handleInput);
        _.each(state.bshields.sfx.triggers, function(allCodes, trigger) {
            _.each(allCodes, function(code) {
                on(trigger, wrapLambda(code.replace(/\bplay\(/, 'this.play(').lambda()));
            });
        });
    }
    
    function wrapLambda(lambda) {
        return function() {
            var errorMessage = '/w gm An error occurred!<br>A triggered event failed. Error message:<br>';
            
            try {
                lambda.apply(bshields.sfx, arguments);
            } catch(e) {
                errorMessage += e + '<br>Event:<br><pre>' + lambda.toString() + '</pre>';
                errorMessage = errorMessage.replace(/\n/g, '<br>');
                sendChat('System',  errorMessage);
            }
        };
    }
    
    return {
        checkInstall: checkInstall,
        registerEventHandlers: registerEventHandlers,
        play: play
    };
}());

on('ready', function() {
    'use strict';
    
    bshields.sfx.checkInstall();
    bshields.sfx.registerEventHandlers();
});

/* String Lambdas
 * Author: Oliver Steele
 * Copyright: Copyright 2007 by Oliver Steele.  All rights reserved.
 * License: MIT License
 * Homepage: http://osteele.com/sources/javascript/functional/
 * Created: 2007-07-11
 * Version: 1.0.2
 */
String.prototype.lambda = function() {
    var params = [],
        expr = this,
        sections = expr.ECMAsplit(/\s*->\s*/m);
    if (sections.length > 1) {
        while (sections.length) {
            expr = sections.pop();
            params = sections.pop().split(/\s*,\s*|\s+/m);
            sections.length && sections.push('(function('+params+'){return ('+expr+')})');
        }
    } else if (expr.match(/\b_\b/)) {
        params = '_';
    } else {
        var leftSection = expr.match(/^\s*(?:[+*\/%&|\^\.=<>]|!=)/m),
            rightSection = expr.match(/[+\-*\/%&|\^\.=<>!]\s*$/m);
        if (leftSection || rightSection) {
            if (leftSection) {
                params.push('$1');
                expr = '$1' + expr;
            }
            if (rightSection) {
                params.push('$2');
                expr = expr + '$2';
            }
        } else {
            var vars = this.replace(/(?:\b[A-Z]|\.[a-zA-Z_$])[a-zA-Z_$\d]*|[a-zA-Z_$][a-zA-Z_$\d]*\s*:|this|arguments|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '').match(/([a-z_$][a-z_$\d]*)/gi) || []; // '
            for (var i = 0, v; v = vars[i++]; )
                params.indexOf(v) >= 0 || params.push(v);
        }
    }
    return new Function(params, 'return (' + expr + ')');
}

String.prototype.lambda.cache = function() {
    var proto = String.prototype,
        cache = {},
        uncached = proto.lambda,
        cached = function() {
            var key = '#' + this; // avoid hidden properties on Object.prototype
	        return cache[key] || (cache[key] = uncached.call(this));
        };
    cached.cached = function(){};
    cached.uncache = function(){proto.lambda = uncached};
    proto.lambda = cached;
}

String.prototype.apply = function(thisArg, args) {
    return this.toFunction().apply(thisArg, args);
}

String.prototype.call = function() {
    return this.toFunction().apply(arguments[0],
                                   Array.prototype.slice.call(arguments, 1));
}

String.prototype.toFunction = function() {
    var body = this;
    if (body.match(/\breturn\b/))
        return new Function(this);
    return this.lambda();
}

Function.prototype.toFunction = function() {
    return this;
}

Function.toFunction = function(value) {
    return value.toFunction();
}

String.prototype.ECMAsplit =
    // The test is from the ECMAScript reference.
    ('ab'.split(/a*/).length > 1
     ? String.prototype.split
     : function(separator, limit) {
         if (typeof limit != 'undefined')
             throw "ECMAsplit: limit is unimplemented";
         var result = this.split.apply(this, arguments),
             re = RegExp(separator),
             savedIndex = re.lastIndex,
             match = re.exec(this);
         if (match && match.index == 0)
             result.unshift('');
         // in case `separator` was already a RegExp:
         re.lastIndex = savedIndex;
         return result;
     });
