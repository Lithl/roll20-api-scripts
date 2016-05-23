var bshields = bshields || {}, jsql, $, $$;
bshields.jsql = (function() {
    'use strict';
    
    var version = 0.6;
    
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
            return _.map(table.rows, (r) => r.data[idx]);
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
            case operators.BitXor:
                if (tmpA && tmpB) {
                    if (tmpA.length !== tmpB.length) throw new Error('bitXor operands are not of same length');
                    return _.chain(tmpA).zip(tmpB).map((p) => p[0] === null || p[1] === null ? null : parseInt(p[0]) ^ parseInt(p[1])).value();
                } else {
                    if (tmpA) return operands[1] === null ? null : _.map(tmpA, (v) => v === null ? null : parseInt(v) ^ parseInt(operands[1]));
                    if (tmpB) return operands[0] === null ? null : _.map(tmpB, (v) => v === null ? null : parseInt(v) ^ parseInt(operands[0]));
                    return operands[0] === null || operands[1] === null ? null : parseInt(operands[0]) ^ parseInt(operands[1]);
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
                    if (v === !!v) return 'boolean'
                    if (v instanceof Date) return 'date';
                    if (_.isString(v)) return 'text';
                    if (parseInt(v) === parseFloat(v)) return 'integer';
                    if (!isNaN(parseFloat(v))) return 'real';
                    return 'blob';
                });
                if (operands[0] === null) return 'null';
                if (operands[0] === !!operands[0]) return 'boolean';
                if (operands[0] instanceof Date) return 'date';
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
                dropTriggerIfExists: true,
                useTransaction: null,
                selectAsObjects: true,
                triggerParamsAsObjects: true
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
            deepCopy: deepCopy,
            
            toJSON: function() {
                return `registerTypeHandler(type, handler); getTypeHandler(type, handlers); getHandlerFor(value, handlers); uuid(); evaluate(expr, tables); \
deepCopy(source[, maxDepth]); DefaultOptions: ${JSON.stringify(this.DefaultOptions).replace(/"(.+?)":/g, '$1:')}; globalTypeHandlers`;
            }
        };
        
        cls.registerTypeHandler('number', (v) => parseFloat(v));
        cls.registerTypeHandler('string', (v) => '' + v);
        cls.registerTypeHandler('boolean', (v) => !!v);
        cls.registerTypeHandler('object', (v) => v);
        cls.registerTypeHandler(Date, (v) => new Date(v));
        
        /***********************************************************************
         * Base classes
         **********************************************************************/
        cls.Cloneable = class Cloneable { clone() { return cls.deepCopy(this); } };
        
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
            
            bitXor(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operation = {
                        operator: cls.Expression.Operator.BitXor,
                        operands: [expr1, expr2]
                    };
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitXor(this, expr1);
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
                    return (new cls.Expression(null, this.options)).avg(this);
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
            BitXor: {},             // a ^ b
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
        _.each(cls.Expression.Operator, (e, n) => {
            e.name = n;
            e.toJSON = () => `Operator::${e.name}`;
        });
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
                    schema: qualifiedName.schema || 'default',
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
                
                if (!name || !_.isString(name) || name.length === 0) {
                    throw new Error('name must be a string');
                }
                
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
                    catch (e) { throw e; }
                    if (!typeHandler) {
                        throw new Error(`unknown typeHandler ${typeHandler}`);
                    }
                } else {
                    throw new Error(`unknown type handler ${typeHandler}`);
                }
                
                this.fields.push({
                    name: name,
                    type: typeHandler,
                    autoincrement: !!autoincrement && isNumeric,
                    index: parseInt(options.autoincrementStartValue)
                });
            }
            
            pub_fields(fields, options) {
                if (!_.isObject(fields)) throw new Error('fields must be a collection of name:handler pairs');
                _.each(fields, (name, handler) => { this.pub_field(name, handler, false, options); });
            }
        };
        
        cls.DropFieldBlock = class DropFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_drop(name) {
                if(!name || !_.isString(name) || name.length === 0) {
                    throw new Error('name must be non-empty');
                }
                this.fields.push(name);
            }
        };
        
        cls.SetFieldBlock = class SetFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) {
                super(options);
                this.values = [];
            }
            
            // field(String)
            // field(String, obj)
            pub_field(name, value) {
                if (_.isString(name) && name.length > 0) {
                    this.fields.push(name);
                    if (value !== undefined) {
                        this.values.push(value);
                    }
                } else {
                    throw new Error(`Expected non-empty string but got '${typeof name}'`);
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
                if (!names) {
                    throw new Error('must supply at least one field');
                }
                if (_.isArray(names)) {
                    if (!_.every(names, (n) => _.isString(n) && n.length > 0)) {
                        throw new Error('Names must be an array of non-empty strings');
                    }
                    if (names.length === 0) {
                        throw new Error('must supply at least one field');
                    }
                    Array.prototype.push.apply(this.fields, names);
                    
                    if (_.isArray(values)) {
                        if (values.length !== names.length) {
                            throw new Error('names and values arrays must be same length');
                        }
                        Array.prototype.push.apply(this.values, values);
                    }
                } else if (_.isObject(names)) {
                    if (_.keys(names).length === 0) {
                        throw new Error('must supply at least one field');
                    }
                    if (!_.chain(names).keys().every((n) => n.length > 0)) {
                        throw new Error('keys must be non-empty');
                    }
                    
                    _.each(names, (v, n) => {
                        this.fields.push(n);
                        this.values.push(v);
                    });
                } else {
                    if (!_.every(arguments, (n) => _.isString(n) && n.length > 0)) {
                        throw new Error('Arguments must all be non-empty strings');
                    }
                    Array.prototype.push.apply(this.fields, arguments);
                }
            }
            
            // values(Array{obj})
            // values(...obj)
            pub_values(values) {
                if (values === undefined) {
                    throw new Error('must supply a value');
                }
                if (_.isArray(values)) {
                    if (values.length === 0) {
                        throw new Error('must supply a value');
                    }
                    Array.prototype.push.apply(this.values, values);
                } else {
                    Array.prototype.push.apply(this.values, arguments);
                }
            }
        };
        
        cls.ChangeFieldBlock = class ChangeFieldBlock extends cls.AbstractFieldBlock {
            constructor(options) { super(options); }
            
            pub_renameField(from, to) {
                if (!from || !_.isString(from) || from.length === 0) {
                    throw new Error('from field must be non-empty');
                }
                if (!to || !_.isString(to) || to.length === 0) {
                    throw new Error('to field must be non-empty');
                }
                this.fields.push({
                    field: from,
                    to: to
                });
            }
            
            pub_incrementField(field, increment) {
                if (!field || !_.isString(field) || field.length === 0) {
                    throw new Error('field must be non-empty');
                }
                this.fields.push({
                    field: field,
                    increment: !!increment
                });
            }
            
            pub_resetFieldIndex(field, index, options) {
                options = _.extend({}, this.options, options || {});
                index = parseInt(index);
                if (isNaN(index)) index = options.autoincrementStartValue;
                if (!field || !_.isString(field) || field.length === 0) {
                    throw new Error('field must be non-empty');
                }
                this.fields.push({
                    field: field,
                    index: index
                });
            }
            
            pub_changeFieldType(field, typeHandler, options) {
                var isNumeric = typeHandler === Number || (typeof typeHandler === 'string' && typeHandler.toLowerCase() === 'number');
                options = _.extend({}, this.options, options || {});
                
                if (!field || !_.isString(field) || field.length === 0) {
                    throw new Error('field must be non-empty');
                }
                
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
                    catch (e) { throw e; }
                    if (!typeHandler) {
                        throw new Error(`unknown typeHandler ${typeHandler}`);
                    }
                } else {
                    throw new Error(`unknown typeHandler ${typeHandler}`);
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
                    alias: (qualifiedName.alias || alias) || null
                });
            }
            
            pub_fields() {
                if (arguments.length === 0) {
                    throw new Error('must supply a field to query');
                }
                let args = arguments.length === 1 ? arguments[0].trim().split(/\s*,\s*/) : _.map(arguments, (a) => a.trim());
                if (!_.all(args, (a) => _.isString(a) && a.length > 0)) {
                    throw new Error('all fields must be non-empty strings');
                }
                let qualifiedNames = _.map(args, (s) => parseQualifiedName(s, true));
                _.each(qualifiedNames, (qn) => {
                    this.fields.push({
                        schema: qn.schema || null,
                        table: qn.table || null,
                        field: qn.field,
                        alias: qn.alias || null
                    });
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
                if (!tableName || !_.isString(tableName) || tableName.length === 0) {
                    throw new Error('name must be a non-empty string');
                }
                this.table = tableName;
            }
        };
        
        cls.WhereBlock = class WhereBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.conditions = [];
            }
            
            pub_where(expr) {
                if (expr === undefined) {
                    throw new Error('expression is required');
                }
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
            
            pub_orderBy(field, descending) {
                if (!_.isString(field) || field.length === 0) {
                    throw new Error('field is required');
                }
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
            
            pub_limit(limit) {
                if (limit === undefined) {
                    throw new Error('limit is required');
                }
                this.value = limit instanceof cls.Expression ? limit : parseInt(limit);
            }
        };
        
        cls.OffsetBlock = class OffsetBlock extends cls.AbstractNumberBlock {
            constructor(options) { super(options); }
            
            pub_offset(offset) {
                if (offset === undefined) {
                    throw new Error('offset is required');
                }
                this.value = offset instanceof cls.Expression ? offset : parseInt(offset);
            }
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
        _.each(cls.JoinBlock.Type, (t, n) => {
            t.name = n;
            t.ToJSON = () => `Type::${t.name}`;
        })
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
                this.when = cls.TriggerEventBlock.When.After;
                if (action && _.isString(action)) {
                    action = action.toLowerCase();
                    switch (action) {
                        case 'delete':
                            this.action = cls.TriggerEventBlock.Action.Delete;
                            break;
                        case 'insert':
                            this.action = cls.TriggerEventBlock.Action.Insert;
                            break;
                        case 'update':
                            this.action = cls.TriggerEventBlock.Action.Update;
                            if (columns.length && _.every(columns, (c) => _.isString(c) && c.length > 0)) {
                                this.columns = columns;
                            }
                            break;
                        default:
                            throw new Error(`Unknown action ${action}`);
                    }
                } else if (_.contains(cls.TriggerEventBlock.Action, action)) {
                    this.action = action;
                    if (this.action === cls.TriggerEventBlock.Action.Update && columns.length && _.every(columns, (c) => _.isString(c) && c.length > 0)) {
                        this.columns = columns;
                    }
                } else if (action) {
                    throw new Error(`Unknown action ${action}`);
                }
            }
            
            pub_before(action) {
                var columns = _.rest(arguments);
                this.when = cls.TriggerEventBlock.When.Before;
                if (action && _.isString(action)) {
                    action = action.toLowerCase();
                    switch (action) {
                        case 'delete':
                            this.action = cls.TriggerEventBlock.Action.Delete;
                            break;
                        case 'insert':
                            this.action = cls.TriggerEventBlock.Action.Insert;
                            break;
                        case 'update':
                            this.action = cls.TriggerEventBlock.Action.Update;
                            if (columns.length && _.every(columns, (c) => _.isString(c) && c.length > 0)) {
                                this.columns = columns;
                            }
                            break;
                        default:
                            throw new Error(`Unknown action ${action}`);
                    }
                } else if (_.contains(cls.TriggerEventBlock.Action, action)) {
                    this.action = action;
                    if (this.action === cls.TriggerEventBlock.Action.Update && columns.length && _.every(columns, (c) => _.isString(c) && c.length > 0)) {
                        this.columns = columns;
                    }
                } else if (action) {
                    throw new Error(`Unknown action ${action}`);
                }
            }
            
            pub_instead(action) {
                var columns = _.rest(arguments);
                this.when = cls.TriggerEventBlock.When.Instead;
                if (action && _.isString(action)) {
                    action = action.toLowerCase();
                    switch (action) {
                        case 'delete':
                            this.action = cls.TriggerEventBlock.Action.Delete;
                            break;
                        case 'insert':
                            this.action = cls.TriggerEventBlock.Action.Insert;
                            break;
                        case 'update':
                            this.action = cls.TriggerEventBlock.Action.Update;
                            if (columns.length && _.every(columns, (c) => _.isString(c) && c.length > 0)) {
                                this.columns = columns;
                            }
                            break;
                        default:
                            throw new Error(`Unknown action ${action}`);
                    }
                } else if (_.contains(cls.TriggerEventBlock.Action, action)) {
                    this.action = action;
                    if (this.action === cls.TriggerEventBlock.Action.Update && columns.length && _.every(columns, (c) => _.isString(c) && c.length > 0)) {
                        this.columns = columns;
                    }
                } else if (action) {
                    throw new Error(`Unknown action ${action}`);
                }
            }
            
            pub_delete(when) {
                this.action = cls.TriggerEventBlock.Action.Delete;
                if (when && _.isString(when)) {
                    when = when.toLowerCase();
                    switch(when) {
                        case 'before':
                            this.when = cls.TriggerEventBlock.When.Before;
                            break;
                        case 'after':
                            this.when = cls.TriggerEventBlock.When.After;
                            break;
                        case 'instead':
                        case 'instead of':
                            this.when = cls.TriggerEventBlock.When.Instead;
                            break;
                        default:
                            throw new Error(`Unknown timing ${when}`);
                    }
                } else if (_.contains(cls.TriggerEventBlock.When, when)) {
                    this.when = when;
                } else if (when) {
                    throw new Error(`Unknown timing ${when}`);
                }
            }
            
            pub_insert(when) {
                this.action = cls.TriggerEventBlock.Action.Insert;
                if (when && _.isString(when)) {
                    when = when.toLowerCase();
                    switch(when) {
                        case 'before':
                            this.when = cls.TriggerEventBlock.When.Before;
                            break;
                        case 'after':
                            this.when = cls.TriggerEventBlock.When.After;
                            break;
                        case 'instead':
                        case 'instead of':
                            this.when = cls.TriggerEventBlock.When.Instead;
                            break;
                        default:
                            throw new Error(`Unknown timing ${when}`);
                    }
                } else if (_.contains(cls.TriggerEventBlock.When, when)) {
                    this.when = when;
                } else if (when) {
                    throw new Error(`Unknown timing ${when}`);
                }
            }
            
            pub_update(when) {
                var columns = _.rest(arguments);
                this.action = cls.TriggerEventBlock.Action.Update;
                if (when && _.isString(when)) {
                    switch (when.toLowerCase()) {
                        case 'before':
                            this.when = cls.TriggerEventBlock.When.Before;
                            break;
                        case 'after':
                            this.when = cls.TriggerEventBlock.When.After;
                            break;
                        case 'instead':
                        case 'instead of':
                            this.when = cls.TriggerEventBlock.When.Instead;
                            break;
                        default:
                            columns = _.toArray(arguments);
                            break;
                    }
                } else if (_.contains(cls.TriggerEventBlock.When, when)) {
                    this.when = when;
                }
                
                if (_.every(columns, (c) => _.isString(c) && c.length > 0)) {
                    this.columns = columns;
                } else if (columns.length > 0) {
                    throw new Error('columns must be non-empty strings');
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
        _.each(cls.TriggerEventBlock.When, (e, n) => {
            e.name = n;
            e.toJSON = () => `When::${e.name}`;
        });
        Object.freeze(cls.TriggerEventBlock.When);
        cls.TriggerEventBlock.Action = {
            Delete: {},
            Insert: {},
            Update: {}
        };
        _.each(cls.TriggerEventBlock.Action, (a, n) => {
            a.name = n;
            a.toJSON = () => `Action::${a.name}`;
        });
        Object.freeze(cls.TriggerEventBlock.Action);
        
        cls.FunctionBlock = class FunctionBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.callbacks = [];
            }
            
            pub_function(callback) {
                if (_.isString(callback) && !/^(?:function)?\s*\w*\s*\((?:(?:\s*,\s*)?[a-zA-Z_$][a-zA-Z0-9_$]*)*\)\s*(?:=>)?\s*\{?.*\}?$/.test(callback)) {
                    throw new Error('callback string does not represent a function');
                }
                if (!_.isString(callback) && !_.isFunction(callback)) {
                    throw new Error('callback must be function or string');
                }
                this.callbacks.push(callback);
            }
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
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
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
             * @return `true` if the table was created, `false` otherwise. Note that depending on the options values,
             *         failing to create the table may throw an error.
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.ifNotExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.createTableIfNotExists = !!options.ifNotExists;
                    delete options.ifNotExists;
                }
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
                    db.schemas[schemaName] = { triggers: {} };
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
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
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
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
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
             * @return `true` if the table was dropped, `false` otherwise. Note that depending on the options values,
             *         failing to drop the table may throw an error.
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.ifExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.dropTableIfExists = !!options.ifExists;
                    delete options.ifExists;
                }
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
                    _.each(db.schemas[schemaName].triggers, (t, k) => { if (t.table === tablName) delete db.schemas[schemaName].triggers[k]; });
                    if (schemaName !== 'default' && _.keys(db.schemas[schemaName]).length === 1) {
                        if (_.isEmpty(db.schemas[schemaName].triggers)) delete db.schemas[schemaName];
                    }
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
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
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
                
                // where
                _.each(conditions, (c) => {
                    let matches = cls.evaluate(c, tables);
                    table.rows = _.filter(table.rows, (r, i) => !!matches[i]);
                });
                
                // order by
                table.rows = table.rows.sort((a, b) => {
                    var result = null,
                        idxs = _.map(orderBy, (o) => _.map(table.fields, (f) => f.name).indexOf(o.field));
                    _.each(idxs, (j, n) => {
                        if (result !== null) return;
                        if (a.data[j] !== b.data[j]) result = a.data[j] < b.data[j] ? -1 : a.data[j] > b.data[j] ? 1 : 0;
                        if (orderBy[n].descending) result = 1 - result;
                    });
                    return result || 0;
                });
                
                // offset
                if (offset !== null) {
                    table.rows = table.rows.slice(parseInt(offset));
                }
                
                // limit
                if (limit !== null) {
                    table.rows = table.rows.slice(0, parseInt(limit));
                }
                
                let deleteTriggers = _.filter(db.schemas[schemaName].triggers, (t) =>
                        t.table === tableName && t.action === cls.TriggerEventBlock.Action.Delete),
                    beforeDelete = _.filter(deleteTriggers, (t) => t.when === cls.TriggerEventBlock.When.Before),
                    insteadOfDelete = _.filter(deleteTriggers, (t) => t.when === cls.TriggerEventBlock.When.Instead),
                    afterDelete = _.filter(deleteTriggers, (t) => t.when === cls.TriggerEventBlock.When.After);
                _.each(beforeDelete, (t) => _.each(t.callbacks, (c) => c(table.rows)));
                
                let rowsToDelete = _.map(table.rows, (r) => r.rowid),
                    deleteResult;
                if (insteadOfDelete.length > 0) {
                    deleteResult = 0;
                    _.each(insteadOfDelete, (t) => _.each(t.callbacks, (c) => {
                            let result = parseInt(c(table.rows));
                            if (!isNaN(result)) {
                                deleteResult += result;
                            }
                        }));
                } else {
                    deleteResult = rowsToDelete.length;
                    db.schemas[schemaName][tableName].rows = _.reject(db.schemas[schemaName][tableName].rows, (r) => _.contains(rowsToDelete, r.rowid));
                }
                
                _.each(afterDelete, (t) => _.each(t.callbacks, (c) => c(table.rows)));
                db.changes = deleteResult;
                db.totalChanges += deleteResult;
                return deleteResult;
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
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
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
                            if (sv === null || insertObj[f.name] === undefined || sv <= 0) {
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
                    insertRow = { rowid: rowid, data: insertRow };
                    
                    let insertTriggers = _.filter(db.schemas[schemaName].triggers, (t) =>
                            t.table === tableName && t.action === cls.TriggerEventBlock.Action.Insert),
                        beforeInsert = _.filter(insertTriggers, (t) => t.when === cls.TriggerEventBlock.When.Before),
                        insteadOfInsert = _.filter(insertTriggers, (t) => t.when === cls.TriggerEventBlock.When.Instead),
                        afterInsert = _.filter(insertTriggers, (t) => t.when === cls.TriggerEventBlock.When.After);
                    _.each(beforeInsert, (t) => _.each(t.callbacks, (c) => c([insertRow])));
                    
                    let insertResult;
                    if (insteadOfInsert.length > 0) {
                        insertResult = 0;
                        let prevLastRowid = db.lastRowid;
                        _.each(insteadOfInsert, (t) => _.each(t.callbacks, (c) => {
                                let result = parseInt(c([insertRow]));
                                if (!isNaN(result)) {
                                    insertResult += result;
                                }
                            }));
                        if (insertResult && db.lastRowid === prevLastRowid) db.lastRowid = rowid;
                    } else {
                        insertResult = 1;
                        table.rows.push(insertRow);
                        db.lastRowid = rowid;
                    }
                    
                    _.each(afterInsert, (t) => _.each(t.callbacks, (c) => c([insertRow])));
                    db.changes = insertResult;
                    db.totalChanges += insertResult;
                    return insertResult;
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
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
                }
                super(options, [
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
                
                let tableAlias, tableName, schemaName, conditions, fields, values;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        tableName = b.tables[0].table;
                        schemaName = b.tables[0].schema || 'default';
                        tableAlias = b.tables[0].alias;
                    } else if (b instanceof cls.SetFieldBlock) {
                        fields = b.fields;
                        values = b.values;
                    } else if (b instanceof cls.WhereBlock) {
                        conditions = b.conditions;
                    }
                });
                
                if (fields.length !== values.length) throw new Error(`fields [${fields.join(',')}] and values [${values.join(',')}] must be same length`);
                
                let db = state.bshields.jsql.db;
                if (!(db.schemas[schemaName] && db.schemas[schemaName][tableName])) {
                    throw new Error(`No table named ${schemaName}.${tableName}`);
                }
                let table = cls.deepCopy(db.schemas[schemaName][tableName]),
                    tables = () => table;
                
                // where
                _.each(conditions, (c) => {
                    let matches = cls.evaluate(c, tables);
                    table.rows = _.filter(table.rows, (r, i) => !!matches[i]);
                });
                
                let oldTableRows = cls.deepCopy(table.rows);
                
                // set fields
                _.each(fields, (name, i) => {
                    let val = values[i],
                        idx = _.map(table.fields, (f) => f.name).indexOf(name);
                    
                    if (idx < 0) throw new Error(`Unrecognized field ${name}`);
                    _.each(table.rows, (r) => {
                        r.data[idx] = val;
                    });
                });
                
                let updateTriggers = _.filter(db.schemas[schemaName].triggers, (t) =>
                        t.table === tableName && t.action === cls.TriggerEventBlock.Action.Update &&
                        (t.columns === null || t.columns.length === 0 || _.intersection(t.columns, fields).length > 0)),
                    beforeUpdate = _.filter(updateTriggers, (t) => t.when === cls.TriggerEventBlock.When.Before),
                    insteadOfUpdate = _.filter(updateTriggers, (t) => t.when === cls.TriggerEventBlock.When.Instead),
                    afterUpdate = _.filter(updateTriggers, (t) => t.when === cls.TriggerEventBlock.When.After);
                _.each(beforeUpdate, (t) => _.each(t.callbacks, (c) => c(table.rows, oldTableRows)));
                
                let rowsToUpdate = _.map(table.rows, (r) => r.rowid),
                    updateResult;
                if (insteadOfUpdate.length > 0) {
                    updateResult = 0;
                    _.each(insteadOfUpdate, (t) => _.each(t.callbacks, (c) => {
                            let result = parseInt(c(table.rows, oldTableRows));
                            if (!isNaN(result)) {
                                updateResult += result;
                            }
                        }));
                } else {
                    updateResult = rowsToUpdate.length;
                    db.schemas[schemaName][tableName].rows = _.map(db.schemas[schemaName][tableName].rows, (r) => {
                        let idx = rowsToUpdate.indexOf(r.rowid);
                        if (idx < 0) {
                            return r;
                        } else {
                            return table.rows[idx];
                        }
                    });
                }
                
                _.each(afterUpdate, (t) => _.each(t.callbacks, (c) => c(table.rows, oldTableRows)));
                db.changes = updateResult;
                db.totalChanges += updateResult;
                return updateResult;
            }
        };
        
        cls.Select = class Select extends cls.QueryBuilder {
            constructor(options) {
                super(options, [
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
                
                let table, fields, joins, conditions, orderBy, limit, offset;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.GetFieldBlock) {
                        fields = b.fields;
                    } else if (b instanceof cls.MultipleTableBlock) {
                        table = b.tables;
                    } else if (b instanceof cls.SubqueryBlock) {
                        
                    } else if (b instanceof cls.JoinBlock) {
                        joins = b.joins;
                        if (table.length > 1) {
                            for (let i = table.length - 1; i >= 1; i--) {
                                let t = table.pop(),
                                    name = `${t.schema}.${t.table} ${t.alias || ''}`.trim();
                                joins.unshift({
                                    table: name,
                                    type: cls.JoinBlock.Type.Inner,
                                    constraints: []
                                });
                            }
                        }
                    } else if (b instanceof cls.WhereBlock) {
                        conditions = b.conditions;
                    } else if (b instanceof cls.GroupByBlock) {
                        
                    } else if (b instanceof cls.OrderByBlock) {
                        orderBy = b.fields;
                    } else if (b instanceof cls.LimitBlock) {
                        limit = b.value;
                    } else if (b instanceof cls.OffsetBlock) {
                        offset = b.value;
                    }
                });
                table = table[0];
                
                let db = state.bshields.jsql.db,
                    schemaName = table.schema,
                    tableName = table.table;
                
                if (!(db.schemas[schemaName] && db.schemas[schemaName][tableName])) {
                    throw new Error(`No table named ${schemaName}.${tableName}`);
                }
                
                table = cls.deepCopy(db.schemas[schemaName][tableName]);
                let tables = () => table;
                
                // where
                _.each(conditions, (c) => {
                    let matches = cls.evaluate(c, tables);
                    table.rows = _.filter(table.rows, (r, i) => !!matches[i]);
                });
                
                // order by
                table.rows = table.rows.sort((a, b) => {
                    var result = null,
                        idxs = _.map(orderBy, (o) => _.map(table.fields, (f) => f.name).indexOf(o.field));
                    _.each(idxs, (j, n) => {
                        if (result !== null) return;
                        if (a.data[j] !== b.data[j]) result = a.data[j] < b.data[j] ? -1 : a.data[j] > b.data[j] ? 1 : 0;
                        if (orderBy[n].descending) result = 1 - result;
                    });
                    return result || 0;
                });
                
                // offset
                if (offset !== null) {
                    table.rows = table.rows.slice(parseInt(offset));
                }
                
                // limit
                if (limit !== null) {
                    table.rows = table.rows.slice(0, parseInt(limit));
                }
                
                if (options.selectAsObjects) {
                    let result = [];
                    _.each(table.rows, (r) => {
                        let rowdata = {};
                        _.each(table.fields, (f, i) => { rowdata[f.name] = r.data[i]; });
                        result.push(rowdata);
                    });
                    return result;
                } else {
                    return _.pluck(table.rows, 'data');
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
                    },
                    mirroedDb: {
                        writable: true,
                        enumerable: false,
                        configurable: false,
                        value: null
                    }
                });
            }
            
            rollback() {
                this.actions = [];
                if (this.mirroredDb !== null) {
                    state.bshields.jsql.db = mirroredDb;
                    mirroredDb = null;
                }
                return this;
            }
            
            reset() {
                this.actions = [];
                this.isOpen = true;
                return this;
            }
            
            addAction(action) {
                if (!action) {
                    throw new Error('action required');
                }
                if (!(action instanceof cls.QueryBuilder)) {
                    throw new Error('action must be a QueryBuilder object');
                }
                this.actions.push(action);
                return this;
            }
            
            commit(options) {
                if (!this.isOpen) {
                    throw new Error('Transaction has been completed. Start a new transaction in order to commit again.');
                }
                
                options = _.extend({}, this.options, options || {});
                if (options.useTransaction === this) {
                    options.useTransaction = null;
                }
                
                this.mirroredDb = cls.deepCopy(state.bshields.jsql.db);
                try {
                    _.each(this.actions, (a) => {
                        a.execute(options);
                    });
                    this.isOpen = false;
                    this.mirroredDb = null;
                    return true;
                } catch (e) {
                    this.rollback();
                    return false;
                }
            }
        };
        
        /***********************************************************************
         * Triggers
         **********************************************************************/
        cls.CreateTrigger = class CreateTrigger extends cls.QueryBuilder {
            /**
             * jsql.createTrigger('example_schema.example_trigger', 'my_table')
             *     .after()
             *     .after('delete')
             *     .after(cls.TriggerEventBlock.Action.Delete)
             *     .after('update', 'field1', 'field2', 'fieldN')
             * 
             *     .before(...)
             *     .instead(...)
             * 
             *     .delete()
             *     .delete('after')
             *     .delete(cls.TriggerEventBlock.When.After)
             * 
             *     .insert(...)
             *     .update(...)
             *     .update(..., 'field1', 'field2', 'fieldN')
             * 
             *     .beforeDelete()
             *     .afterDelete()
             *     .insteadOfDelete()
             * 
             *     .beforeInsert()
             *     .afterInsert()
             *     .insteadOfInsert()
             * 
             *     .beforeUpdate()
             *     .beforeUpdate('field1', 'field2', 'fieldN')
             *     .afterUpdate()
             *     .afterUpdate('field1', 'field2', 'fieldN')
             *     .insteadOfUpdate()
             *     .insteadOfUpdate('field1', 'field2', 'field3')
             * 
             *     .function((newRow) => { ... })           // insert
             *     .function((newRows, oldRows) => { ... }) // update
             *     .function((oldRows) => { ... })          // delete
             *     .execute()
             */
            constructor(triggerName, tableName, options) {
                var qualifiedName;
                
                if (!triggerName || triggerName.length === 0 || triggerName.lastIndexOf('.') === triggerName.length) {
                    throw new Error('trigger name required');
                }
                if (!tableName || tableName.length === 0) {
                    throw new Error('table name required');
                }
                if (tableName === 'triggers') {
                    throw new Error('invalid table name');
                }
                if (options && options.ifNotExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.createTriggerIfNotExists = !!options.ifNotExists;
                    delete options.ifNotExists;
                }
                
                super(options, [
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.TriggerEventBlock(options),
                    new cls.FunctionBlock(options)
                ]);
                this.options.createTriggerIfNotExists = !!this.options.createTriggerIfNotExists;
                qualifiedName = parseQualifiedName(triggerName);
                this.name = {
                    schema: qualifiedName.schema || 'default',
                    name: qualifiedName.table
                };
            }
            
            /**
             * Run the create trigger operation
             * 
             * @param options Object
             * @return `true` if the trigger was created, `false` otherwise. Note that depending on the options values,
             *         failing to create the trigger may throw an error.
             */
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.ifNotExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.createTriggerIfNotExists = !!options.ifNotExists;
                    delete options.ifNotExists;
                }
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let when, action, columns, table, callbacks;
                _.each(this.blocks, (b) => {
                    if (b instanceof cls.SingleTableBlock) {
                        table = b.tables[0].table;
                    } else if (b instanceof cls.TriggerEventBlock) {
                        when = b.when;
                        action = b.action;
                        columns = b.columns;
                    } else if (b instanceof cls.FunctionBlock) {
                        if (b.callbacks.length === 0) {
                            throw new Error('no callbacks specified');
                        }
                        callbacks = _.chain(b.callbacks)
                            .map((f) => f.toString())
                            .map((s) => {
                                let params = _.chain(s.substring(s.indexOf('(') + 1, s.indexOf(')')).split(','))
                                                .map((p) => p.trim()).reject((p) => p.length === 0).value(),
                                    body = s.substring(s.indexOf(')') + 1).trim();
                                if (body.indexOf('{') === 0) body = body.substring(1, body.length - 1).trim();
                                else if (body.indexOf('=>') === 0) {
                                    body = body.substring(2).trim();
                                    if (body.indexOf('{') === 0) body = body.substring(1, body.length - 1).trim();
                                    else body = `return ${body};`;
                                } else {
                                    throw new Error(`Error parsing function string ${s}`);
                                }
                                return {
                                    params: params,
                                    body: body
                                }
                            }).value();
                    }
                });
                
                let db = state.bshields.jsql.db;
                if (!db.schemas[this.name.schema]) {
                    db.schemas[this.name.schema] = { triggers: {} };
                }
                if (db.schemas[this.name.schema].triggers[this.name.name]) {
                    if (!options.createTriggerIfNotExists) {
                        throw new Error(`Trigger ${this.name.schema}.${this.name.name} already exists`);
                    }
                    // else nop
                    return false;
                } else {
                    if (when === null) {
                        throw new Error('before(), after(), or instead() required');
                    }
                    if (action === null) {
                        throw new Error('delete(), insert(), or update() required');
                    }
                    db.schemas[this.name.schema].triggers[this.name.name] = {
                        when: when,
                        action: action,
                        columns: columns,
                        table: table,
                        callbacks: callbacks
                    };
                    return true;
                }
            }
        };
        
        cls.DropTrigger = class DropTrigger extends cls.QueryBuilder {
            /**
             * jsql.dropTrigger('example_schema.example_trigger').execute()
             */
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
                
                super(options, []);
                this.options.dropTriggerIfExists = !!this.options.dropTriggerIfExists;
                qualifiedName = parseQualifiedName(triggerName);
                this.name = {
                    schema: qualifiedName.schema || 'default',
                    name: qualifiedName.table
                };
            }
            
            execute(options) {
                options = _.extend({}, this.options, options || {});
                if (options.ifExists !== undefined) {
                    options = _.mapObject(options, (v) => v);
                    options.dropTriggerIfExists = !!options.ifExists;
                    delete options.ifExists;
                }
                if (options.useTransaction instanceof cls.Transaction) {
                    options.useTransaction.addAction(this);
                    return;
                }
                
                let db = state.bshields.jsql.db;
                if (!(db.schemas[this.name.schema] && db.schemas[this.name.schema].triggers[this.name.name])) {
                    if (options.dropTriggerIfExists) return false;
                    else throw new Error(`Trigger ${this.name.schema}.${this.name.name} does not exist`);
                } else {
                    delete db.schemas[this.name.schema].triggers[this.name.name];
                    return true;
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
            
            cls: cls,
            toJSON: function() {
                return `${this.VERSION}: createTable(tableName[, options]); alterTable(tableName[, options]); dropTable(tableName[, options]); \
delete(tableName[, options]); insert(tableName[, options]); select([options]); update(tableName[, options]); \
transaction([options]); createTrigger(triggerName, tableName[, options]); dropTrigger(triggerName[, options]); \
expr([expr[, options]]); cls: {${cls.toJSON()}}`;
            }
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
                    schemas: { default: { triggers: {} } }
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
    'use strict';
    
    bshields.jsql.checkInstall();
});
jsql = jsql || bshields.jsql.sql;
if ($ === undefined) {
    $ = function (expr, options) { return bshields.jsql.sql.expr(expr, options); }
    _.each(bshields.jsql.sql, (v, k) => { $[k] = v; });
}
if ($$ === undefined) {
    (function() {
        'use strict';
        
        let sql = bshields.jsql.sql;
        $$ = {
            identity: function() { var e = sql.expr(); return e.identity.apply(e, arguments); },
            negate: function() { var e = sql.expr(); return e.negate.apply(e, arguments); },
            bitNot: function() { var e = sql.expr(); return e.bitNot.apply(e, arguments); },
            not: function() { var e = sql.expr(); return e.not.apply(e, arguments); },
            plus: function() { var e = sql.expr(); return e.plus.apply(e, arguments); },
            minus: function() { var e = sql.expr(); return e.minus.apply(e, arguments); },
            multiply: function() { var e = sql.expr(); return e.multiply.apply(e, arguments); },
            divide: function() { var e = sql.expr(); return e.divide.apply(e, arguments); },
            modulus: function() { var e = sql.expr(); return e.modulus.apply(e, arguments); },
            bitOr: function() { var e = sql.expr(); return e.bitOr.apply(e, arguments); },
            bitAnd: function() { var e = sql.expr(); return e.bitAnd.apply(e, arguments); },
            bitXor: function() { var e = sql.expr(); return e.bitXor.apply(e, arguments); },
            bitLeft: function() { var e = sql.expr(); return e.bitLeft.apply(e, arguments); },
            bitRight: function() { var e = sql.expr(); return e.bitRight.apply(e, arguments); },
            or: function() { var e = sql.expr(); return e.or.apply(e, arguments); },
            and: function() { var e = sql.expr(); return e.and.apply(e, arguments); },
            lessThan: function() { var e = sql.expr(); return e.lessThan.apply(e, arguments); },
            lessThanEquals: function() { var e = sql.expr(); return e.lessThanEquals.apply(e, arguments); },
            greaterThan: function() { var e = sql.expr(); return e.greaterThan.apply(e, arguments); },
            greaterThanEquals: function() { var e = sql.expr(); return e.greaterThanEquals.apply(e, arguments); },
            equals: function() { var e = sql.expr(); return e.equals.apply(e, arguments); },
            notEqualTo: function() { var e = sql.expr(); return e.notEqualTo.apply(e, arguments); },
            is: function() { var e = sql.expr(); return e.is.apply(e, arguments); },
            isNot: function() { var e = sql.expr(); return e.isNot.apply(e, arguments); },
            in: function() { var e = sql.expr(); return e.in.apply(e, arguments); },
            notIn: function() { var e = sql.expr(); return e.notIn.apply(e, arguments); },
            like: function() { var e = sql.expr(); return e.like.apply(e, arguments); },
            notLike: function() { var e = sql.expr(); return e.notLike.apply(e, arguments); },
            glob: function() { var e = sql.expr(); return e.glob.apply(e, arguments); },
            notGlob: function() { var e = sql.expr(); return e.notGlob.apply(e, arguments); },
            regex: function() { var e = sql.expr(); return e.regex.apply(e, arguments); },
            avg: function() { var e = sql.expr(); return e.avg.apply(e, arguments); },
            count: function() { var e = sql.expr(); return e.count.apply(e, arguments); },
            groupConcat: function() { var e = sql.expr(); return e.groupConcat.apply(e, arguments); },
            max: function() { var e = sql.expr(); return e.max.apply(e, arguments); },
            min: function() { var e = sql.expr(); return e.min.apply(e, arguments); },
            sum: function() { var e = sql.expr(); return e.sum.apply(e, arguments); },
            total: function() { var e = sql.expr(); return e.total.apply(e, arguments); },
            abs: function() { var e = sql.expr(); return e.abs.apply(e, arguments); },
            changes: function() { var e = sql.expr(); return e.changes.apply(e, arguments); },
            char: function() { var e = sql.expr(); return e.char.apply(e, arguments); },
            coalesce: function() { var e = sql.expr(); return e.coalesce.apply(e, arguments); },
            ifnull: function() { var e = sql.expr(); return e.ifnull.apply(e, arguments); },
            lastInsertRowid: function() { var e = sql.expr(); return e.lastInsertRowid.apply(e, arguments); },
            length: function() { var e = sql.expr(); return e.length.apply(e, arguments); },
            lower: function() { var e = sql.expr(); return e.lower.apply(e, arguments); },
            ltrim: function() { var e = sql.expr(); return e.ltrim.apply(e, arguments); },
            nullif: function() { var e = sql.expr(); return e.nullif.apply(e, arguments); },
            random: function() { var e = sql.expr(); return e.random.apply(e, arguments); },
            replace: function() { var e = sql.expr(); return e.replace.apply(e, arguments); },
            round: function() { var e = sql.expr(); return e.round.apply(e, arguments); },
            rtrim: function() { var e = sql.expr(); return e.rtrim.apply(e, arguments); },
            substr: function() { var e = sql.expr(); return e.substr.apply(e, arguments); },
            totalChanges: function() { var e = sql.expr(); return e.totalChanges.apply(e, arguments); },
            trim: function() { var e = sql.expr(); return e.trim.apply(e, arguments); },
            typeof: function() { var e = sql.expr(); return e.typeof.apply(e, arguments); },
            upper: function() { var e = sql.expr(); return e.upper.apply(e, arguments); }
        };
    }());
}