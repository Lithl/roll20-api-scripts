var bshields = bshields || {};
bshields.import4e = (function() {
    'use strict';
    
    var version = 0.2,
        config = {},
        configDefaults = {
            
        },
        commands = {
            help: function(command, args, msg) {
                if (_.isFunction(commands['help_' + command])) {
                    commands['help_' + command](args, msg);
                }
            }
        },
        generateUUID = (function() {
            var a = 0,
                b = [];
            
            return function() {
                var c = (new Date()).getTime(),
                    d = c === a,
                    e, f;
                
                a = c;
                for (e = new Array(8), f = 7; 0 <= f; f--) {
                    e[f] = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'.charAt(c % 64);
                    c = Math.floor(c / 64);
                }
                c = e.join("");
                if (d) {
                    for (f = 11; 0 <= f && 63 === b[f]; f--) {
                        b[f] = 0;
                    }
                    b[f]++;
                } else {
                    for (f = 0; 12 > f; f++) {
                        b[f] = Math.floor(64 * Math.random());
                    }
                }
                for (f = 0; 12 > f; f++){
                    c += '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'.charAt(b[f]);
                }
                return c;
            };
        }());
    
    Object.defineProperties(config, {
        /*raiseSize: {
            get: function() {
                var stRaiseSize = state.bshields.raiseCount.config.raiseSize;
                
                if (!stRaiseSize) {
                    return configDefaults.raiseSize;
                }
                return stRaiseSize;
            }
        },*/
    });
    
    function getAttr(obj, name, defaultValue) {
        var result = findObjs({ type: 'attribute', characterid: obj.id, name: name })[0];
        if (!result) {
            result = createObj('attribute', {
                characterid: obj.id,
                name: name,
                current: defaultValue === undefined ? '' : defaultValue,
                max: ''
            });
        }
        return result;
    }
    
    function characterBioChanged(obj, prev) {
        obj.get('bio', function(text) {
            text = _.reject(text.split('<br>'), (l) => l.trim().length === 0);
            if (text[0] !== '====== Created Using Wizards of the Coast D&' + 'amp' + ';D Character Builder ======') {
                state.bshields.import4e.asyncFieldCache[obj.id] = text;
                return;
            }
            text.shift();
            
            // Preamble
            let nameAndLevel = text.shift(),
                raceClassParagonEpic = text.shift().split(', '),
                option = text.shift(),
                background = text.shift(),
                theme = text.shift();
            
            obj.set('name', nameAndLevel.substring(0, nameAndLevel.lastIndexOf(',')));
            
            let attr_level = getAttr(obj, 'level'),
                attr_race = getAttr(obj, 'race'),
                attr_class = getAttr(obj, 'class'),
                attr_paragon = getAttr(obj, 'paragon'),
                attr_epic = getAttr(obj, 'epic');
            
            attr_level.set('current', nameAndLevel.substring(nameAndLevel.lastIndexOf(',') + 8));
            attr_race.set('current', raceClassParagonEpic[0]);
            attr_class.set('current', raceClassParagonEpic.length > 1 ? raceClassParagonEpic[1] : '');
            attr_paragon.set('current', raceClassParagonEpic.length > 2 ? raceClassParagonEpic[2] : '');
            attr_epic.set('current', raceClassParagonEpic.length > 3 ? raceClassParagonEpic[3] : '');
            
            createObj('attribute', {
                characterid: obj.id,
                name: `repeating_class-feats_${generateRowId()}_class-feat`,
                current: option
            });
            createObj('attribute', {
                characterid: obj.id,
                name: `repeating_class-feats_${generateRowId()}_class-feat`,
                current: background
            });
            createObj('attribute', {
                characterid: obj.id,
                name: `repeating_class-feats_${generateRowId()}_class-feat`,
                current: theme
            });
            
            // Ability scores
            text.shift();
            let abilities = _.map(text.shift().split(', '), (s) => s.substring(4));
            text.shift();text.shift();
            
            let attr_strength = getAttr(obj, 'strength'),
                attr_constitution = getAttr(obj, 'constitution'),
                attr_dexterity = getAttr(obj, 'dexterity'),
                attr_intelligence = getAttr(obj, 'intelligence'),
                attr_wisdom = getAttr(obj, 'wisdom'),
                attr_charisma = getAttr(obj, 'charisma');
            
            attr_strength.set('current', abilities[0]);
            attr_constitution.set('current', abilities[1]);
            attr_dexterity.set('current', abilities[2]);
            attr_intelligence.set('current', abilities[3]);
            attr_wisdom.set('current', abilities[4]);
            attr_charisma.set('current', abilities[5]);
            
            // Defense & health
            let defenses = _.chain(text.shift().split(' ')).filter((p) => !isNaN(parseInt(p))).map((n) => parseInt(n)).value(),
                healthAndSurges = _.chain(text.shift().split(' ')).filter((p) => !isNaN(parseInt(p))).map((n) => parseInt(n)).value();
            
            let attr_acHighest = getAttr(obj, 'ac-highest'),
                attr_fortHighest = getAttr(obj, 'fort-highest'),
                attr_refHighest = getAttr(obj, 'ref-highest'),
                attr_willHighest = getAttr(obj, 'will-highest', '@{charisma-mod}'),
                attr_acAbility = getAttr(obj, 'ac-ability'),
                attr_fortAbility = getAttr(obj, 'fort-ability'),
                attr_refAbility = getAttr(obj, 'ref-ability'),
                attr_willAbility = getAttr(obj, 'will-ability'),
                attr_acMisc2 = getAttr(obj, 'ac-misc2'),
                attr_fortMisc2 = getAttr(obj, 'fort-misc2'),
                attr_refMisc2 = getAttr(obj, 'ref-misc2'),
                attr_willMisc2 = getAttr(obj, 'will-misc2'),
                highest_attr,
                attr_hp = getAttr(obj, 'hp'),
                attr_hpBloodied = getAttr(obj, 'hp-bloodied'),
                attr_surgeValue = getAttr(obj, 'surge-value'),
                attr_surgeValueBonus = getAttr(obj, 'surge-value-bonus'),
                attr_surges = getAttr(obj, 'surges');
            
            if (attr_acHighest.get('current') === '') {
                attr_acHighest.set('current', 0);
            }
            if (attr_fortHighest.get('current') === '') {
                if (parseInt(attr_strength.get('current')) > parseInt(attr_constitution.get('current'))) {
                    attr_fortHighest.set('current', '@{strength-mod}');
                } else {
                    attr_fortHighest.set('current', '@{constitution-mod}');
                }
            }
            if (attr_refHighest.get('current') === '') {
                if (parseInt(attr_intelligence.get('current')) > parseInt(attr_dexterity.get('current'))) {
                    attr_refHighest.set('current', '@{intelligence-mod}');
                } else {
                    attr_refHighest.set('current', '@{dexterity-mod}');
                }
            }
            if (attr_willHighest.get('current') === '') {
                if (parseInt(attr_wisdom.get('current')) > parseInt(attr_charisma.get('current'))) {
                    attr_willHighest.set('current', '@{wisdom-mod}');
                } else {
                    attr_willHighest.set('current', '@{charisma-mod}');
                }
            }
            
            if (/@\{.*-mod\}/.test(attr_acHighest.get('current'))) {
                highest_attr = getAttr(obj, attr_acHighest.get('current').substring(2, attr_acHighest.get('current').indexOf('}') - 4));
                attr_acAbility.set('current', Math.floor((parseInt(highest_attr.get('current')) - 10) / 2));log(attr_acAbility);
            } else {
                attr_acAbility.set('current', 0);
            }
            if (/@\{.*-mod\}/.test(attr_fortHighest.get('current'))) {
                highest_attr = getAttr(obj, attr_fortHighest.get('current').substring(2, attr_fortHighest.get('current').indexOf('}') - 4));
                attr_fortAbility.set('current', Math.floor((parseInt(highest_attr.get('current')) - 10) / 2));
            } else {
                attr_fortAbility.set('current', 0);
            }
            if (/@\{.*-mod\}/.test(attr_refHighest.get('current'))) {
                highest_attr = getAttr(obj, attr_refHighest.get('current').substring(2, attr_refHighest.get('current').indexOf('}') - 4));
                attr_refAbility.set('current', Math.floor((parseInt(highest_attr.get('current')) - 10) / 2));
            } else {
                attr_refAbility.set('current', 0);
            }
            if (/@\{.*-mod\}/.test(attr_willHighest.get('current'))) {
                highest_attr = getAttr(obj, attr_willHighest.get('current').substring(2, attr_willHighest.get('current').indexOf('}') - 4));
                attr_willAbility.set('current', Math.floor((parseInt(highest_attr.get('current')) - 10) / 2));
            } else {
                attr_willAbility.set('current', 0);
            }
            let tenPlusHalfLevel = 10 + Math.floor(parseInt(attr_level.get('current')) / 2);
            attr_acMisc2.set('current', parseInt(defenses[0]) - parseInt(attr_acAbility.get('current')) - tenPlusHalfLevel);
            attr_fortMisc2.set('current', parseInt(defenses[1]) - parseInt(attr_fortAbility.get('current')) - tenPlusHalfLevel);
            attr_refMisc2.set('current', parseInt(defenses[2]) - parseInt(attr_refAbility.get('current')) - tenPlusHalfLevel);
            attr_willMisc2.set('current', parseInt(defenses[3]) - parseInt(attr_willAbility.get('current')) - tenPlusHalfLevel);
            
            attr_hp.set({
                current: healthAndSurges[0],
                max: healthAndSurges[0]
            });
            attr_hpBloodied.set('current', Math.floor(parseInt(attr_hp.get('max')) / 2));
            attr_surges.set({
                current: healthAndSurges[1],
                max: healthAndSurges[1]
            });
            attr_surgeValue.set('current', healthAndSurges[2]);
            attr_surgeValueBonus.set('current', parseInt(attr_surgeValue.get('current')) - Math.floor(parseInt(attr_hpBloodied.get('current')) / 2));
            
            // Skills
            text.shift();
            let trainedSkills = text.shift().split(', '),
                untrainedSkills = _.rest(text)[0].split(', '),
                skills = {};
            text.shift();text.shift();
            
            _.each(untrainedSkills, (us) => {
                let parts = us.split(' ');
                skills[parts[0]] = { bonus: parseInt(parts[1]) };
            });
            _.each(trainedSkills, (ts) => {
                let parts = ts.split(' ');
                skills[parts[0]] = { trained: true, bonus: parseInt(parts[1]) };
            });
            
            _.each(skills, (data, name) => {
                let attr_skillTrained = getAttr(obj, `${name.toLowerCase()}-trained`),
                    attr_skillMisc = getAttr(obj, `${name.toLowerCase()}-misc`);
                
                let skillAbility = getAttrByName(obj.id, name.toLowerCase());
                skillAbility = skillAbility.substring(skillAbility.indexOf('{') + 1, skillAbility.indexOf('-'));
                switch (skillAbility) {
                    case 'strength': skillAbility = attr_strength.get('current'); break;
                    case 'constitution': skillAbility = attr_constitution.get('current'); break;
                    case 'dexterity': skillAbility = attr_dexterity.get('current'); break;
                    case 'intelligence': skillAbility = attr_intelligence.get('current'); break;
                    case 'wisdom': skillAbility = attr_wisdom.get('current'); break;
                    case 'charisma': skillAbility = attr_charisma.get('current'); break;
                }
                let skillAbilityMod = Math.floor((parseInt(skillAbility) - 10) / 2);
                
                attr_skillTrained.set('current', data.trained ? 1 : 0);
                attr_skillMisc.set('current', data.bonus - (skillAbilityMod + Math.floor(parseInt(attr_level.get('current')) / 2) + (data.trained ? 5 : 0)));
            });
            
            // Powers
            text.shift();
            let p, c = 1;
            while ((p = text.shift()) !== 'FEATS') {
                let name = p.substring(p.indexOf(':') + 2),
                    level = p.match(/(?:Attack|Utility) (\d+):/);
                level = level ? parseInt(level[1]) : '-';
                
                let attr_powerNName = getAttr(obj, `power-${c}-name`),
                    attr_powerNLevel = getAttr(obj, `power-${c}-level`),
                    attr_powerNToggle = getAttr(obj, `power-${c}-toggle`);
                
                attr_powerNName.set('current', name);
                attr_powerNLevel.set('current', level);
                attr_powerNToggle.set('current', 'on');
                c++;
            }
            for (; c <= 100; c++) {
                let attr_powerNToggle = getAttr(obj, `power-${c}-toggle`);
                
                attr_powerNToggle.set('current', 0);
            }
            
            // Feats
            let f;
            while ((f = text.shift()) !== 'ITEMS') {
                createObj('attribute', {
                    characterid: obj.id,
                    name: `repeating_feats_${generateRowId()}_feat`,
                    current: f
                });
            }
            
            // Items
            let items = _.initial(text);
            _.each(items, (i) => {
                let name = /^.* x\d+$/.test(i) ? i.substring(0, i.lastIndexOf(' x')) : i,
                    amount = /^.* x\d+$/.test(i) ? parseInt(i.substring(i.lastIndexOf('x') + 1)) : 1,
                    rowid = generateRowId();
                
                createObj('attribute', {
                    characterid: obj.id,
                    name: `repeating_inventory_${rowid}_inventory-name`,
                    current: name
                });
                createObj('attribute', {
                    characterid: obj.id,
                    name: `repeating_inventory_${rowid}_inventory-quantity`,
                    current: amount
                });
            });
            
            // Reset bio
            obj.set('bio', state.bshields.import4e.asyncFieldCache[obj.id] || '');
        });
    }
    
    function handleInput(msg) {
        var isApi = msg.type === 'api',
            args = msg.content.trim().splitArgs(),
            command, arg0, isHelp;
        
        if (isApi) {
            command = args.shift().substring(1).toLowerCase();
            arg0 = args.shift() || '';
            isHelp = arg0.toLowerCase() === 'help' || arg0.toLowerCase() === 'h' || command === 'help';
            
            if (!isHelp) {
                if (arg0 && arg0.length > 0) {
                    args.unshift(arg0);
                }
                
                if (_.isFunction(commands[command])) {
                    commands[command](args, msg);
                }
            } else if (_.isFunction(commands.help)) {
                commands.help(command === 'help' ? arg0 : command, args, msg);
            }
        } else if (_.isFunction(commands['msg_' + msg.type])) {
            commands['msg_' + msg.type](args, msg);
        }
    }
    
    function checkInstall() {
        if (!state.bshields ||
            !state.bshields.import4e ||
            !state.bshields.import4e.version ||
             state.bshields.import4e.version !== version) {
            state.bshields = state.bshields || {};
            state.bshields.import4e = {
                version: version,
                gcUpdated: 0,
                config: {},
                asyncFieldCache: {}
            };
        }
        checkGlobalConfig();
    }
    
    function checkGlobalConfig() {
        var gc = globalconfig && globalconfig['d&d4eimporter'],
            st = state.bshields.raiseCount;
        
        if (gc && gc.lastsaved && gc.lastsaved > st.gcUpdated) {
            st.gcUpdated = gc.lastsaved;
            //st.config.raiseSize = gc['Raise Size'];
        }
    }
    
    function registerEventHandlers() {
        on('chat:message', handleInput);
        on('change:character:bio', characterBioChanged);
    }
    
    function generateRowId() { return generateUUID().replace(/_/g, 'Z'); }
    
    return {
        checkInstall: checkInstall,
        registerEventHandlers: registerEventHandlers
    };
}());

on('ready', function() {
    'use strict';
    
    bshields.import4e.checkInstall();
    bshields.import4e.registerEventHandlers();
});