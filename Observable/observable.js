var bshields = bshields || {};
bshields.eventTarget = (function() {
    'use strict';
    
    var version = 0.1,
        listeners = [],
        r20ObjectProperties = ['attributes', 'updatequeue', 'doSave', 'id',
            'fbpath', 'added', '_doSave', '_validateAttrs', 'set', 'get',
            'previous', 'toJSON', 'destroy', 'remove'],
        removableTypes = ['graphic', 'text', 'path', 'character', 'ability', 'attribute', 'handout', 'rollabletable', 'tableitem', 'macro'],
        creatableTypes = ['graphic', 'text', 'path', 'character', 'ability', 'attribute', 'handout', 'rollabletable', 'tableitem', 'macro'];
    
    function Observable(obj) {
        Object.defineProperties(this, {
            base: {
                enumerable: false,
                writable: false,
                value: obj
            },
            defaultAction: {
                enumerable: false,
                writable: true,
                value: true
            }
        });
        
        if (_.contains(removableTypes, this.base.get('type'))) {
            Object.defineProperty(this, 'remove', {
                enumerable: false,
                writable: false,
                value: function() {
                    dispatchEvent(this.base.get('type') + ':remove', this);
                    if (this.defaultAction) {
                        this.base.remove();
                    }
                    this.defaultAction = true;
                }
            })
        }
    }
    Object.defineProperties(Observable.prototype, {
        preventDefault: {
            enumerable: false,
            value: preventDefault
        },
        id: {
            enumerable: false,
            get: function() {
                var tmp = dispatchEvent(this.base.get('type') + ':get:id', this);
                if (this.defaultAction) { return this.base.id; }
                this.defaultAction = true;
                return tmp;
            }
        },
        set: {
            enumerable: false,
            writable: false,
            value: function(name, value) {
                var next = JSON.parse(JSON.stringify(this.base.attributes)),
                    events = [];
                
                if (!value && _.isObject(name) && !_.isArray(name) && !_.isFunction(name)) {
                    // Setting multiple property values at once
                    _.each(name, function(value, key) {
                        next[key] = value;
                        events.push(this.base.get('type') + ':set:' + key);
                    }, this);
                    dispatchEvents(events, this, next);
                    if (this.defaultAction) { this.base.set(name); }
                    this.defaultAction = true;
                } else if (_.isString(name)) {
                    // Setting single property value
                    next[name] = value;
                    dispatchEvent(this.base.get('type') + ':set:' + name, this, next);
                    if (this.defaultAction) { this.base.set(name, value); }
                    this.defaultAction = true;
                } else {
                    throw new TypeError('Function call must be obj.set(properties) or obj.set(propertyName, propertyValue)');
                }
            }
        },
        get: {
            enumerable: false,
            writable: false,
            value: function(name) {
                var tmp;
                
                name = name || '';
                tmp = dispatchEvent(this.base.get('type') + ':get:' + name, this);
                if (this.defaultAction) { return this.base.get(name); }
                this.defaultAction = true;
                return tmp;
            }
        }
    });
    
    function addEventListener(event, callback) {
        var parts = event.split(':');
        
        if (parts[2] && parts[2].indexOf('_') === 0) {
            parts[2] = parts[2].substring(1);
        }
        
        listeners.push({
            type: parts[0],
            action: parts[1],
            property: parts[2],
            callback: callback
        });
    }
    
    function removeEventListener(event, callback) {
        var parts = event.split(':'),
            toRemove;
        
        if (parts[2] && parts[2].indexOf('_') === 0) {
            parts[2] = parts[2].substring(1);
        }
            
        toRemove = _.chain(listeners).map(function(l, i) { l.idx = i; return l; })
                    .where({ type: parts[0], action: parts[1], property: parts[2], callback: callback })
                    .value();
        
        _.each(toRemove, function(l) {
            listeners.splice(l.idx, 1);
        });
    }
    
    function dispatchEvent(event, observable, next) {
        var parts = event.split(':'),
            allListeners = _.where(listeners, { type: parts[0], action: parts[1] }),
            generalListeners = _.reject(allListeners, function(l) { return !!l.property; }),
            propertyListeners, toDispatch, result = [];
        
        if (parts[2] && parts[2].indexOf('_') === 0) {
            parts[2] = parts[2].substring(1);
        }
            
        propertyListeners = _.reject(allListeners, function(l) { return l.property !== parts[2]; });
        
        toDispatch = _.union(propertyListeners, generalListeners);
        
        _.each(toDispatch, function(l) {
            var e = l.type + ':' + l.action;
            
            if (l.property) { e += ':' + l.property; }
            result.push(l.callback(observable, next, e));
        });
        return result.length === 1 ? result[0] : result;
    }
    
    function dispatchEvents(events, observable, next) {
        var type = events[0].split(':')[0],
            properties = _.map(events, function(e) {
                var prop = e.split(':')[2];
                
                if (prop && prop.indexOf('_') === 0) {
                    prop = prop.substring(1);
                }
                return prop;
            }),
            allListeners = _.where(listeners, { type: type, action: 'set' }),
            generalListeners = _.reject(allListeners, function(l) { return !!l.property; }),
            propertyListeners, result = [];
        
        _.each(properties, function(prop) {
            propertyListeners = _.reject(allListeners, function(l) { return l.property !== prop; });
            _.each(propertyListeners, function(l) { result.push(l.callback(observable, next, l.type + ':' + l.action + ':' + l.property)); });
        });
        _.each(generalListeners, function(l) { result.push(l.callback(observable, next, l.type + ':' + l.action)); });
        return result.length === 1 ? result[0] : result;
    }
    
    function preventDefault() { this.defaultAction = false; }
    
    function wrapR20Object(obj) {
        var prop, props = [];
        
        for (prop in obj) {
            props.push(prop);
        }
        if (_.difference(r20ObjectProperties, props).length !== 0) {
            throw new TypeError('Object not set to instance of Roll20 object.');
        }
        
        return new Observable(obj);
    }
    
    function createR20Object(type, props) {
        var r20, observable = new Observable({ get: function() { return ''; } }),
            next = JSON.parse(JSON.stringify(props));
        
        if (!_.contains(creatableTypes, type)) {
            throw new TypeError('"' + type + '" is not a valid type for object creation.');
        }
        
        next._type = type;
        dispatchEvent(type + ':create', observable, next);
        if (observable.defaultAction) {
            r20 = createObj(type, props);
            observable = wrapR20Object(r20);
            return observable;
        }
    }
    
    return {
        addEventListener: addEventListener,
        removeEventListener: removeEventListener,
        observe: wrapR20Object,
        createObservable: createR20Object
    };
}());

// shorthand function calls
var addEventListener = addEventListener || bshields.eventTarget.addEventListener,
    removeEventListener = removeEventListener || bshields.eventTarget.removeEventListener,
    observe = observe || bshields.eventTarget.observe,
    createObservable = createObservable || bshields.eventTarget.createObservable;