var bshields = bshields || {};
bshields.jsql = (function() {
    'use strict';
    
    var version = 0.1;
    
    // append `pad` to `str` if non-empty
    function pad(str, pad) { return str.length ? str + pad : str; }
    
    // Extend dest with src objects properties
    function extend(dest) {
        var srcs = _.rest(arguments);
        if (dest && srcs) {
            for (let src of srcs) {
                if (typeof src === 'object') {
                    _.each(Object.getOwnPropertyNames(src), function(k) { if (typeof src[k] !== 'function') dest[k] = src[k]; });
                }
            }
        }
        
        return dest;
    }
    
    function isPlainObject(obj) { return obj && obj.constructor.prototype === Object.prototype; }
    
    function getObjectClassName(obj) {
        if (obj && obj.constructor && obj.constructor.toString) {
            let arr = obj.constructor.toString().match(/function\s*(\w+)/);
            
            if (arr && arr.length === 2) return arr[1];
        }
    }
    
    function clone(src) {
        if (!src) return src;
        
        if (typeof src.clone === 'function') return src.clone();
        else if (isPlainObject(src) || _.isArray(src)) {
            let ret = new (src.constructor);
            
            _.each(Object.getOwnPropertyNames(src), function(e, k) {
                if (typeof e !== 'function') ret[k] = clone(e);
            });
            
            return ret;
        } else return JSON.parse(JSON.stringify(src));
    }
    
    function registerValueHandler(handlers, type, handler) {
        let typeofType = typeof type;
        
        if (typeofType !== 'function' && typeofType !== 'string') {
            throw new Error('type must be a class constructor or string');
        }
        
        if (typeof handler !== 'function') {
            throw new Error('handler must be a function');
        }
        
        for (let typeHandler of handlers) {
            if (typeHandler.type === type) {
                typeHandler = handler;
                
                return;
            }
        }
        
        handlers.push({
            type: type,
            handler: handler
        });
    }
    
    function getValueHandler(value) {
        var handlerLists = _.rest(arguments);
        for(let handlers of handlerLists) {
            for (let typeHandler of handlers) {
                if (typeof value === typeHandler.type || (typeof typeHandler.type !== 'string' && value instanceof typeHandler.type)) {
                    return typeHandler.handler;
                }
            }
        }
    }
    
    // base sql classes and functions
    function buildSql() {
        let cls = {
            getObjectClassName: getObjectClassName
        };
        
        cls.DefaultQueryBuilderOptions = {
            autoQuoteTableNames: false,
            autoQuoteFieldNames: false,
            autoQuoteAliasNames: true,
            useAsForTableAliasName: false,
            nameQuoteCharacter: '`',
            tableAliasQuoteCharacter: '`',
            fieldAliasQuoteCharacter: '"',
            valueHandlers: [],
            parameterCharacter: '?',
            numberedParameters: false,
            numberedParametersPrefix: '$',
            numberedParametersStartAt: 1,
            replaceSingleQuotes: false,
            singleQuoteReplacement: '\'\'',
            separator: ' '
        };
        
        cls.globalValueHandlers = [];
        
        cls.registerValueHandler = function(type, handler) {
            registerValueHandler(cls.globalValueHandlers, type, handler);
        }
        
        /***********************************************************************
         * BASE CLASSES
         **********************************************************************/
        
        // base class for cloneable builders
        cls.Cloneable = class {
            clone() {
                let newInstance = new this.constructor;
                return extend(newInstance, clone(extend({}, this)));
            }
        };
        
        // base class for builders
        cls.BaseBuilder = class extends cls.Cloneable {
            constructor(options) {
                super();
                let defaults = JSON.parse(JSON.stringify(cls.DefaultQueryBuilderOptions));
                this.options = extend({}, defaults, options);
            }
            
            registerValueHandler(type, handler) {
                registerValueHandler(this.options.valueHandlers, type, handler);
                return this;
            }
            
            sanitizeExpression(expr) {
                if (!(expr instanceof cls.Expression)) {
                    if (typeof expr !== 'string') {
                        throw new Error('expression must be a string or Expression instance');
                    }
                }
                return expr;
            }
            
            sanitizeName(value, type) {
                if (typeof value !== 'string') {
                    throw new Error(`${type} must be a string`);
                }
                return value;
            }
            
            sanitizeField(item) {
                if (!(item instanceof cls.BaseBuilder)) {
                    item = this.sanitizeName(item, 'field name');
                }
                return item;
            }
            
            sanitizeQueryBuilder(item) {
                if (item instanceof cls.QueryBuilder) return item;
                throw new Error('must be a QueryBuilder instance');
            }
            
            sanitizeTable(item) {
                if (typeof item !== 'string') {
                    try { item = this.sanitizeQueryBuilder(item); }
                    catch (e) {
                        throw new Error('table name must be a string or query builder')
                    }
                } else item = this.sanitizeName(item, 'table');
                return item;
            }
            
            sanitizeTableAlias(item) { return this.sanitizeName(item, 'table alias'); }
            
            sanitizeFieldAlias(item) { return this.sanitizeName(item, 'field alias'); }
            
            sanitizeLimitOffset(value) {
                value = parseInt(value);
                if (value < 0 || isNaN(value)) {
                    throw new Error('limit/offset must be >= 0');
                }
                return value;
            }
            
            sanitizeValue(item) {
                let itemType = typeof item;
                
                if (item === null) { /* nop */ }
                else if (itemType === 'string' || itemType === 'number' || itemType === 'boolean') { /* nop */ }
                else if (item instanceof cls.BaseBuilder) { /* nop */ }
                else {
                    let typeIsValid = !!getValueHandler(item, this.options.valueHandlers, cls.globalValueHandlers);
                    if (!typeIsValid) {
                        throw new Error('field value must be a string, number, boolean, null, or a registered custom value type');
                    }
                }
                return item;
            }
            
            escapeValue(value) {
                return !this.options.replaceSingleQuotes ? value : value.replace(/\'/g, this.options.singleQuotesReplacement);
            }
            
            formatTableName(item) {
                if (this.options.autoQuoteTableNames) {
                    const quoteChar = this.options.nameQuoteCharacter;
                    item = `${quoteChar}${item}${quoteChar}`;
                }
                return item;
            }
            
            formatFieldAlias(item) {
                if (this.options.autoQuoteAliasNames) {
                    let quoteChar = this.options.fieldAliasQuoteCharacter;
                    item = `${quoteChar}${item}${quoteChar}`;
                }
                return item;
            }
            
            formatTableAlias(item) {
                if (this.options.autoQuoteAliasNames) {
                    let quoteChar = this.options.tableAliasQuoteCharacter;
                    item = `${quoteChar}${item}${quoteChar}`;
                }
                return this.options.useAsForTableAliasNames ? `AS ${item}` : item;
            }
            
            formatFieldName(item, formattingOptions) {
                formattingOptions = formattingOptions || {};
                if (this.options.autoQuoteFieldNames) {
                    let quoteChar = this.options.nameQuoteCharacter;
                    if (formattingOptions.ignorePeriodsForFieldNameQuotes) {
                        // a.b.c -> `a.b.c`
                        item = `${quoteChar}${item}${quoteChar}`;
                    } else {
                        // a.b.c -> `a`.`b`.`c`
                        item = _.map(item.split('.'), function(v) { return v === '*' ? v : `${quoteChar}${v}${quoteChar}`; }).join('.');
                    }
                }
                return item;
            }
            
            formatCustomValue(value, asParam) {
                asParam = asParam || false;
                let customHandler = getValueHandler(value, this.options.valueHandlers, cls.globalValueHandlers);
                if (customHandler) value = customHandler(value, asParam);
                return value;
            }
            
            formatValueForParamArray(value) {
                if (_.isArray(value)) {
                    return _.map(value, function(v) { return this.formatValueForParamArray(v); }, this);
                } else {
                    return this.formatCustomValue(value, true);
                }
            }
            
            formatValueForQueryString(value, formattingOptions) {
                formattingOptions = formattingOptions || {};
                let customFormattedValue = this.formatCustomValue(value);
                
                if (customFormattedValue !== value) {
                    return this.applyNestingFormatting(customFormattedValue);
                }
                
                if (_.isArray(value)) {
                    value = _.map(value, function(v) { return this.formatValueForQueryString(v); }, this);
                    value = this.applyNestingFormatting(value.join(', '), true);
                } else {
                    let typeofValue = typeof value;
                    
                    if (value === null) value = 'NULL';
                    else if (typeofValue === 'boolean') value = value ? 'TRUE' : 'FALSE';
                    else if (value instanceof cls.BaseBuilder) value = this.applyNestingFormatting(value.toString());
                    else if (typeofValue !== 'number') {
                        if (formattingOptions.dontQuote) {
                            value = `${value}`;
                        } else {
                            let escapedValue = this.escapeValue(value);
                            value = `'${escapedValue}'`;
                        }
                    }
                }
                return value;
            }
            
            applyNestingFormatting(str, nesting) {
                nesting = !!nesting;
                if (str && typeof str === 'string' && nesting) {
                    if (str.charAt(0) !== '(' || str.charAt(str.length - 1) !== ')') return `(${str})`;
                }
                return str;
            }
            
            buildString(str, values, options) {
                str = str || '';
                values = values || [];
                options = options || {};
                let nested = options.nested,
                    buildParameterized = options.buildParameterized,
                    formattingOptions = options.formattingOptions,
                    formattedStr = '',
                    curValue = -1,
                    formattedValues = [];
                const paramChar = this.options.parameterCharacter;
                let idx = 0;
                
                while (str.length > idx) {
                    if (str.substr(idx, paramChar.length) === paramChar) {
                        let value = values[++curValue];
                        if (buildParameterized) {
                            if (values instanceof cls.BaseBuilder) {
                                let ret = values.toParamString({
                                    buildParameterized: buildParameterized,
                                    nested: true
                                });
                                formattedStr += ret.text;
                                Array.prototype.push.apply(formattedValues, ret.values);
                            } else {
                                value = this.formatValueForParamArray(value);
                                if (_.isArray(value)) {
                                    // Array(6) -> "(??, ??, ??, ??, ??, ??)"
                                    let tmpStr = _.map(value, function() { return paramChar; }).join(', ');
                                    formattedStr += `(${tmpStr})`;
                                    Array.prototype.push.apply(formattedValues, value);
                                } else {
                                    formattedStr += paramChar;
                                    formattedValues.push(value);
                                }
                            }
                        } else {
                            formattedStr += this.formatValueForQueryString(value, formattingOptions);
                        }
                        idx += paramChar.length;
                    } else {
                        formattedStr += str.charAt(idx);
                        idx++;
                    }
                }
                
                return {
                    text: this.applyNestingFormatting(formattedStr, !!nested),
                    values: formattedValues
                };
            }
            
            buildManyStrings(strings, strValues, options) {
                options = options || {};
                let totalStr = [],
                    totalValues = [];
                    
                for (let idx = 0; strings.length > idx; ++idx) {
                    let inputString = strings[idx],
                        inputValues = strValues[idx];
                    
                    let buildStringResult = this.buildString(inputString, inputValues, {
                            buildParameterized: options.buildParameterized,
                            nested: false
                        }),
                        text = buildStringResult.text,
                        values = buildStringResult.values;
                    
                    totalStr.push(text);
                    Array.prototype.push.apply(totalValues, values);
                }
                totalStr = totalStr.join(this.options.separator);
                
                return {
                    text: totalStr.length ? this.applyNestingFormatting(totalStr, !!options.nested) : '',
                    values: totalValues
                };
            }
            
            toParamString(options) { throw new Error('not implemented'); }
            
            toString(options) {
                options = options || {};
                return this.toParamString(options).text;
            }
            
            toParam(options) {
                options = options || {};
                return this.toParamString(extend({}, options, {
                    buildParameterized: true
                }));
            }
            
            toJSON(options) {
                options = options || {};
                return this.toString(extend({ buildParameterized: false }, options));
            }
        };
        
        /***********************************************************************
         * cls.Expressions
         **********************************************************************/
        cls.Expression = class extends cls.BaseBuilder {
            constructor(options) {
                super(options);
                this.nodes = [];
            }
            
            and(expr) {
                var params = _.rest(arguments);
                expr = this.sanitizeExpression(expr);
                this.nodes.push({
                    type: 'AND',
                    expr: expr,
                    para: params
                });
                return this;
            }
            
            or(expr) {
                var params = _.rest(arguments);
                expr = this.sanitizeExpression(expr);
                this.nodes.push({
                    type: 'OR',
                    expr: expr,
                    para: params
                });
                return this;
            }
            
            toParamString(options) {
                options = options || {};
                let totalStr = [],
                    totalValues = [];
                
                for (let node of this.nodes) {
                    let type = node.type,
                        expr = node.expr,
                        para = node.para,
                        buildStringResult = expr instanceof cls.Expression ? expr.toParamString({
                            buildParameterized: options.buildParameterized,
                            nested: true
                        }) : this.buildString(expr, para, { buildParameterized: options.buildParameterized }),
                        text = buildStringResult.text,
                        values = buildStringResult.values;
                    
                    if (totalStr.length) totalStr.push(type);
                    totalStr.push(text);
                    Array.prototype.push.apply(totalValues, values);
                }
                totalStr = totalStr.join(' ');
                
                return {
                    text: this.applyNestingFormatting(totalStr, !!options.nested),
                    values: totalValues
                };
            }
        };
        
        /***********************************************************************
         * cls.Case
         **********************************************************************/
        
        cls.Case = class extends cls.BaseBuilder {
            constructor(fieldName, options) {
                options = options || {};
                super(options);
                
                if (isPlainObject(fieldName)) {
                    options = fieldName;
                    fieldName = null;
                }
                
                if (fieldName) {
                    this.fieldName = this.sanitizedField(fieldName);
                }
                this.options = extend({}, cld.DefaultQueryBuilderOptions, options);
                this.cases = [];
                this.elseValue = null;
            }
            
            when(expression) {
                var values = _.rest(arguments);
                this.cases.unshift({
                    expression: expression,
                    values: values
                });
                return this;
            }
            
            then(result) {
                if (this.cases.length === 0) {
                    throw new Error('when() needs to be called first');
                }
                this.cases[0].result = result;
                return this;
            }
            
            else(elseValue) {
                this.elseValue = elseValue;
                return this;
            }
            
            toParamString(options) {
                options = options || {};
                let totalStr = '',
                    totalValues = [];
                
                for (let caseData of this.cases) {
                    let expression = caseData.expression,
                        values = caseData.values,
                        result = caseData.result,
                        ret = this.buildString(expression, values, {
                            buildParameterized: options.buildParameterized,
                            nested: true
                        });
                    
                    totalStr += `WHEN ${ret.text} THEN ${this.formatValueForQueryString(result)}`;
                    Array.prototype.push.apply(totalValues, ret.values);
                }
                
                if (totalStr.length) {
                    totalStr += ` ELSE ${this.formatValueForQueryString(this.elseValue)} END`;
                    if (this.fieldName) totalStr = `${this.fieldName} ${totalStr}`;
                    totalStr = `CASE ${totalStr}`;
                } else {
                    totalStr = this.formatValueForQueryString(this.elseValue);
                }
                
                return {
                    text: totalStr,
                    values: totalValues
                };
            }
        };
        
        /***********************************************************************
         * Building blocks
         **********************************************************************/
        
        cls.Block = class extends cls.BaseBuilder {
            constructor(options) { super(options) ;}
            
            exposedMethods() {
                let ret = {},
                    obj = this;
                
                while (obj) {
                    _.chain(Object.getOwnPropertyNames(obj))
                        .filter((p) => { return p !== 'constructor' && typeof obj[p] === 'function' && p.charAt(0) !== '_' && !cls.Block.prototype[p]; })
                        .each((p) => { ret[p] = obj[p]; })
                        .value();
                    obj = Object.getPrototypeOf(obj);
                }
                return ret;
            }
        };
        
        cls.StringBlock = class extends cls.Block {
            constructor(options, str) {
                super(options);
                this.str = str;
            }
            
            toParamString(options) {
                options = options || {};
                return {
                    text: this.str,
                    values: []
                };
            }
        };
        
        cls.FunctionBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.strings = [];
                this.values = [];
            }
            
            function(str) {
                var values = _.rest(arguments);
                this.strings.push(str);
                this.values.push(values);
            }
            
            toParamString(options) {
                options = options || {};
                return this.buildManyStrings(this.strings, this.values, options);
            }
        };
        
        cls.registerValueHandler(cls.FunctionBlock, function(value) {
            asParam = !!asParam;
            return asParam ? value.toParam() : value.toString();
        });
        
        cls.AbstractTableBlock = class extends cls.Block {
            constructor(options, prefix) {
                super(options);
                this.tables = [];
            }
            
            _table(table, alias) {
                alias = alias || null;
                alias = alias ? this.sanitizeTableAlias(alias) : alias;
                table = this.sanitizeTable(table);
                if (this.options.singleTable) this.tables = [];
                this.tables.push({
                    table: table,
                    alias: alias
                });
            }
            
            _hasTable() { return this.tables.length > 0; }
            
            toParamString(options) {
                options = options || {};
                let totalStr = '',
                    totalValues = [];
                
                if (this._hasTable()) {
                    for (let tableData of this.tables) {
                        let table = tableData.table,
                            alias = tableData.alias;
                        totalStr = pad(totalStr, ', ');
                        let tableStr = table;
                        
                        if (table instanceof cls.BaseBuilder) {
                            let paramStr = table.toParamString({
                                    buildParameterized: options.buildParameterized,
                                    nested: true
                                }),
                                text = paramStr.text,
                                values = paramStr.values;
                            tableStr = text;
                            Array.prototype.push.apply(totalValues, values);
                        }
                        
                        if (alias) {
                            tableStr += ` ${this.formatTableAlias(alias)}`;
                        }
                        
                        totalStr += tableStr;
                    }
                    
                    if (this.options.prefix) {
                        totalStr = `${this.options.prefix} ${totalStr}`;
                    }
                }
                
                return {
                    text: totalStr,
                    values: totalValues
                };
            }
        };
        
        cls.UpdateTableBlock = class extends cls.AbstractTableBlock {
            table(table, alias) {
                alias = alias || null;
                this._table(table, alias);
            }
            
            toParamString(options) {
                options = options || {};
                if (!this._hasTable()) {
                    throw new Error('table() needs to be called');
                }
                return super.toParamString(options);
            }
        };
        
        cls.FromTableBlock = class extends cls.AbstractTableBlock {
            constructor(options) { super(extend({}, options, { prefix: 'FROM'})); }
            
            from(table, alias) {
                alias = alias || null;
                this._table(table, alias);
            }
            
            toParamString(options) {
                options = options || {};
                return super.toParamString(options);
            }
        };
        
        cls.IntoTableBlock = class extends cls.AbstractTableBlock {
            constructor(options) {
                super(extend({}, options, {
                    prefix: 'INTO',
                    singleTable: true
                }));
            }
            
            into(table) { this._table(table); }
            
            toParamString(options) {
                options = options || {};
                if (!this._hasTable()) {
                    throw new Error('into() needs to be called');
                }
                return super.toParamString(options);
            }
        };
        
        cls.GetFieldBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.fields = [];
            }
            
            field(field, alias, options) {
                alias = alias || null;
                options = options || {};
                
                if (_.isArray(field)) {
                    for (let f of field) {
                        this.field(f, null, options);
                    }
                    return;
                } else if (isPlainObject(field)) {
                    for (let f in field) {
                        let a = field[f];
                        this.field(f, a, options);
                    }
                    return;
                }
                alias = alias ? this.sanitizeFieldAlias(alias) : alias;
                field = this.sanitizeField(field);
                
                let existingField = _.filter(this.fields, (f) => { return f.name === field && f.alias === alias; });
                if (existingField.length) return this;
                this.fields.push({
                    name: field,
                    alias: alias,
                    options: options
                });
            }
            
            toParamString(options) {
                options = options || {};
                let queryBuilder = options.queryBuilder,
                    buildParameterized = options.buildParameterized,
                    totalStr = '',
                    totalValues = [];
                
                for (let field of this.fields) {
                    totalStr = pad(totalStr, ', ');
                    let name = field.name,
                        alias = field.alias,
                        options = field.options;
                    
                    if (typeof name === 'string') totalStr += this.formatFieldName(name, options);
                    else {
                        let ret = name.toParamString({
                            nested: true,
                            buildPArameterized: buildParameterized
                        });
                        totalStr += ret.text;
                        Array.prototype.push.apply(totalValues, ret.values);
                    }
                    
                    if (alias) totalStr += ` AS ${this.formatFieldAlias(alias)}`;
                }
                
                if (!totalStr.length) {
                    let fromTableBlock = queryBuilder && queryBuilder.getBlock(cls.FromTableBlock);
                    if (fromTableBlock && fromTableBlock._hasTable()) totalStr = '*';
                }
                
                return {
                        text: totalStr,
                        values: totalValues
                };
            }
        };
        
        cls.AbstractSetFieldBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this._reset();
            }
            
            _reset() {
                this.fields = [];
                this.values = [[]];
                this.valueOptions = [[]];
            }
            
            _set(field, value, valueOptions) {
                valueOptions = valueOptions || {};
                if (this.values.length > 1) {
                    throw new Error('Cannot set multiple rows of fields this way.');
                }
                if (typeof value !== 'undefined') {
                    value = this.sanitizeValue(value);
                }
                field = this.sanitizeField(field);
                let index = this.fields.indexOf(field);
                if (index === -1) {
                    this.fields.push(field);
                    index = this.fields.length - 1;
                }
                this.values[0][index] = value;
                this.valueOptions[0][index] = valueOptions;
            }
            
            _setFields(fields, valueOptions) {
                valueOptions = valueOptions || {};
                if (typeof fields !== 'object') {
                    throw new Error('Expected an object but got ' + typeof fields);
                }
                for (let field in fields) {
                    this._set(field, fields[field], valueOptions);
                }
            }
            
            _setFieldsRows(fieldsRows, valueOptions) {
                valueOptions = valueOptions || {};
                if (!_.isArray(fieldsRows)) {
                    throw new Error('Expected an array of objects but got ' + typeof fieldsRows);
                }
                this._reset();
                
                for (let i = 0; i < fieldsRows.length; ++i) {
                    let fieldRow = fieldsRows[i];
                    
                    for (let field in fieldRow) {
                        let value = fieldRow[field];
                        field = this.sanitizeField(field);
                        value = this.sanitizeValue(value);
                        let index = this.fields.indexOf(field);
                        
                        if (i > 0 && index === -1) {
                            throw new Error('All fields in subsequent rows must match the fields in the first row');
                        }
                        
                        if (index === -1) {
                            this.fields.push(field);
                            index = this.fields.length - 1;
                        }
                        if (!_.isArray(this.values[i])) {
                            this.values[i] = [];
                            this.valueOptions[i] = [];
                        }
                        this.values[i][index] = value;
                        this.valueOptions[i][index] = valueOptions;
                    }
                }
            }
        };
        
        cls.SetFieldBlock = class extends cls.AbstractSetFieldBlock {
            set(field, value, options) { this._set(field, value, options); }
            setFields(fields, valueOptions) { this._setFields(fields, valueOptions); }
            
            toParamString(options) {
                options = options || {};
                let buildParameterized = options.buildParameterized;
                
                if (this.fields.length <= 0) {
                    throw new Error('set() needs to be called');
                }
                
                let totalStr = '',
                    totalValues = [];
                
                for (let i = 0; i < this.fields.length; ++i) {
                    totalStr = pad(totalStr, ', ');
                    let field = this.formatFieldName(this.fields[i]),
                        value = this.values[0][i];
                    
                    if (typeof value === 'undefined') {
                        totalStr += field;
                    } else {
                        let ret = this.buildString(`${field} = ${this.options.parameterCharacter}`, [value], {
                            buildParameterized: buildParameterized,
                            formattingOptions: this.valueOptions[0][i]
                        });
                        
                        totalStr += ret.text;
                        Array.prototype.push.apply(totalValues, ret.values);
                    }
                }
                
                return {
                    text: `SET ${totalStr}`,
                    values: totalValues
                };
            }
        };
        
        cls.InsertFieldValueBlock = class extends cls.AbstractSetFieldBlock {
            set(field, value, options) {
                options = options || {};
                this._set(field, value, options);
            }
            
            setFields(fields, valueOptions) { this._setFields(fields, valueOptions); }
            setFieldsRows(fieldsRows, valueOptions) { this._setFieldsRows(fieldsRows, valueOptions); }
            
            toParamString(options) {
                options = options || {};
                let buildParameterized = options.buildParameterized,
                    fieldString = _.map(this.fields, (f) => { return this.formatFieldName(f); }).join(', '),
                    valueStrings = [],
                    totalValues = [];
                
                for (let i = 0; i < this.values.length; ++i) {
                    valueStrings[i] = '';
                    for (let j = 0; j < this.values[i].length; ++j) {
                        let ret = this.buildString(this.options.parameterCharacter, [this.values[i][j]], {
                            buildParameterized: buildParameterized,
                            formattingOptions: this.valueOptions[i][j]
                        });
                        Array.prototype.push.apply(totalValues, ret.values);
                        valueStrings[i] = pad(valueStrings[i], ', ');
                        valueStrings[i] += ret.text;
                    }
                }
                return {
                    text: fieldString.length ? `(${fieldString}) VALUES (${valueStrings.join('), (')})` : '',
                    values: totalValues
                };
            }
        };
        
        cls.InsertFieldsFromQueryBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.fields = [];
                this.query = null;
            }
            
            fromQuery(fields, selectQuery) {
                this.fields = _.map(fields, (v) => { return this.sanitizeField(v); }, this);
                this.query = this.sanitizeQueryBuilder(selectQuery);
            }
            
            toParamString(options) {
                options = options || {};
                let totalStr = '',
                    totalValues = [];
                
                if (this.fields.length && this.query) {
                    let queryParamString = this.query.toParamString({
                            buildParameterized: options.buildParameterized,
                            nested: true
                        }),
                        text = queryParamString.text,
                        values = queryParamString.values;
                    totalStr = `(${this.fields.join(', ')}) (${text})`;
                    totalValues = values;
                }
                
                return {
                    text: totalStr,
                    values: totalValues
                };
            }
        };
        
        cls.DistinctBlock = class extends cls.Block {
            distinct() { this.useDistinct = true; }
            
            toParamString() {
                return {
                    text: this.useDistinct ? 'DISTINCT' : '',
                    values: []
                };
            }
        };
        
        cls.GroupByBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.groups = [];
            }
            
            group(field) { this.groups.push(this.sanitizeField(field)); }
            
            toParamString(options) {
                options = options || {};
                return {
                    text: this.groups.length ? `GROUP BY ${this.groups.join(', ')}` : '',
                    values: []
                };
            }
        };
        
        cls.OffsetBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.offsets = null;
            }
            
            offset(start) { this.offsets = this.sanitizedLimitOffset(start); }
            
            toParamString() {
                return {
                    text: this.offsets ? `OFFSET ${this.offsets}` : '',
                    values: []
                };
            }
        };
        
        cls.AbstractConditionBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.conditions = [];
            }
            
            _condition(condition) {
                var values = _.rest(arguments);
                condition = this.sanitizeExpression(condition);
                this.conditions.push({
                    expr: condition,
                    values: values
                });
            }
            
            toParamString(options) {
                options = options || {};
                let totalStr = [],
                    totalValues = [];
                
                for (let condition of this.conditions) {
                    let expr = condition.expr,
                        values = condition.values,
                        ret = expr instanceof cls.Expression ? expr.toParamString({ buildParameterized: options.buildParameterized })
                            : this.buildString(expr, values, { buildParameterized: options.buildParameterized });
                    
                    if (ret.text.length) totalStr.push(ret.text);
                    Array.prototype.push.apply(totalValues, ret.values);
                }
                
                if (totalStr.length) totalStr = totalStr.join(') AND (');
                return {
                    text: totalStr.length ? `${this.options.verb} (${totalStr})` : '',
                    values: totalValues
                };
            }
        };
        
        cls.WhereBlock = class extends cls.AbstractConditionBlock {
            constructor(options) { super(extend({}, options, { verb: 'WHERE' })); }
            where() { this._condition.apply(this, arguments); }
        };
        
        cls.HavingBlock = class extends cls.AbstractConditionBlock {
            constructor(options) { super(extend({}, options, { verb: 'HAVING' })); }
            having() { this._condition.apply(this, arguments); }
        };
        
        cls.OrderByBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.orders = [];
            }
            
            order(field, asc) {
                var values = _.rest(arguments, 2);
                field = this.sanitizeField(field);
                asc = asc === undefined ? true : asc;
                asc = asc !== null ? !!asc : asc;
                
                this.orders.push({
                    field: field,
                    dir: asc,
                    values: values
                });
            }
            
            toParamString(options) {
                options = options || {};
                let totalStr = '',
                    totalValues = [];
                
                for (let order of this.orders) {
                    let field = order.field,
                        dir = order.dir,
                        values = order.values;
                    totalStr = pad(totalStr, ', ');
                    let ret = this.buildString(field, values, { buildParameterized: options.buildParameterized });
                    
                    totalStr += ret.text;
                    Array.prototype.push.apply(totalValues, ret.values);
                    if (dir !== null) totalStr += ` ${dir ? 'ASC' : 'DESC'}`;
                }
                
                return {
                    text: totalStr.length ? `ORDER BY ${totalStr}` : '',
                    values: totalValues
                };
            }
        };
        
        cls.LimitBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.limit = null;
            }
            
            limit(limit) { this.limit = this.sanitizeLimitOffset(limit); }
            
            toParamString() {
                return {
                    text: this.limit !== null ? `LIMIT ${this.limit}` : '',
                    values: []
                };
            }
        };
        
        cls.JoinBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.joins = [];
            }
            
            join(table, alias, condition, type) {
                alias = alias || null;
                condition = condition || null;
                type = type || 'INNER';
                table = this.sanitizeTable(table, true);
                alias = alias ? this.sanitizeTableAlias(alias) : alias;
                condition = condition ? this.sanitizeExpression(condition) : condition;
                
                this.joins.push( {
                    type: type,
                    table: table,
                    alias: alias,
                    condition: condition
                });
            }
            
            left_join(table, alias, condition) {
                alias = alias || null;
                condition = condition || null;
                this.join(table, alias, condition, 'LEFT');
            }
            
            right_join(table, alias, condition) {
                alias = alias || null;
                condition = condition || null;
                this.join(table, alias, condition, 'RIGHT');
            }
            
            outer_join(table, alias, condition) {
                alias = alias || null;
                condition = condition || null;
                this.join(table, alias, condition, 'OUTER');
            }
            
            left_outer_join(table, alias, condition) {
                alias = alias || null;
                condition = condition || null;
                this.join(table, alias, condition, 'LEFT OUTER');
            }
            
            full_join(table, alias, condition) {
                alias = alias || null;
                condition = condition || null;
                this.join(table, alias, condition, 'FULL');
            }
            
            cross_join(table, alias, condition) {
                alias = alias || null;
                condition = condition || null;
                this.join(table, alias, condition, 'CROSS');
            }
            
            toParamString(options) {
                options = options || {};
                let totalStr = '',
                    totalValues = [];
                
                for (let join of this.joins) {
                    let type = join.type,
                        table = join.table,
                        alias = join.alias,
                        condition = join.condition;
                    totalStr = pad(totalStr, this.options.separator);
                    let tableStr;
                    if (table instanceof cls.BaseBuilder) {
                        let ret = table.toParamString({
                            buildParameterized: options.buildParameterized,
                            nested: true
                        });
                        Array.prototype.push.apply(totalValues, ret.values);
                        tableStr = ret.text;
                    } else {
                        tableStr = this.formatTableName(table);
                    }
                    
                    totalStr += `${type} JOIN ${tableStr}`;
                    if (alias) totalStr += ` ${this.formatTableAlias(alias)}`;
                    if (condition) {
                        totalStr += ' ON ';
                        let ret;
                        if (condition instanceof cls.Expression) {
                            ret = condition.toParamString({ buildParameterized: options.buildParameterized });
                        } else {
                            ret = this.buildString(condition, [], { buildParameterized: options.buildParameterized });
                        }
                        
                        totalStr += this.applyNestingFormatting(ret.text);
                        Array.prototype.push.apply(totalValues, ret.values);
                    }
                }
                
                return {
                    text: totalStr,
                    values: totalValues
                };
            }
        };
        
        cls.UnionBlock = class extends cls.Block {
            constructor(options) {
                super(options);
                this.unions = [];
            }
            
            union(table, type) {
                type = type || 'UNION';
                table = this.sanitizeTable(table);
                this.unions.push({
                    type: type,
                    table: table
                });
            }
            
            union_all(table) { this.union(table, 'UNION ALL'); }
            
            toParamString(options) {
                options = options || {};
                let totalStr = '',
                    totalValues = [];
                
                for (let union of this.unions) {
                    let type = union.type,
                        table = union.table;
                    totalStr = pad(totalStr, this.options.separator);
                    
                    let tableStr;
                    if (table instanceof cls.BaseBuilder) {
                        let ret = table.toParamString({
                            buildParameterized: options.buildParameterized,
                            nested: true
                        });
                        tableStr = ret.text;
                        Array.prototype.push.apply(totalValues, ret.values);
                    } else {
                        totalStr = this.formattableName(table);
                    }
                    
                    totalStr += `${type} ${tableStr}`;
                }
                
                return {
                    text: totalStr,
                    values: totalValues
                };
            }
        };
        
        /***********************************************************************
         * Query builders
         **********************************************************************/
        
        cls.QueryBuilder = class extends cls.BaseBuilder {
            constructor(options, blocks) {
                super(options);
                this.blocks = blocks || [];
                
                for (let block of this.blocks) {
                    let exposedMethods = block.exposedMethods();
                    for (let methodName in exposedMethods) {
                        let methodBody = exposedMethods[methodName];
                        
                        if (this[methodName] !== undefined) {
                            throw new Error(`Builder already has a builder method called: ${methodName}`);
                        }
                        
                        var self = this;
                        (function (block, name, body) {
                            self[name] = function() {
                                var args = _.toArray(arguments);
                                //args.unshift(block);
                                body.apply(block, arguments);
                                return self;
                            };
                        })(block, methodName, methodBody);
                    }
                }
            }
            
            registerValuesHandler(type, handler) {
                for (let block of this.blocks) {
                    block.registerValueHandler(type, handler);
                }
                super.registerValueHandler(tpye, handler);
                return this;
            }
            
            updateOptions(options) {
                this.options = extend({}, this.options, options);
                for (let block of this.blocks) {
                    block.options = extend({}, block.options, options);
                }
            }
            
            toParamString(options) {
                options = options || {};
                options = extend({}, this.options, options);
                
                let blockResults = _.map(this.blocks, (b) => {
                        return b.toParamString({
                            buildParameterized: options.buildParameterized,
                            queryBuilder: this
                        });
                    }, this),
                    blockTexts = _.map(blockResults, (b) => { return b.text; }),
                    blockValues = _.map(blockResults, (b) => { return b.values; }),
                    totalStr = _.filter(blockTexts, (v) => { return v.length > 0; }).join(options.separator),
                    totalValues = [];
                totalValues = Array.prototype.concat.apply(totalValues, blockValues);
                
                if (!options.nested) {
                    if (options.numberedParameters) {
                        let i = options.numberedParametersStartAt !== undefined ? options.numberedParametersStartAt : 1;
                        const regex = options.parameterCharacter.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                        totalStr = totalStr.replace(new RegExp(regex, 'g'), function() { return `${options.numberedParametersPrefix}${i++}`; });
                    }
                }
                
                return {
                    text: this.applyNestingFormatting(totalStr, !!options.nested),
                    values: totalValues
                };
            }
            
            clone() {
                let blockClones = _.map(this.blocks, (v) => { return v.clone(); });
                return new this.constructor(this.options, blockClones);
            }
            
            getBlock(blockType) { return _.find(this.blocks, (b) => { return b instanceof blockType; }); }
        };
        
        cls.Select = class extends cls.QueryBuilder {
            constructor(options, blocks) {
                blocks = blocks || null;
                blocks = blocks || [
                    new cls.StringBlock(options, 'SELECT'),
                    new cls.FunctionBlock(options),
                    new cls.DistinctBlock(options),
                    new cls.GetFieldBlock(options),
                    new cls.FromTableBlock(options),
                    new cls.JoinBlock(options),
                    new cls.WhereBlock(options),
                    new cls.GroupByBlock(options),
                    new cls.HavingBlock(options),
                    new cls.OrderByBlock(options),
                    new cls.LimitBlock(options),
                    new cls.OffsetBlock(options),
                    new cls.UnionBlock(options)
                ];
                super(options, blocks);
            }
        };
        
        cls.Update = class extends cls.QueryBuilder {
            constructor(options, blocks) {
                blocks = blocks || null;
                blocks = blocks || [
                    new cls.StringBlock(options, 'UPDATE'),
                    new cls.UpdateTableBlock(options),
                    new cls.SetFieldBlock(options),
                    new cls.WhereBlock(options),
                    new cls.OrderByBlock(options),
                    new cls.LimitBlock(options)
                ];
                super(options, blocks);
            }
        };
        
        cls.Delete = class extends cls.QueryBuilder {
            constructor(options, blocks) {
                blocks = blocks || null;
                blocks = blocks || [
                    new cls.StringBlock(options, 'DELETE'),
                    new cls.FromTableBlock(extend({}, options, { singleTable: true })),
                    new cls.JoinBlock(options),
                    new cls.WhereBlock(options),
                    new cls.OrderByBlock(options),
                    new cls.LimitBlock(options)
                ];
                super(options, blocks);
            }
        };
        
        cls.Insert = class extends cls.QueryBuilder {
            constructor(options, blocks) {
                blocks = blocks || null;
                blocks = blocks || [
                    new cls.StringBlock(options, 'INSERT'),
                    new cls.IntoTableBlock(options),
                    new cls.InsertFieldValueBlock(options),
                    new cls.InsertFieldsFromQueryBlock(options)
                ];
                super(options, blocks);
            }
        };
        
        let jsql = {
            VERSION: `JSQL VERSION ${version}`,
            expr: function(options) { return new cls.Expression(options); },
            case: function(name, options) { return new cls.Case(name, options); },
            select: function(options, blocks) { return new cls.Select(options, blocks); },
            update: function(options, blocks) { return new cls.Update(options, blocks); },
            insert: function(options, blocks) { return new cls.Insert(options, blocks); },
            delete: function(options, blocks) { return new cls.Delete(options, blocks); },
            str: function() {
                var args = _.toArray(arguments);
                let inst = new cls.FunctionBlock();
                inst.function.apply(inst, args);
                return inst;
            },
            registerValueHandler: cls.registerValueHandler
        };
        
        jsql.remove = jsql.delete;
        jsql.cls = cls;
        return jsql;
    }
    
    let jsql = buildSql();
    
    // SELECT examples
    log(jsql.select()
            .from('table'));
    log(jsql.select({ autoQuoteFieldNames: true })
            .from('table', 't1')
            .field('t1.id')
            .field('t1.name', 'My Name')
            .field('t1.started', 'Date')
            .order('id')
            .limit(20));
    log(jsql.select()
            .from('table', 't1')
            .field('t1.id')
            .field('t2.name')
            .left_join('table2', 't2', 't1.id = t2.id')
            .group('t1.id')
            .where('t2.name <> "Mark"')
            .where('t2.name <> "John"'));
    log(jsql.select()
            .from(jsql.select().from('students'), 's')
            .field('id')
            .join(jsql.select().from('marks').field('id'), 'm', 'm.id = s.id'));
    
    // UPDATE examples
    log(jsql.update()
            .table('test')
            .set('f1', 1));
    log(jsql.update()
            .table('test')
            .set('test.id', 1)
            .table('test2')
            .set('test2.val', 1.2)
            .table('test3', 'a')
            .setFields({
                'a.name': 'Ram',
                'a.email': null,
                'a.count = a.count + 1': undefined
            }));
    
    // INSERT examples
    log(jsql.insert()
            .into('test')
            .set('f1', 1));
    log(jsql.insert()
            .into('test')
            .setFieldsRows([
                    { name: 'Thomas', age: 29 },
                    { name: 'Jane', age: 31 }
            ]));
    
    // DELETE examples
    log(jsql.delete()
            .from('test'));
    log(jsql.delete()
            .from('table1')
            .where('table1.id = ?', 2)
            .order('id', false)
            .limit(2));
    
    // toParam example
    log(jsql.insert()
            .into('test')
            .set('f1', 1)
            .set('f2', 1.2)
            .set('f3', true)
            .set('f4', 'blah')
            .set('f5', null)
            .toParam());
    
    // Expression builder
    log(jsql.expr()
            .or('test = 3')
            .or('test = 4'));
    log(jsql.expr()
            .and('test = 3')
            .and(jsql.expr()
                     .or('inner = 1')
                     .or('inner = 2'))
            .or(jsql.expr()
                    .and('inner = ?', 3)
                    .and('inner = ?', 4)
                    .or(jsql.expr().and('inner IN ?', ['str1', 'str2', null]))));
    log(jsql.select()
            .from('test')
            .join('test2', null, jsql.expr().and('test.id = test2.id'))
            .where(jsql.expr().or('test = 3').or('test = 4')));
    
    // Custom value types examples
    jsql.registerValueHandler(Date, function(date) {
        return `'${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}'`;
    });
    log(jsql.update()
            .table('students')
            .set('start_date', new Date(2013, 5, 1)));
    
    return {
        //SQL: SQL
    };
}());

on('ready', function() {
});