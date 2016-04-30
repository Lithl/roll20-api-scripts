var bshields = bshields || {}, jsql;
bshields.jsql = (function() {
    'use strict';
    
    var version = 0.3;
    
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
        }
        
        if (assumeField) {
            name = parseQualifiedName(name, false);
            table = name.schema;
            field = name.table;
        }
        
        if (table.indexOf('.') >= 0) {
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
    
    function buildSql() {
        var cls = {
            globalTypeHandlers: [],
            DefaultOptions: {
                typeHandlers: [],
                autoincrementStartValue: 1
            },
            
            registerTypeHandler: function(type, handler) {
                registerTypeHandler(type, handler, cls.globalTypeHandlers);
            },
            getTypeHandler: function(type, handlers) {
                return getTypeHandler(type, cls.globalTypeHandlers, handlers);
            },
            getHandlerFor: function(value, handlers) {
                return getHandlerFor(value, cls.globalTypeHandlers, handlers);
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
        cls.Cloneable = class Cloneable {
            clone() {
                
            }
        };
        
        cls.BaseBuilder = class BaseBuilder extends cls.Cloneable {
            constructor(options) {
                super();
                this.options = _.extend({}, cls.DefaultOptions, options || {});
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
                this.operations = [];
                if (expr) {
                    this.identity(expr);
                }
            }
            
            identity(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Identity,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return new cls.Expression(this, this.options);
                }
            }
            
            negate(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Negate,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).negate(this);
                }
            }
            
            bitNot(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.BitNot,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitNot(this);
                }
            }
            
            not(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Not,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).not(this);
                }
            }
            
            plus(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Plus,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).plus(this, expr1);
                }
            }
            
            minus(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Minus,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).minus(this, expr1);
                }
            }
            
            multiply(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Multiply,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).multiply(this, expr1);
                }
            }
            
            divide(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Divide,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).divide(this, expr1);
                }
            }
            
            modulus(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Modulus,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).modulus(this, expr1);
                }
            }
            
            bitOr(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.BitOr,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitOr(this, expr1);
                }
            }
            
            bitAnd(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.BitAnd,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitAnd(this, expr1);
                }
            }
            
            bitLeft(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.BitLeft,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitLeft(this, expr1);
                }
            }
            
            bitRight(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.BitRight,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).bitRight(this, expr1);
                }
            }
            
            or(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Or,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).or(this, expr1);
                }
            }
            
            and(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.And,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).and(this, expr1);
                }
            }
            
            lessThan(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.LessThan,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).lessThan(this, expr1);
                }
            }
            
            lessThanEqual(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.LessThanEqual,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).lessThanEqual(this, expr1);
                }
            }
            
            greaterThan(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.GreaterThan,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).greaterThan(this, expr1);
                }
            }
            
            greaterThanEqual(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.GreaterThanEqual,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).greaterThanEqual(this, expr1);
                }
            }
            
            equal(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Equal,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).equal(this, expr1);
                }
            }
            
            notEqual(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.NotEqual,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).notEqual(this, expr1);
                }
            }
            
            is(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Is,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).is(this, expr1);
                }
            }
            
            isNot(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.IsNot,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).isNot(this, expr1);
                }
            }
            
            in(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.In,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).in(this, expr1);
                }
            }
            
            like(expr1, expr2, escape) {
                var operands = [expr1, expr2];
                if (escape !== undefined) operands.push(escape);
                
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Like,
                        operands: operands
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).like(this, expr1, escape);
                }
            }
            
            glob(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Glob,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).glob(this, expr1);
                }
            }
            
            avg(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Average,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.operands)).avg(this);
                }
            }
            
            count(expr) {
                var operands = [];
                if (expr !== undefined) operands.push(expr);
                this.operations.push({
                    operator: cls.Expression.Operator.Count,
                    operands: operands
                });
                return this;
            }
            
            groupConcat(expr, separator) {
                separator = separator || ',';
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.GroupConcat,
                        operands: [expr, separator]
                    });
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
                    this.operations.push({
                        operator: operator,
                        operands: operands
                    });
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
                    this.operations.push({
                        operator: operator,
                        operands: operands
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).min(this);
                }
            }
            
            sum(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Sum,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).sum(this);
                }
            }
            
            total(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Total,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).total(this);
                }
            }
            
            abs(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Abs,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).abs(this);
                }
            }
            
            // atomic expression; destroys existing expression chain and prevents building chain without nesting
            changes() {
                this.operations = [{
                    operator: cls.Expression.Operator.Changes,
                    operands: []
                }];
                this.operations.push = () => 0;
                return this;
            }
            
            char() {
                this.operations.push({
                    operator: cls.Expression.Operator.Char,
                    operands: _.toArray(arguments)
                });
                return this;
            }
            
            coalesce() {
                this.operations.push({
                    operator: cls.Expression.Operator.Coalesce,
                    operands: _.toArray(arguments)
                });
                return this;
            }
            
            ifnull(expr1, expr2) {
                if (expr2 !== undefined) {
                    return coalesce(expr1, expr2);
                } else {
                    return (new cls.Expression(null, this.options)).ifnull(this, expr1);
                }
            }
            
            // atomic expression; destroys existing expression chain and prevents building chain without nesting
            lastInsertRowid() {
                this.operations = [{
                    operator: cls.Expression.Operator.LastInsertRowid,
                    operands: []
                }];
                this.operations.push = () => 0;
                return this;
            }
            
            length(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Length,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).length(this);
                }
            }
            
            lower(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Lower,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).lower(this);
                }
            }
            
            ltrim(expr, charset) {
                charset = charset || '\s';
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.LTrim,
                        operands: [expr, charset]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).ltrim(this, charset);
                }
            }
            
            nullif(expr1, expr2) {
                if (expr2 !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Nullif,
                        operands: [expr1, expr2]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).nullif(this, expr1);
                }
            }
            
            // atomic expression; destroys existing expression chain and prevents building chain without nesting
            random() {
                this.operations = [{
                    operator: cls.Expression.Operator.Random,
                    operands: []
                }];
                this.operations.push = () => 0;
                return this;
            }
            
            replace(needle, replace, expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Replace,
                        operands: [expr, needle, replace]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).replace(needle, replace, this);
                }
            }
            
            round(expr, digits) {
                digits = digits || 0;
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Round,
                        operands: [expr, digits]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).replace(this, digits);
                }
            }
            
            rtrim(expr, charset) {
                charset = charset || '\s';
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.RTrim,
                        operands: [expr, charset]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).rtrim(this, charset);
                }
            }
            
            substr(expr, start, length) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Substr,
                        operands: [expr, start, length]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).substr(this, start, length);
                }
            }
            
            // atomic expression; destroys existing expression chain and prevents building chain without nesting
            totalChanges() {
                this.operations = [{
                    operator: cls.Expression.Operator.TotalChanges,
                    operands: []
                }];
                this.operations.push = () => 0;
                return this;
            }
            
            trim(expr, charset) {
                charset = charset || '\s';
                if (expr !== undefined) {
                    return this.ltrim(expr, charset) && this.rtrim(expr, charset);
                } else {
                    return (new cls.Expression(null, this.options)).trim(this, charset);
                }
            }
            
            typeof(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Typeof,
                        operands: [expr]
                    });
                    return this;
                } else {
                    return (new cls.Expression(null, this.options)).typeof(this);
                }
            }
            
            upper(expr) {
                if (expr !== undefined) {
                    this.operations.push({
                        operator: cls.Expression.Operator.Upper,
                        operands: [expr]
                    });
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
            Like: {},               // a LIKE b ; case-insensitive, %: /[\w0-9]*/, _: /[\w0-9]/
            Glob: {},               // a GLOB b ; case-sensitive, *: /[\w0-9]*/, ?: /[\w0-9]/
            
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
        
        cls.SingleTableBlock = class CreateTableBlock extends cls.AbstractTableBlock {
            constructor(table, alias, options) {
                var qualifiedName = parseQualifiedName(table);
                super(options);
                this.tables.push({
                    schema: qualifiedName.schema || null,
                    table: qualifiedName.table,
                    alias: (qualifiedName.alias || alias) || null
                })
            }
        };
        
        cls.CreateFieldBlock = class CreateFieldBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.fields = [];
            }
            
            pub_field(name, typeHandler, autoincrement, options) {
                var isNumeric = typeHandler === Number || (typeof typeHandler === 'string' && typeHandler.toLowerCase() === 'number');
                options = _.extend({}, this.options, options || {});
                
                if (typeof typeHandler === 'string') {
                    typeHandler = cls.getTypeHandler(typeHandler.toLowerCase(), this.options.typeHandlers);
                } else if (typeHandler === Number) {
                    typeHandler = cls.getTypeHandler('number', this.options.typeHandlers);
                } else if (typeHandler === String) {
                    typeHandler = cls.getTypeHandler('string', this.options.typeHandlers);
                } else if (typeHandler === Boolean) {
                    typeHandler = cls.getTypeHandler('boolean', this.options.typeHandlers);
                } else if (typeHandler === Object) {
                    typeHandler = cls.getTypeHandler('object', this.options.typeHandlers);
                } else if (typeHandler === Date) {
                    typeHandler = cls.getTypeHandler(Date);
                } else if (typeof typeHandler === 'function') {
                    try { typeHandler = cls.getHandlerFor(new typeHandler.constructor(), this.options.typeHandlers); }
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
                } else {
                    this.conditions.push(new cls.Expression(expr, this.options));
                }
            }
        };
        
        cls.OrderByBlock = class OrderByBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.fields = [];
            }
            
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
        
        cls.LimitBlock = class LimitBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.limit = null;
            }
            
            pub_limit(limit) { this.limit = limit instanceof cls.Expression ? limit : parseInt(limit); }
        };
        
        cls.OffsetBlock = class OffsetBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.offset = null;
            }
            
            pub_offset(offset) { this.offset = offset instanceof cls.Expression ? offset : parseInt(offset); }
        };
        
        cls.SetFieldBlock = class SetFieldBlock extends cls.Block {
            constructor(options) {
                super(options);
                this.fields = [];
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
                if (qb instanceof cls.QueryBuilder && !_.any(this.whitelist, (w) => qb instanceof w)) {
                    throw new Error('Subquery is not whitelisted');
                }
                this.queries.push(qb);
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
             * jsql.createTable('table', true)
             *     .field('id', Number)
             *     .field('my_data', 'my_data handler')
             *     .field('custom', function() { ... })
             *     .execute()
             * 
             * @param tableName String Name of the table to create
             * @param ifNotExists boolean Whether to throw an error if the table already exists in the database
             * @param options Object
             */
            constructor(tableName, ifNotExists, options) {
                var str;
                if (ifNotExists !== false) ifNotExists = true;
                str = ifNotExists ? ' IF NOT EXISTS' : '';
                
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                
                super(options, [
                    new cls.StringBlock(`CREATE TABLE${str}`, options),
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.CreateFieldBlock(options)
                ]);
                this.ifNotExists = ifNotExists;
            }
            
            /**
             * Run the create table operation
             * 
             * @param options Object
             * @return `true` if the table was created, `false` otherwise. Note that depending on the values passed to the constructor,
             *         failing to create the table may throw an error.
             */
            execute(options) {
                
            }
        };
        
        cls.AlterTable = class AlterTable extends cls.QueryBuilder {
            /**
             * jsql.alterTable('table')
             *     .rename('table2')
             *     .field('new_field', Object)
             * 
             * @param tableName String name of the table to modify
             * @param options Object
             */
            constructor(tableName, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.StringBlock(`ALTER TABLE ${tableName}`, options),
                    new cls.SingleTableBlock(tableName, null, options),
                    new cls.RenameTableBlock(options),
                    new cls.CreateFieldBlock(options)
                ]);
            }
            
            /**
             * Run the alter table operation
             * 
             * @param options Object
             * @return `true` in all non-exceptional cases
             */
            execute() {
                
            }
        };
        
        cls.DropTable = class DropTable extends cls.QueryBuilder {
            /**
             * jsql.dropTable('table', true).execute()
             * 
             * @param tableName String Name of the table to drop
             * @param ifExists boolean Whether to throw an error if the table already doesn't exist in the database
             * @param options Object
             */
            constructor(tableName, ifExists, options) {
                var str;
                if (ifExists !== false) ifExists = true;
                str = ifExists ? ' IF EXISTS' : '';
                
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                
                super(options, [
                    new cls.StringBlock(`DROP TABLE${str} ${tableName}`, options),
                    new cls.SingleTableBlock(tableName, options)
                ]);
                this.ifExists = ifExists;
            }
            
            /**
             * Run the drop table operation
             * 
             * @param options Object
             * @return `true` if the table was dropped, `false` otherwise. Note that depending on the values passed to the constructor,
             *         failing to drop the table may throw an error.
             */
            execute(options) {
                
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
            constructor(tableNamne, alias, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.StringBlock(`DELETE FROM ${tableName}`, options),
                    new cls.SingleTableBlock(tableName, alias, options),
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
             * @param tableName String Name of the table to delete from
             * @param options Object
             */
            constructor(tableName, alias, options) {
                if (!tableName || tableName.length === 0 || tableName.lastIndexOf('.') === tableName.length) {
                    throw new Error('table name required');
                }
                super(options, [
                    new cls.StringBlock(`INSERT INTO ${tableName}`, options),
                    new cls.SingleTableBlock(tableName, alias, options),
                    new cls.SetFieldBlock(options),
                    new cls.SubqueryBlock([cls.Select], 1, options)
                ]);
            }
            
            /**
             * Executes the insert operation
             * 
             * @param options Object
             */
            execute(options) {
                
            }
        };
        
        cls.Select = class Select extends cls.QueryBuilder {
            
        };
        
        return {
            VERSION: `JSQL Version ${version}`,
            
            // table queries
            createTable: function(tableName, ifNotExists, options) { return new cls.CreateTable(tableName, ifNotExists, options); },
            alterTable: function(tableName, options) { return new cls.AlterTable(tableName, options); },
            dropTable: function(tableName, ifExists, options) { return new cls.DropTable(tableName, ifExists, options); },
            
            // row queries
            delete: function(tableName, alias, options) { return new cls.Delete(tableName, alias, options); },
            insert: function(tableName, alias, options) { return new cls.Insert(tableName, alias, options); },
            select: function(options) { },
            update: function(tableName, options) { },
            
            // meta queries
            transaction: function(options) { },
            createTrigger: function(triggerName, ifNotExists, options) { },
            dropTrigger: function(triggerName, ifExists, options) { },
            
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
                    lastRowid: null
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