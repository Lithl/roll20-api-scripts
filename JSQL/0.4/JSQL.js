var bshields = bshields || {}, jsql;
bshields.jsql = (function() {
    'use strict';
    
    var version = 0.4;
    
    function registerTypeHandler(type, handler, handlers) {
        var typeofType = typeof type,
            foundType = false;
        
        if (typeofType !== 'function' && typeofType !== 'string') {
            throw new Error('type must be a constructor or a string');
        }
        if (typeof handler !== 'function') {
            throw new Error('handler must be a function');
        }
        if (typeofType === 'string') {
            type = type.toLowerCase();
        }
        
        _.each(handlers, (h, i) => {
            if (h.type === type) {
                handlers[i].handler = handler;
                foundType = true;
            }
        });
        if (!foundType) {
            handlers.push({
                type: type,
                handler: handler
            });
        }
    }
    
    function getTypeHandler(type) {
        var handlers = _.chain(arguments).rest().flatten().reject((o) => !o).value(),
            result;
        _.each(handlers, (h) => {
            if (h.type === type) {
                result = h.handler;
            }
        });
        return result;
    }
    
    function getHandlerFor(value) {
        var handlers = _.chain(arguments).rest().flatten().reject((o) => !o).value(),
            isBoolean = value === true || value === false,
            isNull = value === null || value === undefined,
            result;
        _.each(handlers, (h) => {
            if ((isBoolean && h.type === 'boolean') ||
                (isNull && h.type === 'null') ||
                (typeof h.type !== 'string' && value instanceof h.type) ||
                typeof value === h.type) {
                result = h.handler
            }
        });
        return result;
    }
    
    function parseQualifiedName(name, assumeField) {
        var field, table = name, schema, alias;
        
        if (name.indexOf(' ') > 0) {
            alias = name.substring(name.lastIndexOf(' ') + 1);
            name = name.substring(0, name.lastIndexOf(' '));
            table = name;
        }
        
        if (assumeField) {
            name = parseQualifiedName(name, false);
            table = name.schema;
            field = name.table;
        }
        
        if (table && table.indexOf('.') >= 0) {
            schema = table.substring(0, table.lastIndexOf('.'));
            table = table.substring(table.lastIndexOf('.') + 1);
        }
        
        if (alias && !alias.length) alias = undefined;
        if (field && !field.length) field = undefined;
        if (table && !table.length) table = undefined;
        if (schema && !schema.length) schema = undefined;
        
        return {
            schema: schema,
            table: table,
            field: field,
            alias: alias
        };
    }
    
    function handlerStrToFunction(str) {
        var regexSimpleReturn = /^\((\w+)\)\s*=>\s*([^{].+[^}])$/,
            regexDefinedReturn = /^\((\w+)\)\s*=>\s*\{(.+)\}$/,
            regexFullFunction = /^function\s+\w*\((\w*)\)\s*\{\s*(.+)\s*\}$/,
            matchesSimpleReturn = str.match(regexSimpleReturn),
            matchesDefinedReturn = str.match(regexDefinedReturn),
            matchesFullFunction = str.match(regexFullFunction);
        
        if (matchesSimpleReturn) {
            return new Function(matchesSimpleReturn[1], `return ${matchesSimpleReturn[2]};`);
        } else if (matchesDefinedReturn) {
            return new Function(matchesDefinedReturn[1], matchesDefinedReturn[2]);
        } else if (matchesFullFunction) {
            return new Function(matchesFullFunction[1], matchesFullFunction[2]);
        } else {
            throw new Error(`Cannot match string ${str} to a function template`);
        }
    }
    
    function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0,
                v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    function quoteRegexp(str, except) {
        var result = String(str).replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, '\\$1').replace(/\x08/g, '\\x08');
        if (except) {
            result = result.replace(new RegExp(`\\([${except}])`, 'g'), '$1');
        }
        return result;
    }
    
    function evaluateExpression(expr, tables, cls) {
        var operators = cls.Expression.Operator,
            operands = _.map(expr.operation.operands, (o) => o instanceof cls.Expression ? evaluateExpression(o, tables, cls) : o),
            tmp, tmpA, tmpB, tmpC;
        
        function isField(val) {
            if (!_.isString(val)) return false;
            let field = parseQualifiedName(val, true),
                schema = field.schema || 'default',
                identifier = field.table ? `${schema}.${field.table}` : '',
                table = tables(identifier);
            return _.chain(table.fields).map((f) => f.name).contains(field.field).value();
        }
        function pluckField(name) {
            var field = parseQualifiedName(name, true),
                schema = field.schema || 'default',
                identifier = field.table ? `${schema}.${field.table}` : '',
                table = tables(identifier),
                idx = _.map(table.fields, (f) => f.name).indexOf(field.field);
            return _.map(table.rows, (r) => r[idx]);
        }
        
        if (isField(operands[0])) tmp = pluckField(operands[0]);
        else if (_.isArray(operands[0])) tmp = operands[0];
        tmpA = tmp;
        if (isField(operands[1])) tmpB = pluckField(operands[1]);
        else if (_.isArray(operands[1])) tmpB = operands[1];
        if (isField(operands[2])) tmpC = pluckField(operands[2]);
        else if (_.isArray(operands[2])) tmpC = operands[2];
        
        switch (expr.operation.operator) {
            // unary math
            case operators.Identity:
                return operands[0];
            case operators.Negate:
                if (tmp) return _.map(tmp, (v) => -parseFloat(v));
                return -parseInt(operands[0]);
            
            // unary bitwise
            case operators.BitNot:
                if (tmp) return _.map(tmp, (v) => ~parseInt(v));
                return ~parseInt(operands[0]);
            
            // unary logic
            case operators.Not:
                if (tmp) return _.map(tmp, (v) => !(!!v));
                return !(!!operands[0]);
            
            // binary math
            case operators.Plus:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('plus operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) + parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) + parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(v) + parseFloat(operands[0]));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) + parseFloat(operands[1]);
                }
            case operators.Minus:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('minus operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) - parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) - parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) - parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) - parseFloat(operands[1]);
                }
            case operators.Multiply:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('multiply operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) * parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) * parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(v) * parseFloat(operands[0]));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) * parseFloat(operands[1]);
                }
            case operators.Divide:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('divide operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) / parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) / parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) / parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) / parseFloat(operands[1]);
                }
            case operators.Modulus:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('modulus operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) % parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) % parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) % parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) % parseFloat(operands[1]);
                }
            
            // binary bitwise
            case operators.BitOr:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('bitOr operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseInt(p[0]) | parseInt(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseInt(v) | parseInt(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseInt(v) | parseInt(operands[0]));
                    return operands[0] === null || operands[1] === null ? null : parseInt(operands[0]) | parseInt(operands[1]);
                }
            case operators.BitAnd:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('bitAnd operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseInt(p[0]) & parseInt(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseInt(v) & parseInt(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseInt(v) & parseInt(operands[0]));
                    return operands[0] === null || operands[1] === null ? null : parseInt(operands[0]) & parseInt(operands[1]);
                }
            case operators.BitLeft:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('bitLeft operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseInt(p[0]) << parseInt(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseInt(v) << parseInt(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseInt(operands[0] << parseInt(v)));
                    return operands[0] === null || operands[1] === null ? null : parseInt(operands[0]) << parseInt(operands[1]);
                }
            case operators.BitRight:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('bitRight operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseInt(p[0]) >> parseInt(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseInt(v) >> parseInt(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseInt(operands[0] >> parseInt(v)));
                    return operands[0] === null || operands[1] === null ? null : parseInt(operands[0]) >> parseInt(operands[1]);
                }
            
            // binary logic
            case operators.Or:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('or operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : (!!p[0]) || (!!p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : !!v || !!operands[1]);
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : !!operands[0] || !!v);
                    return operands[0] === null || operands[1] === null ? null : (!!operands[0]) || (!!operands[1]);
                }
            case operators.And:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('and operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : (!!p[0]) && (!!p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : !!v && !!operands[1]);
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : !!operands[0] && !!v);
                    return operands[0] === null || operands[1] === null ? null : (!!operands[0]) && (!!operands[1]);
                }
            case operators.LessThan:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('lessThan operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) < parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) < parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) < parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) < parseFloat(operands[1]);
                }
            case operators.LessThanEqual:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('lessThanEqual operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) <= parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) <= parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) <= parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) <= parseFloat(operands[1]);
                }
            case operators.GreaterThan:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('greaterThan operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) > parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) > parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) > parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) > parseFloat(operands[1]);
                }
            case operators.GreaterThanEqual:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('greaterThanEqual operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseFloat(p[0]) >= parseFloat(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseFloat(v) >= parseFloat(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseFloat(operands[0]) >= parseFloat(v));
                    return operands[0] === null || operands[1] === null ? null : parseFloat(operands[0]) >= parseFloat(operands[1]);
                }
            case operators.Equal:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('equal operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : p[0] === p[1]).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === operands[1]);
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === operancs[0]);
                    return operands[0] === null || operands[1] === null ? null : operands[0] === operands[1];
                }
            case operators.NotEqual:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('notEqual operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : p[0] !== p[1]).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v !== operands[1]);
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v !== operancs[0]);
                    return operands[0] === null || operands[1] === null ? null : operands[0] !== operands[1];
                }
            case operators.Is:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('is operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === p[1]).value();
                } else {
                    if (tmpA) return _.map(tmpA, (v) => v === operands[1]);
                    if (tmpB) return _.map(tmpB, (v) => v === operands[0]);
                    return operands[0] === operands[1];
                }
            case operators.IsNot:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('isNot operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] !== p[1]).value();
                } else {
                    if (tmpA) return _.map(tmpA, (v) => v !== operands[1]);
                    if (tmpB) return _.map(tmpB, (v) => v !== operands[0]);
                    return operands[0] !== operands[1];
                }
            case operators.In:
                if (!tmpB) throw new Error('right oeprand for in must be a collection or field');
                if (tmp.length === 0) return false;
                if (tmpA) return _.map(tmpA, (v) => _.contains(tmpB, v));
                return _.contains(tmpB, operands[0]);
            case operators.NotIn:
                if (!tmpB) throw new Error('right oeprand for notIn must be a collection or field');
                if (tmp.length === 0) return true;
                if (tmpA) return _.map(tmpA, (v) => !_.contains(tmpB, v));
                return !_.contains(tmpB, operands[0]);
            case operators.Like:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('like operands are not of same length');
                    return _.chain(tmpA).zip(tmpB)
                        .map((p) => {
                            p[1] = quoteRegexp(p[1])
                                    .replace(/(%)?%/g, ($0, $1) => $1 === '%' ? $0 : '.*')
                                    .replace(/(_)?_/g, ($0, $1) => $1 === '_' ? $0 : '.');
                            return (new RegExp(p[1], 'i')).test(p[0]);
                        }).value();
                } else {
                    if (operands[0] === null || operands[1] === null) return null;
                    operands[1] = quoteRegexp(operands[1])
                                .replace(/(%)?%/g, ($0, $1) => $1 === '%' ? $0 : '.*')
                                .replace(/(_)?_/g, ($0, $1) => $1 === '_' ? $0 : '.');
                    let regex = new RegExp(operands[1], 'i');
                    if (tmpA) {
                        return _.map(tmpA, (v) => v === null ? null : regex.test(v));
                    }
                    if (tmpB) {
                        return _.map(tmpB, (v) => {
                            if (v === null) return null;
                            v = quoteRegexp(v)
                                    .replace(/(%)?%/g, ($0, $1) => $1 === '%' ? $0 : '.*')
                                    .replace(/(_)?_/g, ($0, $1) => $1 === '_' ? $0 : '.');
                            return (new RegExp(v, 'i')).test(operands[0]);
                        });
                    }
                    return regex.test(operands[0]);
                }
            case operators.NotLike:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('like operands are not of same length');
                    return _.chain(tmpA).zip(tmpB)
                        .map((p) => {
                            p[1] = quoteRegexp(p[1])
                                    .replace(/(%)?%/g, ($0, $1) => $1 === '%' ? $0 : '.*')
                                    .replace(/(_)?_/g, ($0, $1) => $1 === '_' ? $0 : '.');
                            return !(new RegExp(p[1], 'i')).test(p[0]);
                        }).value();
                } else {
                    if (operands[0] === null || operands[1] === null) return null;
                    operands[1] = quoteRegexp(operands[1])
                                .replace(/(%)?%/g, ($0, $1) => $1 === '%' ? $0 : '.*')
                                .replace(/(_)?_/g, ($0, $1) => $1 === '_' ? $0 : '.');
                    let regex = new RegExp(operands[1], 'i');
                    if (tmpA) return _.map(tmpA, (v) => v === null ? null : !regex.test(v));
                    if (tmpB) {
                        return _.map(tmpB, (v) => {
                            if (v === null) return null;
                            v = quoteRegexp(v)
                                    .replace(/(%)?%/g, ($0, $1) => $1 === '%' ? $0 : '.*')
                                    .replace(/(_)?_/g, ($0, $1) => $1 === '_' ? $0 : '.');
                            return !(new RegExp(v, 'i')).test(operands[0]);
                        });
                    }
                    return !regex.test(operands[0]);
                }
            case operators.Glob:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('glob operands are not of same length');
                    return _.chain(tmpA).zip(tmpB)
                        .map((p) => {
                            p[1] = quoteRegexp(p[1], '*?')
                                    .replace(/(\*)?\*/g, ($0, $1) => $1 === '*' ? $0 : '.*')
                                    .replace(/(\?)?\?/g, ($0, $1) => $1 === '?' ? $0 : '.');
                            return (new RegExp(p[1])).test(p[0]);
                        }).value();
                } else {
                    if (operands[0] === null || operands[1] === null) return null;
                    operands[1] = quoteRegexp(operands[1], '*?')
                                .replace(/(\*)?\*/g, ($0, $1) => $1 === '*' ? $0 : '.*')
                                .replace(/(\?)?\?/g, ($0, $1) => $1 === '?' ? $0 : '.');
                    let regex = new RegExp(operands[1]);
                    if (tmpA) return _.map(tmpA, (v) => v === null ? null : regex.test(v));
                    if (tmpB) {
                        return _.map(tmpB, (v) => {
                            if (v === null) return null;
                            v = quoteRegexp(v, '*?')
                                    .replace(/(\*)?\*/g, ($0, $1) => $1 === '*' ? $0 : '.*')
                                    .replace(/(\?)?\?/g, ($0, $1) => $1 === '?' ? $0 : '.');
                            return (new RegExp(v)).test(operands[0]);
                        });
                    }
                    return regex.test(operands[0]);
                }
            case operators.NotGlob:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('glob operands are not of same length');
                    return _.chain(tmpA).zip(tmpB)
                        .map((p) => {
                            p[1] = quoteRegexp(p[1], '*?')
                                    .replace(/(\*)?\*/g, ($0, $1) => $1 === '*' ? $0 : '.*')
                                    .replace(/(\?)?\?/g, ($0, $1) => $1 === '?' ? $0 : '.');
                            return !(new RegExp(p[1])).test(p[0]);
                        }).value();
                } else {
                    if (operands[0] === null || operands[1] === null) return null;
                    operands[1] = quoteRegexp(operands[1], '*?')
                                .replace(/(\*)?\*/g, ($0, $1) => $1 === '*' ? $0 : '.*')
                                .replace(/(\?)?\?/g, ($0, $1) => $1 === '?' ? $0 : '.');
                    let regex = new RegExp(operands[1]);
                    if (tmpA) return _.map(tmpA, (v) => v === null ? null : !regex.test(v));
                    if (tmpB) {
                        return _.map(tmpB, (v) => {
                            if (v === null) return null;
                            v = quoteRegexp(v, '*?')
                                    .replace(/(\*)?\*/g, ($0, $1) => $1 === '*' ? $0 : '.*')
                                    .replace(/(\?)?\?/g, ($0, $1) => $1 === '?' ? $0 : '.');
                            return !(new RegExp(v)).test(operands[0]);
                        });
                    }
                    return !regex.test(operands[0]);
                }
            case operators.Regex:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('regex operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => (new RegExp(p[1])).test(p[0])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : (new RegExp(operands[1])).test(v));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : (new RegExp(v)).test(operands[0]));
                    return (new RegExp(operands[1])).test(operands[0]);
                }
            
            // aggregate functions
            case operators.Average:
                if (!tmp) throw new Error('average function requires collection or field');
                tmp = _.reject(tmp, (v) => v === null);
                if (tmp.length === 0) return null;
                return _.reduce(tmp, (m, v) => m + parseFloat(v), 0) / tmp.length;
            case operators.Count:
                if (operands[0] !== '*' && !tmp) throw new Error('count function requires a collection, field, or *');
                if (operands[0] === '*') tmp = tables();
                else tmp = _.reject(tmp, (v) => v === null);
                return tmp.length;
            case operators.GroupConcat:
                if (!tmp) throw new Error('groupConcat function requires a collection or field');
                tmp = _.reject(tmp, (v) => v === null);
                if (tmp.length === 0) return null;
                return tmp.join(operands[1]);
            case operators.Max:
                if (!tmp) throw new Error('max function requires a collection or field');
                tmp = _.reject(tmp, (v) => v === null);
                if (tmp.length === 0) return null;
                return Math.max.apply(null, _.map(tmp, (v) => parseFloat(v)));
            case operators.Min:
                if (!tmp) throw new Error('min function requires a collection or field');
                tmp = _.reject(tmp, (v) => v === null);
                if (tmp.length === 0) return null;
                return Math.min.apply(null, _.map(tmp, (v) => parseFloat(v)));
            case operators.Sum:
                if (!tmp) throw new Error('sum function requires a collection or field');
                tmp = _.reject(tmp, (v) => v === null);
                if (tmp.legnth === 0) return null;
                return _.reduce(tmp, (m, v) => m + parseFloat(v), 0);
            case operators.Total:
                if (!tmp) throw new Error('total function requires a collection or field');
                tmp = _.reject(tmp, (v) => v === null);
                if (tmp.legnth === 0) return 0;
                return _.reduce(tmp, (m, v) => m + parseFloat(v), 0);
            
            // core functions
            case operators.Abs:
                if (tmp) return _.map(tmp, (v) => v === null ? null : Math.abs(parseFloat(v)));
                return operands[0] === null ? null : Math.abs(parseFloat(operands[0]));
            case operators.Changes:
                return state.bshields.jsql.db.changes;
            case operators.Char:
                if (tmp) return String.fromCodePoint.apply(null, _.map(tmp, (v) => parseInt(v)));
                return String.fromCodePoint.apply(null, _.map(operands, (v) => parseInt(v)));
            case operators.Coalesce:
                if (tmp) return _.find(tmp, (v) => v !== null);
                return _.find(operands, (v) => v !== null);
            case operators.IfNull:
                if (operands[0] !== null) return operands[0];
                if (operands[1] !== null) return operands[1];
                return null;
            case operators.LastInsertRowId:
                return state.bshields.jsql.db.lastRowid;
            case operators.Length:
                if (tmp) return _.map(tmp, (v) => v === null ? null : String(v).length);
                return operands[0] === null ? null : String(operands[0]).length;
            case operators.Lower:
                if (tmp) return _.map(tmp, (v) => v === null ? null : String(v).toLowerCase());
                return operands[0] === null ? null : String(operands[0]).toLowerCase();
            case operators.LTrim:
                if (tmp) return _.map(tmp, (v) => v === null ? null : String(v).replace(/^\s+/, ''));
                return operands[0] === null ? null : String(operands[0]).replace(/^\s+/, '');
            case operators.MMax:
                return Math.max.apply(null, _.chain(operands).reject((v) => v === null).map((v) => parseFloat(v)).value());
            case operators.MMin:
                return Math.min.apply(null, _.chain(operands).reject(v => v === null).map((v) => parseFloat(v)).value());
            case operators.NullIf:
                if (tmpA && tmpB) return _.difference(tmpA, tmpB).length === 0 ? null : tmpA;
                if ((tmpA && !tmpB) || (!tmpA && tmpB)) return tmpA ? tmpA : null;
                return operands[0] === operands[1] ? null : operands[0];
            case operators.Random:
                const MAX =  4503599627370495,
                      MIN = -4503599627370495;
                return Math.random() * (MAX - MIN) + MIN;
            case operators.Replace:
                // haystack, needle, replace
                if (tmpA) {
                    if (tmpB) {
                        if (tmpA.length !== tmpB.length) throw new Error('haystack and needle collection lengths must be the same');
                        if (tmpC) {
                            // [],[],[]
                            if (tmpA.length !== tmpC.length) throw new Error('haystack and replace collection lengths must be the same');
                            for (let i = 0; i < tmpA.length; i++) {
                                tmpA[i] = tmpA[i].split(tmpB[i]).join(tmpC[i]);
                            }
                            return tmpA;
                        }
                        // [],[],''
                        for (let i = 0; i < tmpA.length; i++) {
                            tmpA[i] = tmpA[i].split(tmpB[i]).join(operands[2]);
                        }
                        return tmpA;
                    }
                    if (tmpC) {
                        // [],'',[]
                        if (tmpA.length !== tmpC.length) throw new Error('haystack and replace collection lengths must be the same');
                        for (let i = 0; i < tmpA.length; i++) {
                            tmpA[i] = tmpA[i].split(operands[1]).join(tmpC[i]);
                        }
                        return tmpA;
                    }
                    // [],'',''
                    for (let i = 0; i < tmpA.length; i++) {
                        tmpA[i] = tmpA[i].split(operands[1]).join(operands[2]);
                    }
                    return tmpA;
                }
                // '','',''
                return operands[0].split(operands[1]).join(operands[2]);
            case operators.Round:
                return parseFloat(parseFloat(operands[0]).toFixed(parseInt(operands[1])));
            case operators.RTrim:
                if (tmp) return _.map(tmp, (v) => v === null ? null : String(v).replace(/\s+$/, ''));
                return operands[0] === null ? null : String(operands[0]).replace(/\s+$/, '');
            case operators.Substr:
                let start = parseInt(operands[1]) || 0,
                    length = parseInt(operands[2]);
                if (length === 0) return '';
                if (length < 0) {
                    length = Math.abs(length);
                    start -= length;
                    return String(operands[0]).substr(start, length)
                }
                if (length > 0) {
                    return String(operands[0]).substr(start, length);
                }
                return String(operands[0]).substr(start);
            case operators.TotalChanges:
                return state.bshields.jsql.db.totalChanges;
            case operators.Trim:
                if (tmp) return _.map(tmp, (v) => v === null ? null : String(v).replace(/^\s*(.*)\s*$/, '$1'));
                return operands[0] === null ? null : String(operands[0]).replace(/^\s*(.*)\s*$/, '$1');
            case operators.Typeof:
                if (tmp) return _.map(tmp, (v) => {
                    if (v === null) return 'null';
                    if (_.isString(v)) return 'text';
                    if (parseInt(v) === parseFloat(v)) return 'integer';
                    if (!isNaN(parseFloat(v))) return 'real';
                    return 'blob';
                });
                if (operands[0] === null) return 'null';
                if (_.isString(operands[0])) return 'text';
                if (parseInt(operands[0]) === parseFloat(operands[0])) return 'integer';
                if (!isNaN(parseFloat(operands[0]))) return 'real';
                return 'blob';
            case operators.Upper:
                if (tmp) return _.map(tmp, (v) => v === null ? null : String(v).toUpperCase());
                return operands[0] === null ? null : String(operands[0]).toUpperCase();
            
            default:
                throw new Error(`unrecoverable state: ${JSON.stringify(expr.operation)}`);
        }
    }
    
    function deepCopyArrayFix(source) {
        var result;
        if (source[0]) {
            result = [];
            _.each(source, (v, i) => { result[i] = v; });
        } else {
            result = source;
        }
        
        _.each(result, (v, k) => {
            if (typeof v === 'object') result[k] = deepCopyArrayFix(v);
        });
        return result;
    }
    
    // Deep Copy code from http://www.oranlooney.com/deep-copy-javascript/
    function Clone() {}
	function clone(target) {
		if ( typeof target == 'object' ) {
			Clone.prototype = target;
			return new Clone();
		} else {
			return target;
		}
	}

	var deepCopiers = [];

	function DeepCopier(config) {
		for ( var key in config ) this[key] = config[key];
	}
	DeepCopier.prototype = {
		constructor: DeepCopier,
		canCopy: function(source) { return false; },
		create: function(source) { },
		populate: function(deepCopyAlgorithm, source, result) {}
	};

	function DeepCopyAlgorithm() {
		this.copiedObjects = [];
		let thisPass = this;
		this.recursiveDeepCopy = function(source) { return thisPass.deepCopy(source); }
		this.depth = 0;
	}
	DeepCopyAlgorithm.prototype = {
		constructor: DeepCopyAlgorithm,
		maxDepth: 256,
			
		cacheResult: function(source, result) { this.copiedObjects.push([source, result]); },
		getCachedResult: function(source) {
			var copiedObjects = this.copiedObjects;
			var length = copiedObjects.length;
			for ( var i=0; i<length; i++ ) {
				if ( copiedObjects[i][0] === source ) {
					return copiedObjects[i][1];
				}
			}
			return undefined;
		},
		
		deepCopy: function(source) {
			if ( source === null ) return null;
			if ( typeof source !== 'object' ) return source;

			var cachedResult = this.getCachedResult(source);
			if ( cachedResult ) return cachedResult;

			for ( var i=0; i<deepCopiers.length; i++ ) {
				var deepCopier = deepCopiers[i];
				if ( deepCopier.canCopy(source) ) {
					return this.applyDeepCopier(deepCopier, source);
				}
			}
			throw new Error("no DeepCopier is able to copy " + source);
		},

		applyDeepCopier: function(deepCopier, source) {
			var result = deepCopier.create(source);
			this.cacheResult(source, result);
			this.depth++;
			if ( this.depth > this.maxDepth ) {
				throw new Error("Exceeded max recursion depth in deep copy.");
			}

			deepCopier.populate(this.recursiveDeepCopy, source, result);
			this.depth--;
			return result;
		}
	};

	function deepCopy(source, maxDepth) {
		var deepCopyAlgorithm = new DeepCopyAlgorithm();
		if ( maxDepth ) deepCopyAlgorithm.maxDepth = maxDepth;
		return deepCopyAlgorithm.deepCopy(source);
	}

	deepCopy.DeepCopier = DeepCopier;
	deepCopy.deepCopiers = deepCopiers;
	deepCopy.register = function(deepCopier) {
		if ( !(deepCopier instanceof DeepCopier) ) deepCopier = new DeepCopier(deepCopier);
		deepCopiers.unshift(deepCopier);
	}

	// Generic Object copier
	deepCopy.register({
		canCopy: function(source) { return true; },
		create: function(source) {
			if ( source instanceof source.constructor ) return clone(source.constructor.prototype);
			else return {};
		},
		populate: function(deepCopy, source, result) {
			for ( var key in source ) {
				if ( source.hasOwnProperty(key) ) result[key] = deepCopy(source[key]);
			}
			return result;
		}
	});
	// Array copier
	deepCopy.register({
		canCopy: function(source) { return Object.prototype.toString.call(source) === '[object Array]'; },
		create: function(source) { return new source.constructor(); },
		populate: function(deepCopy, source, result) {
			for ( var i=0; i<source.length; i++) {
				result.push( deepCopy(source[i]) );
			}
			return result;
		}
	});
	// Date copier
	deepCopy.register({
		canCopy: function(source) { return ( source instanceof Date ); },
		create: function(source) { return new Date(source); }
	});
    
    function buildSql() {
        var cls = {
            globalTypeHandlers: [],
            DefaultOptions: {
                typeHandlers: [],
                autoincrementStartValue: 1,
                createTableIfNotExists: true,
                dropTableIfExists: true,
                createTriggerIfNotExists: true,
                dropTriggerIfNotExists: true,
                useTransaction: null
            },
            
            registerTypeHandler: function(type, handler) {
                registerTypeHandler(type, handler, cls.globalTypeHandlers);
            },
            getTypeHandler: function(type, handlers) {
                return getTypeHandler(type, cls.globalTypeHandlers, handlers);
            },
            getHandlerFor: function(value, handlers) {
                return getHandlerFor(value, cls.globalTypeHandlers, handlers);
            },
            uuid: uuid,
            evaluate: function(expr, tables) {
                return evaluateExpression(expr, tables, cls);
            },
            deepCopy: deepCopy
        };
        
        cls.registerTypeHandler('number', (v) => parseFloat(v));
        cls.registerTypeHandler('string', (v) => '' + v);
        cls.registerTypeHandler('boolean', (v) => !!v);
        cls.registerTypeHandler('object', (v) => v);
        cls.registerTypeHandler(Date, (v) => new Date(v));
        
        /***********************************************************************
         * Base classes
         **********************************************************************/
        cls.Cloneable = class Cloneable {
            clone() {
                
            }
        };
        
        cls.BaseBuilder = class BaseBuilder extends cls.Cloneable {
            constructor(options) {
                super();
                Object.defineProperty(this, 'options', {
                    writable: true,
                    enumerable: false,
                    configurable: false,
                    value: _.extend({}, cls.DefaultOptions, options || {})
                })
            }
            
            tap(callback) {
                callback.apply(this, _.rest(arguments));
                return this;
            }
        };
        
        /***********************************************************************
         * Expressions
         **********************************************************************/
        cls.Expression = class Expression extends cls.BaseBuilder {
            constructor(expr, options) {
                super(options);
                this.operation = null;
                if (expr) {
                    this.identity(expr);
                }
            }
            
            identity(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Identity,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return this;
                }
            }
            
            negate(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Negate,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).negate(this);
                }
            }
            
            bitNot(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.BitNot,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitNot(this);
                }
            }
            
            not(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Not,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).not(this);
                }
            }
            
            plus(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Plus,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).plus(this, expr1);
                }
            }
            
            minus(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Minus,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).minus(this, expr1);
                }
            }
            
            multiply(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Multiply,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).multiply(this, expr1);
                }
            }
            
            divide(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Divide,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).divide(this, expr1);
                }
            }
            
            modulus(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Modulus,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).modulus(this, expr1);
                }
            }
            
            bitOr(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.BitOr,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitOr(this, expr1);
                }
            }
            
            bitAnd(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.BitAnd,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitAnd(this, expr1);
                }
            }
            
            bitLeft(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.BitLeft,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitLeft(this, expr1);
                }
            }
            
            bitRight(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.BitRight,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitRight(this, expr1);
                }
            }
            
            or(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Or,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).or(this, expr1);
                }
            }
            
            and(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.And,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).and(this, expr1);
                }
            }
            
            lessThan(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.LessThan,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).lessThan(this, expr1);
                }
            }
            
            lessThanEquals(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.LessThanEqual,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).lessThanEquals(this, expr1);
                }
            }
            
            greaterThan(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.GreaterThan,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).greaterThan(this, expr1);
                }
            }
            
            greaterThanEquals(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.GreaterThanEqual,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).greaterThanEquals(this, expr1);
                }
            }
            
            equals(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Equal,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).equals(this, expr1);
                }
            }
            
            notEqualTo(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.NotEqual,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).notEqualTo(this, expr1);
                }
            }
            
            is(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Is,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).is(this, expr1);
                }
            }
            
            isNot(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.IsNot,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).isNot(this, expr1);
                }
            }
            
            in(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.In,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).in(this, expr1);
                }
            }
            
            notIn(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.NotIn,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).notIn(this, expr1);
                }
            }
            
            like(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Like,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).like(this, expr1);
                }
            }
            
            notLike(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.NotLike,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).notLike(this, expr1);
                }
            }
            
            glob(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Glob,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).glob(this, expr1);
                }
            }
            
            notGlob(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.NotGlob,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).notGlob(this, expr1);
                }
            }
            
            regex(expr, regex) {
                if (regex !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Regex,
                        operands: [expr, regex]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).regex(this, expr);
                }
            }
            
            avg(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Average,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.operands)).avg(this);
                }
            }
            
            count(expr) {
                var operands = [];
                if (expr !== undefined) operands.push(expr);
                else operands.push('*');
                this.operation = {
                    operator: cls.Expression.Operator.Count,
                    operands: operands
                };
                return this;
            }
            
            groupConcat(expr, separator) {
                separator = separator || ',';
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.GroupConcat,
                        operands: [expr, separator]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).groupConcat(this, separator);
                }
            }
            
            max(expr) {
                var operator = cls.Expression.Operator.Max, operands = [expr];
                if (arguments.length > 1) {
                    operator = cls.Expression.Operator.MMax;
                    operands = _.toArray(arguments);
                }
                
                if (expr !== undefined) {
                    this.operation = {
                        operator: operator,
                        operands: operands
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).max(this);
                }
            }
            
            min(expr) {
                var operator = cls.Expression.Operator.Min, operands = [expr];
                if (arguments.length > 1) {
                    operator = cls.Expression.Operator.MMin;
                    operands = _.toArray(arguments);
                }
                
                if (expr !== undefined) {
                    this.operation = {
                        operator: operator,
                        operands: operands
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).min(this);
                }
            }
            
            sum(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Sum,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).sum(this);
                }
            }
            
            total(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Total,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).total(this);
                }
            }
            
            abs(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Abs,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).abs(this);
                }
            }
            
            changes() {
                this.operation = {
                    operator: cls.Expression.Operator.Changes,
                    operands: []
                };
                return this;
            }
            
            char() {
                this.operation = {
                    operator: cls.Expression.Operator.Char,
                    operands: _.toArray(arguments)
                };
                return this;
            }
            
            coalesce() {
                if (arguments.length < 2) throw new Error('coalesce must have at least two arguments');
                this.operation = {
                    operator: cls.Expression.Operator.Coalesce,
                    operands: _.toArray(arguments)
                };
                return this;
            }
            
            ifnull(expr1, expr2) {
                if (expr2 !== undefined) {
                    return this.coalesce(expr1, expr2);
                } else {
                    return (new cls.Expression(null, this.options)).ifnull(this, expr1);
                }
            }
            
            lastInsertRowid() {
                this.operation = {
                    operator: cls.Expression.Operator.LastInsertRowid,
                    operands: []
                };
                return this;
            }
            
            length(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Length,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).length(this);
                }
            }
            
            lower(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Lower,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).lower(this);
                }
            }
            
            ltrim(expr, charset) {
                charset = charset || '\s';
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.LTrim,
                        operands: [expr, charset]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).ltrim(this, charset);
                }
            }
            
            nullif(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Nullif,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).nullif(this, expr1);
                }
            }
            
            random() {
                this.operation = {
                    operator: cls.Expression.Operator.Random,
                    operands: []
                };
                return this;
            }
            
            replace(needle, replace, expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Replace,
                        operands: [expr, needle, replace]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).replace(needle, replace, this);
                }
            }
            
            round(expr, digits) {
                digits = digits || 0;
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Round,
                        operands: [expr, digits]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).replace(this, digits);
                }
            }
            
            rtrim(expr, charset) {
                charset = charset || '\s';
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.RTrim,
                        operands: [expr, charset]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).rtrim(this, charset);
                }
            }
            
            substr(start, length, expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Substr,
                        operands: [expr, start, length]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).substr(start, length, this);
                }
            }
            
            totalChanges() {
                this.operation = {
                    operator: cls.Expression.Operator.TotalChanges,
                    operands: []
                };
                return this;
            }
            
            trim(expr, charset) {
                charset = charset || '\s';
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Trim,
                        operands: [expr, charset]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).trim(this, charset);
                }
            }
            
            typeof(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Typeof,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).typeof(this);
                }
            }
            
            upper(expr) {
                if (expr !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.Upper,
                        operands: [expr]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).upper(this);
                }
            }
        };
        cls.Expression.parse = function parse(str, options) {
            // TODO: implement
        };
        cls.Expression.Operator = {
            // unary math
            Identity: {},           // +a
            Negate: {},             // -a
            // unary bitwise
            BitNot: {},             // ~a
            // unary logic
            Not: {},                // !a, NOT a
            
            // binary math
            Plus: {},               // a + b
            Minus: {},              // a - b
            Multiply: {},           // a * b
            Divide: {},             // a / b
            Modulus: {},            // a % b
            // binary bitwise
            BitOr: {},              // a | b
            BitAnd: {},             // a & b
            BitLeft: {},            // a << b
            BitRight: {},           // a >> b
            // binary logic
            Or: {},                 // a || b, a OR b
            And: {},                // a && b, a AND b
            LessThan: {},           // a < b
            LessThanEqual: {},      // a <= b
            GreaterThan: {},        // a > b
            GreaterThanEqual: {},   // a >= b
            Equal: {},              // a = b, a == b
            NotEqual: {},           // a != b, a <> b
            Is: {},                 // a IS b
            IsNot: {},              // a IS NOT b
            In: {},                 // a IN b
            NotIn: {},              // a NOT IN b
            Like: {},               // a LIKE b ; case-insensitive, %: /[\w0-9]*/, _: /[\w0-9]/
            NotLike: {},            // a NOT LIKE b
            Glob: {},               // a GLOB b ; case-sensitive, *: /[\w0-9]*/, ?: /[\w0-9]/
            NotGlob: {},            // a NOT GLOB b
            Regex: {},              // a REGEX r
            
            // aggregate functions
            Average: {},
            Count: {},
            GroupConcat: {},
            Max: {},
            Min: {},
            Sum: {},
            Total: {},
            
            // core functions
            Abs: {},
            Changes: {},
            Char: {},
            Coalesce: {},
            IfNull: {},
            LastInsertRowid: {},
            Length: {},
            Lower: {},
            LTrim: {},
            MMax: {},
            MMin: {},
            NullIf: {},
            Random: {},
            Replace: {},
            Round: {},
            RTrim: {},
            Substr: {},
            TotalChanges: {},
            Trim: {},
            Typeof: {},
            Upper: {}
        };
        _.each(cls.Expression.Operator, (v, op) => { v.name = op; });
        Object.freeze(cls.Expression.Operator);
        
        /***********************************************************************
         * Building blocks
         **********************************************************************/
        cls.Block = class Block extends cls.BaseBuilder {
            constructor(options) { super(options); }
            
            exposedMethods() {
                var ret = {},
                    obj = this;
                
                while (obj) {
                    _.chain(Object.getOwnPropertyNames(obj))
                     .filter((p) => p.indexOf('pub_') === 0)
                     .map((p) => p.substr(4))
                     .each((p) => { ret[p] = obj[`pub_${p}`]; });
                    obj = Object.getPrototypeOf(obj);
                }
                return ret;
            }
        };
        
        cls.StringBlock = class StringBlock extends cls.Block {
            constructor(str, options) {
                super(options);
                this.str = str;
            }
        };
        
        cls.AbstractTableBlock = class AbstractTableBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.tables = [];
            }
        };
        
        cls.SingleTableBlock = class SingleTableBlock extends cls.AbstractTableBlock {
            constructor(table, alias, options) {
                var qualifiedName = parseQualifiedName(table);
                super(options);
                this.tables.push({
                    schema: qualifiedName.schema || null,
                    table: qualifiedName.table,
                    alias: (qualifiedName.alias || alias) || null
                });
            }
        };
        
        cls.MultipleTableBlock = class MultipleTableBlock extends cls.AbstractTableBlock {
            constructor(options) { super(options); }
            
            pub_from(table, alias) {
                var qualifiedName = parseQualifiedName(table);
                this.tables.push({
                    schema: qualifiedName.schema || null,
                    table: qualifiedName.table,
                    alias: (qualifiedName.alias || alias) || null
                });
            }
        };
        
        cls.AbstractFieldBlock = class AbstractFieldBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.fields = [];
            }
        };
        
        cls.CreateFieldBlock = class CreateFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_field(name, typeHandler, autoincrement, options) {
                var isNumeric = typeHandler === Number || (typeof typeHandler === 'string' && typeHandler.toLowerCase() === 'number');
                options = _.extend({}, this.options, options || {});
                
                if (typeof typeHandler === 'string') {
                    typeHandler = cls.getTypeHandler(typeHandler.toLowerCase(), options.typeHandlers);
                } else if (typeHandler === Number) {
                    typeHandler = cls.getTypeHandler('number', options.typeHandlers);
                } else if (typeHandler === String) {
                    typeHandler = cls.getTypeHandler('string', options.typeHandlers);
                } else if (typeHandler === Boolean) {
                    typeHandler = cls.getTypeHandler('boolean', options.typeHandlers);
                } else if (typeHandler === Object) {
                    typeHandler = cls.getTypeHandler('object', options.typeHandlers);
                } else if (typeHandler === Date) {
                    typeHandler = cls.getTypeHandler(Date);
                } else if (typeof typeHandler === 'function') {
                    try { typeHandler = cls.getHandlerFor(new typeHandler.constructor(), options.typeHandlers); }
                    catch (e) {}
                } else {
                    typeHandler = undefined;
                }
                
                this.fields.push({
                    name: name,
                    type: typeHandler,
                    autoincrement: !!autoincrement && isNumeric,
                    index: options.autoincrementStartValue
                });
            }
        };
        
        cls.DropFieldBlock = class DropFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_drop(name) { this.fields.push(name); }
        };
        
        cls.SetFieldBlock = class SetFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) {
                super(options);
                this.values = [];
            }
            
            // field(String)
            // field(String, obj)
            pub_field(name, value) {
                if (_.isString(name)) {
                    this.fields.push(name);
                    if (value !== undefined) {
                        this.values.push(value);
                    }
                } else {
                    throw new Error(`Expected string but got ${typeof name}`);
                }
            }
            
            // value(obj)
            pub_value(value) {
                if (value !== undefined) {
                    this.values.push(value);
                } else {
                    throw new Error('Must supply a value');
                }
            }
            
            // fields(Array{String})
            // fields(Array{String}, Array{obj})
            // fields(Object)
            // fields(...String)
            pub_fields(names, values) {
                if (_.isArray(names)) {
                    if (!_.every(names, (n) => _.isString(n))) {
                        throw new Error('Names must be an array of strings');
                    }
                    Array.prototype.push.apply(this.fields, names);
                    
                    if (_.isArray(values)) {
                        if (values.length !== names.length) {
                            throw new Error('names and values arrays must be same length');
                        }
                        Array.prototype.push.apply(this.values, values);
                    }
                } else if (_.isObject(names)) {
                    _.each(names, (v, n) => {
                        this.fields.push(n);
                        this.values.push(v);
                    });
                } else {
                    if (!_.every(arguments, (n) => _.isString(n))) {
                        throw new Error('Arguments must all be strings');
                    }
                    Array.prototype.push.apply(this.fields, arguments);
                }
            }
            
            // values(Array{obj})
            // values(...obj)
            pub_values(values) {
                if (_.isArray(values)) {
                    Array.prototype.push.apply(this.values, values);
                } else {
                    Array.prototype.push.apply(this.values, arguments);
                }
            }
        };
        
        cls.ChangeFieldBlock = class ChangeFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_renameField(from, to) {
                this.fields.push({
                    field: from,
                    to: to
                });
            }
            
            pub_incrementField(field, increment) {
                this.fields.push({
                    field: field,
                    increment: !!increment
                });
            }
            
            pub_resetFieldIndex(field, index, options) {
                options = _.extend({}, this.options, options || {});
                index = parseInt(index);
                if (isNaN(index)) index = options.autoincrementStartValue;
                this.fields.push({
                    field: field,
                    index: index
                });
            }
            
            pub_changeFieldType(field, typeHandler, options) {
                var isNumeric = typeHandler === Number || (typeof typeHandler === 'string' && typeHandler.toLowerCase() === 'number');
                options = _.extend({}, this.options, options || {});
                
                if (typeof typeHandler === 'string') {
                    typeHandler = cls.getTypeHandler(typeHandler.toLowerCase(), options.typeHandlers);
                } else if (typeHandler === Number) {
                    typeHandler = cls.getTypeHandler('number', options.typeHandlers);
                } else if (typeHandler === String) {
                    typeHandler = cls.getTypeHandler('string', options.typeHandlers);
                } else if (typeHandler === Boolean) {
                    typeHandler = cls.getTypeHandler('boolean', options.typeHandlers);
                } else if (typeHandler === Object) {
                    typeHandler = cls.getTypeHandler('object', options.typeHandlers);
                } else if (typeHandler === Date) {
                    typeHandler = cls.getTypeHandler(Date);
                } else if (typeof typeHandler === 'function') {
                    try { typeHandler = cls.getHandlerFor(new typeHandler.constructor(), options.typeHandlers); }
                    catch (e) {}
                } else {
                    typeHandler = undefined;
                }
                typeHandler = typeHandler.toString();
                
                this.fields.push({
                    field: field,
                    type: typeHandler
                });
            }
        };
        
        cls.GetFieldBlock = class GetFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_field(name, alias) {
                var qualifiedName = parseQualifiedName(name, true);
                this.fields.push({
                    schema: qualifiedName.schema || null,
                    table: qualifiedName.table || null,
                    field: qualifiedName.field,
                    alias: (qualifiedField.alias || alias) || null
                });
            }
        };
        
        cls.GroupByBlock = class GroupByBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_groupBy(field, desc) {
                var qualifiedName = parseQualifiedName(name, true);
                this.fields.push({
                    schema: qualifiedName.schema || null,
                    table: qualifiedName.table || null,
                    field: qualifiedName.field,
                    alias: (qualifiedField.alias || alias) || null,
                    descending: !!desc
                });
            }
        };
        
        cls.RenameTableBlock = class RenameTableBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.table = null;
            }
            
            pub_rename(tableName) {
                if (this.table) {
                    throw new Error('rename may only be called once');
                }
                this.table = '' + tableName;
            }
        };
        
        cls.WhereBlock = class WhereBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.conditions = [];
            }
            
            pub_where(expr) {
                if (expr instanceof cls.Expression) {
                    this.conditions.push(expr);
                } else if (expr instanceof String) {
                    this.conditions.push(cls.Expression.parse(expr, this.options));
                } else if (arguments.length > 1) {
                    _.each(arguments, (a) => { this.pub_where(a); });
                } else {
                    this.conditions.push(new cls.Expression(expr, this.options));
                }
            }
        };
        
        cls.OrderByBlock = class OrderByBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            orderBy(field, descending) {
                field = parseQualifiedName(field, true);
                descending = !!descending;
                this.fields.push({
                    table: field.table || null,
                    field: field.field,
                    descending: descending
                });
            }
        };
        
        cls.AbstractNumberBlock = class AbstractNumberBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.value = null;
            }
        };
        
        cls.LimitBlock = class LimitBlock extends cls.AbstractNumberBlock {
            constructor(options) { super(options); }
            
            pub_limit(limit) { this.value = limit instanceof cls.Expression ? limit : parseInt(limit); }
        };
        
        cls.OffsetBlock = class OffsetBlock extends cls.AbstractNumberBlock {
            constructor(options) { super(options); }
            
            pub_offset(offset) { this.value = offset instanceof cls.Expression ? offset : parseInt(offset); }
        };
        
        cls.SubqueryBlock = class SubqueryBlock extends cls.Block {
            constructor(qbWhitelist, queryLimit, options) {
                super(options);
                this.whitelist = qbWhitelist;
                this.queryLimit = queryLimit;
                this.queries = [];
            }
            
            pub_sub(qb) {
                if (this.queries.length === this.queryLimit) {
                    throw new Error('Subquery limit reached');
                }
                if (!(qb instanceof cls.QueryBuilder)) {
                    throw new Error('Not a subquery');
                }
                if (!_.any(this.whitelist, (w) => qb instanceof w)) {
                    throw new Error('Subquery type is not whitelisted');
                }
                this.queries.push(qb);
            }
        };
        
        cls.JoinBlock = class JoinBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.joins = [];
            }
            
            pub_join(table, joinType) {
                var join = { constraints: [] };
                if (!_.isString(table)) {
                    throw new Error(`Expected string, got ${typeof table}`);
                }
                join.table = table;
                
                if (joinType) {
                    if (_.contains(cls.JoinBlock.Type, joinType)) {
                        join.type = joinType;
                    } else if (_.isString(joinType)) {
                        joinType = joinType.toLowerCase();
                        switch (joinType) {
                            case 'inner':
                                join.type = cls.JoinBlock.Type.Inner;
                                break;
                            case 'left':
                                join.type = cls.JoinBlock.Left;
                                break;
                            case 'right':
                                join.type = cls.JoinBlock.Right;
                                break;
                            case 'full':
                                join.type = cls.JoinBlock.Full;
                                break;
                            case 'cross':
                                join.type = cls.JoinBlock.Cross;
                                break;
                            default:
                                throw new Error(`Unknown join type: ${joinType}`);
                        }
                    } else {
                        throw new Error(`Expected string or join type but found ${typeof joinType}`);
                    }
                }
                
                if(this.joins.length && !this.joins[this.joins.length - 1].constraints.length) {
                    this.joins[this.joins.length - 1].constraints.push(new cls.Expression(true));
                }
                this.joins.push(join);
            }
            
            pub_leftJoin(table) { this.pub_join(table, 'left'); }
            
            pub_rightJoin(table) { this.pub_join(table, 'right'); }
            
            pub_innerJoin(table) { this.pub_join(table, 'inner'); }
            
            pub_fullJoin(table) { this.pub_join(table, 'full'); }
            
            pub_crossJoin(table) { this.pub_join(table, 'cross'); }
            
            pub_on(expr) {
                if (this.joins.length === 0) {
                    throw new Error('must call join before on');
                }
                
                if (expr instanceof cls.Expression) {
                    this.joins[this.joins.length - 1].constraints.push(expr);
                } else if (_.isString(expr)) {
                    this.joins[this.joins.length - 1].constraints.push(cls.Expression.parse(expr));
                } else {
                    this.joins[this.joins.length - 1].contraints.push(new cls.Expression(expr));
                }
            }
        };
        cls.JoinBlock.Type = {
            Inner: {},
            Left: {},
            Right: {},
            Full: {},
            Cross: {}
        };
        Object.freeze(cls.JoinBlock.Type);
        
        cls.TriggerEventBlock = class TriggerEventBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.when = null;
                this.action = null;
                this.columns = null;
            }
            
            pub_after(action) {
                var columns = _.rest(arguments);
                this.when = cls.TriggeredEventBlock.When.After;
                if (action && _.isString(action)) {
                    action = action.toLowerCase();
                    switch (action) {
                        case 'delete':
                            this.action = cls.TriggeredEventBlock.Action.Delete;
                            break;
                        case 'insert':
                            this.action = cls.TriggeredEventBlock.Action.Insert;
                            break;
                        case 'update':
                            this.action = cls.TriggeredEventBlock.Action.Update;
                            if (columns.length && _.every(columns, (c) => _.isString(c))) {
                                this.columns = columns;
                            }
                            break;
                    }
                } else if (_.contains(cls.TriggeredEventBlock.Action, action)) {
                    this.action = action;
                    if (this.action === cls.TriggeredEventBlock.Action.Update && columns.length && _.every(columns, (c) => _.isString(c))) {
                        this.columns = columns;
                    }
                }
            }
            
            pub_before(action) {
                var columns = _.rest(arguments);
                this.when = cls.TriggeredEventBlock.When.Before;
                if (action && _.isString(action)) {
                    action = action.toLowerCase();
                    switch (action) {
                        case 'delete':
                            this.action = cls.TriggeredEventBlock.Action.Delete;
                            break;
                        case 'insert':
                            this.action = cls.TriggeredEventBlock.Action.Insert;
                            break;
                        case 'update':
                            this.action = cls.TriggeredEventBlock.Action.Update;
                            if (columns.length && _.every(columns, (c) => _.isString(c))) {
                                this.columns = columns;
                            }
                            break;
                    }
                } else if (_.contains(cls.TriggeredEventBlock.Action, action)) {
                    this.action = action;
                    if (this.action === cls.TriggeredEventBlock.Action.Update && columns.length && _.every(columns, (c) => _.isString(c))) {
                        this.columns = columns;
                    }
                }
            }
            
            pub_instead(action) {
                var columns = _.rest(arguments);
                this.when = cls.TriggeredEventBlock.When.Instead;
                if (action && _.isString(action)) {
                    action = action.toLowerCase();
                    switch (action) {
                        case 'delete':
                            this.action = cls.TriggeredEventBlock.Action.Delete;
                            break;
                        case 'insert':
                            this.action = cls.TriggeredEventBlock.Action.Insert;
                            break;
                        case 'update':
                            this.action = cls.TriggeredEventBlock.Action.Update;
                            if (columns.length && _.every(columns, (c) => _.isString(c))) {
                                this.columns = columns;
                            }
                            break;
                    }
                } else if (_.contains(cls.TriggeredEventBlock.Action, action)) {
                    this.action = action;
                    if (this.action === cls.TriggeredEventBlock.Action.Update && columns.length && _.every(columns, (c) => _.isString(c))) {
                        this.columns = columns;
                    }
                }
            }
            
            pub_delete(when) {
                this.action = cls.TriggeredEventBlock.Action.Delete;
                if (when && _.isString(when)) {
                    when = when.toLowerCase();
                    switch(when) {
                        case 'before':
                            this.when = cls.TriggeredEventBlock.When.Before;
                            break;
                        case 'after':
                            this.when = cls.TriggeredEventBlock.When.After;
                            break;
                        case 'instead':
                        case 'instead of':
                            this.when = cls.TriggeredEventBlock.When.Instead;
                            break;
                    }
                } else if (_.contains(cls.TriggeredEventBlock.When, when)) {
                    this.when = when;
                }
            }
            
            pub_insert(when) {
                this.action = cls.TriggeredEventBlock.Action.Insert;
                if (when && _.isString(when)) {
                    when = when.toLowerCase();
                    switch(when) {
                        case 'before':
                            this.when = cls.TriggeredEventBlock.When.Before;
                            break;
                        case 'after':
                            this.when = cls.TriggeredEventBlock.When.After;
                            break;
                        case 'instead':
                        case 'instead of':
                            this.when = cls.TriggeredEventBlock.When.Instead;
                            break;
                    }
                } else if (_.contains(cls.TriggeredEventBlock.When, when)) {
                    this.when = when;
                }
            }
            
            pub_update(when) {
                var columns = _.rest(arguments);
                if (when && _.isString(when)) {
                    switch (when.toLowerCase()) {
                        case 'before':
                            this.when = cls.TriggeredEventBlock.When.Before;
                            break;
                        case 'after':
                            this.when = cls.TriggeredEventBlock.When.After;
                            break;
                        case 'instead':
                        case 'instead of':
                            this.when = cls.TriggeredEventBlock.When.Instead;
                            break;
                        default:
                            columns = _.toArray(arguments);
                            break;
                    }
                } else if (_.contains(cls.TriggeredEventBlock.When, when)) {
                    this.when = when;
                }
                
                if (_.every(columns, (c) => _.isString(c))) {
                    this.columns = columns;
                }
            }
            
            pub_beforeDelete() {
                this.pub_before();
                this.pub_delete();
            }
            
            pub_afterDelete() {
                this.pub_after();
                this.pub_delete();
            }
            
            pub_insteadOfDelete() {
                this.pub_instead();
                this.pub_delete();
            }
            
            pub_beforeInsert() {
                this.pub_before();
                this.pub_insert();
            }
            
            pub_afterInsert() {
                this.pub_after();
                this.pub_insert();
            }
            
            pub_insteadOfInsert() {
                this.pub_instead();
                this.pub_insert();
            }
            
            pub_beforeUpdate() {
                this.pub_before();
                this.pub_update.apply(this, arguments);
            }
            
            pub_afterUpdate() {
                this.pub_after();
                this.pub_update.apply(this, arguments);
            }
            
            pub_insteadOfUpdate() {
                this.pub_instead();
                this.pub_update.apply(this, arguments);
            }
        };
        cls.TriggerEventBlock.When = {
            Before: {},
            After: {},
            Instead: {}
        };
        Object.freeze(cls.TriggerEventBlock.When);
        cls.TriggerEventBlock.Action = {
            Delete: {},
            Insert: {},
            Update: {}
        };
        Object.freeze(cls.TriggerEventBlock.Action);
        
        cls.FunctionBlock = class FunctionBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.callbacks = [];
            }
            
            function(callback) { this.callbacks.push(callback); }
        };
        
        /***********************************************************************
         * Query builders
         **********************************************************************/
        cls.QueryBuilder = class QueryBuilder extends cls.BaseBuilder {
            /**
             * Create a new QueryBuilder object
             * 
             * @param options Object Options to override global options with
             * @param blocks Array Instances of cls.Block which are valid for this query type
             */
            constructor(options, blocks) {
                super(options);
                Object.defineProperty(this, 'blocks', {
                    enumerable: false,
                    configurable: false,
                    writable: false,
                    value: blocks || []
                })
                
                _.each(this.blocks, (block) => {
                    var exposedMethods = block.exposedMethods();
                    _.each(exposedMethods, (methodBody, methodName) => {
                        if (this[methodName] !== undefined) {
                            throw new Error(`Builder already has a method called: ${methodName}`);
                        }
                        
                        ((block, name, body, self) => {
                            self[name] = function() {
                                body.apply(block, arguments);
                                return self;
                            };
                        })(block, methodName, methodBody, this);
                    }, this);
                }, this);
            }
            
            /**
             * Execute the query that has been built. Must be overriddent to accomplish anything
             * 
             * @param options Object Options to override the query options with
             */
            execute(options) { throw new Error('not implemented'); }
        };
        
        cls.CreateTable = class CreateTable extends cls.QueryBuilder {
            /**
             * jsql.createTable('table')
             *     .field('id', Number)
             *     .field('my_data', 'my_data handler')
             *     .field('custom', function() { ... })
             *     .execute()
             * 
             * @param tableName String Name of the table to create
             * @param ifNotExists boolean Whether to throw an error if the table already exists in the database
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                if (options && options.ifNotExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.createTableIfNotExists = !!options.ifNotExists;
                    delete options.ifNotExists;
                }
                
                super(options, [
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.CreateFieldBlock(options)
                ]);
                this.options.createTableIfNotExists = !!this.options.createTableIfNotExists;
            }
            
            /**
             * Run the create table operation
             * 
             * @param options Object
             * @return `true` if the table was created, `false` otherwise. Note that depending on the values passed to the constructor,
             *         failing to create the table may throw an error.
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let schemaName, tableName, fields;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        tableName = b.tables[0].table;
                        schemaName = b.tables[0].schema || 'default';
                    } else if (b instanceof cls.CreateFieldBlock) {
                        fields = _.map(b.fields, (f) => ({ name: f.name, autoincrement: f.autoincrement, index: f.index, type: f.type.toString() }));
                    }
                });
                
                let db = state.bshields.jsql.db;
                if (!db.schemas[schemaName]) {
                    db.schemas[schemaName] = {};
                }
                if (db.schemas[schemaName][tableName]) {
                    if (!options.createTableIfNotExists) {
                        throw new Error(`Table ${schemaName}.${tableName} already exists`);
                    }
                    // else nop
                    return false;
                } else {
                    db.schemas[schemaName][tableName] = { fields: fields, rows: [] };
                    return true;
                }
            }
        };
        
        cls.AlterTable = class AlterTable extends cls.QueryBuilder {
            /**
             * jsql.alterTable('table')
             *     .rename('table2')
             *     .field('new_field', Object)
             *     .drop('old_field')
             *     .renameField('field1', 'field2')
             *     .incrementField('field', true) // nop if field type isn't numeric
             *     .resetFieldIndex('field', 5)
             *     .changeFieldType('field', Number)
             * 
             * @param tableName String name of the table to modify
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.RenameTableBlock(options),
                    new cls.CreateFieldBlock(options),
                    new cls.DropFieldBlock(options),
                    new cls.ChangeFieldBlock(options)
                ]);
            }
            
            /**
             * Run the alter table operation
             * 
             * @param options Object
             * @return `true` in all non-exceptional cases
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let schemaName, tableName, newTableName, newFields, dropFields, changeFields;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        tableName = b.tables[0].table;
                        schemaName = b.tables[0].schema || 'default';
                    } else if (b instanceof cls.RenameTableBlock) {
                        newTableName = b.table;
                    } else if (b instanceof cls.CreateFieldBlock) {
                        newFields = _.map(b.fields, (f) => ({ name: f.name, autoincrement: f.autoincrement, index: f.index, type: f.type.toString() }));
                    } else if (b instanceof cls.DropFieldBlock) {
                        dropFields = b.fields;
                    } else if (b instanceof cls.ChangeFieldBlock) {
                        changeFields = b.fields;
                    }
                });
                
                let db = state.bshields.jsql.db;
                if (!db.schemas[schemaName]) {
                    throw new Error(`Schema ${schemaName} does not exist`);
                }
                if (!db.schemas[schemaName][tableName]) {
                    throw new Error(`Table ${schemaName}.${tableName} does not exist`);
                }
                
                let table;
                
                // ALTER TABLE `table` RENAME TO `new_table`
                if (newTableName) {
                    db.schemas[schemaName][newTableName] = db.schemas[schemaName][tableName];
                    delete db.schemas[schemaName][tableName];
                    table = db.schemas[schemaName][newTableName];
                } else table = db.schemas[schemaName][tableName];
                
                // ALTER TABLE `table` DROP COLUMN `field`
                _.each(dropFields, (fieldName) => {
                    let i;
                    for (i = 0; i < table.fields.length; i++) {
                        if (table.fields[i].name === fieldName) break;
                    }
                    // if field to drop doesn't exist, these splices won't do anything
                    table.fields.splice(i, 1);
                    _.each(table.rows, (r) => {
                        r.splice(i, 1); // delete the row data in the dropped column
                    });
                });
                
                // ALTER TABLE `table` ADD COLUMN `field` type
                _.each(newFields, (field) => {
                    table.fields.push(field);
                    let idx = field.index;
                    _.each(table.rows, (r) => {
                        if (field.autoincrement) {
                            r.push(idx++);
                        } else {
                            r.push(null);
                        }
                    });
                });
                
                // ALTER TABLE `table` ALTER COLUMN `field` ...
                _.each(changeFields, (changeData) => {
                    let i;
                    for (i = 0; i < table.fields.length; i++) {
                        if (table.fields[i].name === changeData.field) break;
                    }
                    if (i === table.fields.length) {
                        throw new Error(`No field named ${changeData.field}`);
                    }
                    
                    if (changeData.to) {
                        // ... RENAME TO `new_field`
                        table.fields[i].name = changeData.to;
                    } else if (changeData.increment !== undefined) {
                        // ... AUTOINCREMENT // ... NOT AUTOINCREMENT
                        let numberHandler = cls.getTypeHandler('number', options.typeHandlers).toString();
                        if (changeData.increment && table.fields[i].type !== numberHandler) {
                            throw new Error('Cannot set autoincrement property on non-numeric field');
                        }
                        table.fields[i].autoincrement = changeData.increment;
                    } else if (changeData.index !== undefined) {
                        // ... RESET INDEX [TO index]
                        // won't throw any errors, but the value is meaningless if the field isn't autoincrement
                        table.fields[i].index = changeData.index;
                    } else if (changeData.type) {
                        // ... type
                        // throws an error if any rows contain non-null value for this column
                        if (_.any(table.rows, (r) => r[i] !== null)) {
                            throw new Error(`Canmot change type of field ${changeData.field} if any rows have non-null value for that field`);
                        }
                        table.fields[i].type = changeData.type;
                    }
                });
                
                return true;
            }
        };
        
        cls.DropTable = class DropTable extends cls.QueryBuilder {
            /**
             * jsql.dropTable('table').execute()
             * 
             * @param tableName String Name of the table to drop
             * @param ifExists boolean Whether to throw an error if the table already doesn't exist in the database
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                if (options && options.ifExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.dropTableIfExists = !!options.ifExists;
                    delete options.ifExists;
                }
                
                super(options, [
                    new cls.SingleTableBlock(tableName, null, options)
                ]);
                this.options.dropTableIfExists = !!this.options.dropTableIfExists;
            }
            
            /**
             * Run the drop table operation
             * 
             * @param options Object
             * @return `true` if the table was dropped, `false` otherwise. Note that depending on the values passed to the constructor,
             *         failing to drop the table may throw an error.
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let tableName, schemaName;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        tableName = b.tables[0].table;
                        schemaName = b.tables[0].schema || 'default';
                    }
                });
                
                let db = state.bshields.jsql.db;
                if (!(db.schemas[schemaName] && db.schemas[schemaName][tableName])) {
                    if (options.dropTableIfExists) return false;
                    else throw new Error(`Table ${schemaName}.${tableName} does not exist`);
                } else {
                    delete db.schemas[schemaName][tableName];
                    if (schemaName !== 'default' && _.isEmpty(db.schemas[schemaName])) delete db.schemas[schemaName];
                    return true;
                }
            }
        };
        
        cls.Delete = class Delete extends cls.QueryBuilder {
            /**
             * jsql.delete('table')
             *     .where(...expr)
             *     .orderBy('name')
             *     .orderBy('id')
             *     .limit(5)
             *     .offset(3)
             * 
             * @param tableName String Name of the table to delete from
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.WhereBlock(options),
                    new cls.OrderByBlock(options),
                    new cls.LimitBlock(options),
                    new cls.OffsetBlock(options)
                ]);
            }
            
            /**
             * Run the delete operation
             * 
             * @param options Object
             * @return the number of rows deleted
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let tableAlias, tableName, schemaName, conditions, orderBy, limit, offset;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        tableName = b.tables[0].table;
                        schemaName = b.tables[0].schema || 'default';
                        tableAlias = b.tables[0].alias;
                    } else if (b instanceof cls.WhereBlock) {
                        conditions = b.conditions;
                    } else if (b instanceof cls.OrderByBlock) {
                        orderBy = b.fields;
                    } else if (b instanceof cls.LimitBlock) {
                        limit = b.value;
                    } else if (b instanceof cls.OffsetBlock) {
                        offset = b.value;
                    }
                });
                
                let db = state.bshields.jsql.db;
                if (!(db.schemas[schemaName] && db.schemas[schemaName][tableName])) {
                    throw new Error(`No table named ${schemaName}.${tableName}`);
                }
                let table = cls.deepCopy(db.schemas[schemaName][tableName]),
                    tables = () => table;
                
                log(table.rows);
                _.each(conditions, (c) => {
                    let matcher = cls.evaluate(c, tables);
                    table.rows = _.filter(table.rows, (r, i) => !!matcher[i]);
                });
                log(table.rows);
            }
        };
        
        cls.Insert = class Insert extends cls.QueryBuilder {
            /**
             * jsql.insert('table')
             *     .field('f1', 1)
             *     .field('f2')
             *     .value(true)
             *     .fields(['f3', 'f4'])
             *     .fields('f5', 'f6')
             *     .values([1, true])
             *     .values(1, true)
             *     .fields(['f7', 'f8'], [1, true])
             *     .fields({
             *         f9: 1,
             *         f10: true
             *     })
             * 
             * jsql.insert('table')
             *     .sub(jsql.select('table2')...)
             * 
             * All chains off insert() form a single insert operation. Another call to insert() is required to insert another row
             * 
             * @param tableName String Name of the table to insert into
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.SetFieldBlock(options),
                    new cls.SubqueryBlock([cls.Select], 1, options)
                ]);
            }
            
            /**
             * Executes the insert operation
             * 
             * @param options Object
             * @returns 1 in all non-exceptional cases
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let schemaName, tableName, fields, values, subqueryResults;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        tableName = b.tables[0].table;
                        schemaName = b.tables[0].schema || 'default'
                    } else if (b instanceof cls.SetFieldBlock) {
                        fields = b.fields; // array of strings
                        values = b.values; // array of any
                    } else if (b instanceof cls.SubqueryBlock) {
                        subqueryResults = b.queries[0] ? b.queries[0].execute(options) : null;
                    }
                });
                
                let db = state.bshields.jsql.db;
                if (!(db.schemas[schemaName] && db.schemas[schemaName][tableName])) {
                    throw new Error(`No table named ${schemaName}.${tableName}`);
                }
                let table = db.schemas[schemaName][tableName];
                
                if (subqueryResults) {
                    // single subquery overrides fields & values
                    // TODO: Implement subquery stuff
                } else {
                    let tableFieldNames = _.map(table.fields, (f) => f.name);
                    if (!_.all(fields, (fieldName) => _.contains(tableFieldNames, fieldName))) {
                        throw new Error(`All fields to insert [${fields.join(', ')}] must exist in the table [${tableFieldNames.join(', ')}]`);
                    }
                    if (fields.length !== values.length) {
                        throw new Error('Must specify same number of fields and values');
                    }
                    let insertObj = {}, insertRow = [];
                    _.each(table.fields, (f) => {
                        insertObj[f.name] = null;
                    });
                    _.each(fields, (fieldName, i) => {
                        insertObj[fieldName] = values[i];
                    });
                    let rowid = null;
                    _.each(table.fields, (f) => {
                        let typeHandler = handlerStrToFunction(f.type),
                            sv = insertObj[f.name] === null ? null : typeHandler(insertObj[f.name]);
                        
                        if (f.autoincrement) {
                            if (sv === null || insertObj[f.name] === undefined || sv < 0) {
                                insertRow.push(f.index++);
                            } else {
                                insertRow.push(sv);
                                f.index = sv + 1;
                            }
                            
                            if (rowid === null) {
                                rowid = insertRow[insertRow.length - 1];
                            }
                        } else {
                            insertRow.push(sv);
                        }
                    });
                    if (rowid === null) {
                        rowid = cls.uuid();
                    }
                    insertRow.rowid = rowid;
                    
                    table.rows.push(insertRow);
                    db.changes = 1;
                    db.totalChanges++;
                    db.lastRowid = rowid;
                    return 1;
                }
            }
        };
        
        cls.Update = class Update extends cls.QueryBuilder {
            /**
             * jsql.update('table')
             *     .field('f1', 1)
             *     .field('f2')
             *     .value(true)
             *     .fields(['f3', 'f4'])
             *     .fields('f5', 'f6')
             *     .values([1, true])
             *     .values(1, true)
             *     .fields(['f7', 'f8'], [1, true])
             *     .fields({
             *         f9: 1,
             *         f10: true
             *     })
             *     .where(...expr)
             * 
             * @param tableName String Name of the table to update
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.StringBlock(`UPDATE ${tableName}`, options),
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.SetFieldBlock(options),
                    new cls.WhereBlock(options)
                ]);
            }
            
            /**
             * Execute update operation
             * 
             * @param options Object
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
            }
        };
        
        cls.Select = class Select extends cls.QueryBuilder {
            constructor(options) {
                super(options, [
                    new cls.StringBlock(`SELECT`, options),
                    new cls.GetFieldBlock(options),
                    new cls.MultipleTableBlock(options),
                    new cls.SubqueryBlock([cls.Select], options),
                    new cls.JoinBlock(options),
                    new cls.WhereBlock(options),
                    new cls.GroupByBlock(options),
                    new cls.OrderByBlock(options),
                    new cls.LimitBlock(options),
                    new cls.OffsetBlock(options)
                ]);
            }
            
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
            }
        };
        
        /***********************************************************************
         * Transactions
         **********************************************************************/
        cls.Transaction = class Transaction extends cls.Cloneable {
            constructor(options) {
                super();
                Object.defineProperties(this, {
                    options: {
                        writable: false,
                        enumerable: false,
                        configurable: false,
                        value: _.extend({}, cls.DefaultOptions, options || {})
                    },
                    actions: {
                        writable: true,
                        enumerable: false,
                        configurable: false,
                        value: []
                    },
                    isOpen: {
                        writable: true,
                        enumerable: false,
                        configurable: false,
                        value: true
                    }
                });
            }
            
            rollback() { this.actions = []; }
            
            begin() {
                this.actions = [];
                this.isOpen = true;
            }
            
            addAction(action) { this.actions.push(action); }
            
            commit(options) {
                if (!this.isOpen) {
                    throw new Error('Transaction has been completed. Start a new transaction in order to commit again.');
                }
                
                options = options || {};
                if (options.useTransaction === this) {
                    options = _.omit(options, 'useTransaction');
                }
                
                _.each(this.actions, (a) => {
                    a.execute(options);
                });
                this.isOpen = false;
            }
        };
        
        /***********************************************************************
         * Triggers
         **********************************************************************/
        cls.CreateTrigger = class CreateTrigger extends cls.QueryBuilder {
            constructor(triggerName, tableName, options) {
                var qualifiedName;
                
                if (!triggerName || triggerName.length === 0 || triggerName.lastIndexOf('.') === triggerName.length) {
                    throw new Error('trigger name required');
                }
                if (options && options.ifNotExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.createTriggerIfNotExists = !!options.ifNotExists;
                    delete options.ifNotExists;
                }
                
                super(options, [
                    new cls.StringBlock(`CREATE TRIGGER ${triggerName} ON ${tableName}`, options),
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.TriggerEventBlock(options),
                    new cls.FunctionBlock(options)
                ]);
                this.ifNotExists = !!this.options.createTriggerIfNotExists;
                qualifiedName = parseQualifiedName(triggerName);
                this.name = {
                    schema: qualifiedName.schema || null,
                    name: qualifiedName.table
                };
            }
            
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
            }
        };
        
        cls.DropTrigger = class DropTrigger extends cls.QueryBuilder {
            constructor(triggerName, options) {
                var qualifiedName;
                if (!triggerName || triggerName.length === 0 || triggerName.lastIndexOf('.') === triggerName.length) {
                    throw new Error('trigger name required');
                }
                if (options && options.ifExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.dropTriggerIfExists = !!options.ifExists;
                    delete options.ifExists;
                }
                
                super(options, [
                    new cls.StringBlock(`DROP TRIGGER ${triggerName}`, options)
                ]);
                this.ifExists = !!this.options.dropTriggerIfExists;
                qualifiedName = parseQualifiedName(triggerName);
                this.name = {
                    schema: qualifiedName.schema || null,
                    name: qualifiedName.table
                };
            }
            
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
            }
        };
        
        return {
            VERSION: `JSQL Version ${version}`,
            
            // table queries
            createTable: function(tableName, options) { return new cls.CreateTable(tableName, options); },
            alterTable: function(tableName, options) { return new cls.AlterTable(tableName, options); },
            dropTable: function(tableName, options) { return new cls.DropTable(tableName, options); },
            
            // row queries
            delete: function(tableName, options) { return new cls.Delete(tableName, options); },
            insert: function(tableName, options) { return new cls.Insert(tableName, options); },
            select: function(options) { return new cls.Select(options); },
            update: function(tableName, options) { return new cls.Update(tableName, options); },
            
            // meta queries
            transaction: function(options) { return new cls.Transaction(options); },
            createTrigger: function(triggerName, tableName, options) { return new cls.CreateTrigger(triggerName, tableName, options); },
            dropTrigger: function(triggerName, options) { return new cls.DropTrigger(triggerName, options); },
            
            // expressions
            expr: function(expr, options) { return new cls.Expression(expr, options); },
            
            cls: cls
        };
    }
    
    function checkInstall() {
        if (!state.bshields ||
            !state.bshields.jsql ||
            !state.bshields.jsql.version ||
             state.bshields.jsql.version !== version) {
            state.bshields = state.bshields || {};
            state.bshields.jsql = {
                version: version,
                gcUpdated: 0,
                db: {
                    changes: 0,
                    totalChanges: 0,
                    lastRowid: null,
                    schemas: { default: {} }
                }
            };
        }
        checkGlobalConfig();
    }
    
    function checkGlobalConfig() {
        var gc = globalconfig && globalconfig.jsql,
            st = state.bshields.jsql;
        
        if (gc && gc.lastsaved && gc.lastsaved > st.gcUpdated) {
            st.gcUpdated = gc.lastsaved;
            // Pull config values
        }
    }
    
    return {
        checkInstall: checkInstall,
        sql: buildSql()
    };
}());

on('ready', function() {
    bshields.jsql.checkInstall();
});
jsql = jsql || bshields.jsql.sql;