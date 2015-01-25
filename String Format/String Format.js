/**
 * Formats a composite format string for fast formatting
 * and concatenation.
 *
 * Composite format strings may contain placeholders in the form
 * of: {index[,alignment][:format]}. The index component is mandatory,
 * and allows a mapping between the placeholder and the supplied
 * arguments to the format function. The alignment compoent specifies
 * a minimum width for the placeholder, and is optional. The format
 * component may specify some kind of transformation to perform
 * on the input argument.
 *
 * If you wish to include braces in the output, you must escape them
 * by including an additional brace. For example, "{{" would produce
 * "{" in the output, while "}}" would produce "}".
 */
var bshields = bshields || {};
bshields.format = (function() {
    'use strict';
    
    var version = 1.0,
        matchStandardNumericFormatString = /^[cdefgnpx][0-9]{0,2}$/i,
        matchStandardDateFormatString = /^[dDfFgGmMoOrRstTuyY]$/,
        simpleMatch = /^\{(\d+)(?:,(\d+))?(?::(.+?))?\}$/;
    
    function repeat(string, amount) {
        if (amount <= 0) {
            return '';
        }
        
        if (string.repeat) {
            return string.repeat(amount);
        } else {
            return _.map(_.range(amount), function(num) { return string; }).join('');
        }
    }
    
    function tokenize(formatString) {
        var openBracket = false,
            indexComponent = false,
            alignmentComponent = false,
            formatComponent = false,
            safeIndex = 0,
            componentCharacters = 0,
            characters = formatString.split(''),
            result = [],
            buf = [];
        
        _.each(characters, function(character, index) {
            if (safeIndex > 0) {
                if (safeIndex !== index) {
                    return;
                } else {
                    safeIndex = 0;
                }
            }
            if (openBracket) {
                buf.push(character);
                if (indexComponent) {
                    // Character may be integer digit
                    // Comma advances to alignmentComponent
                    // Colon advances to formatComponent
                    // *SINGLE* closing bracket finishes placeholder
                    if (_.isFinite(character)) {
                        componentCharacters++;
                    } else if (character === ',') {
                        if (componentCharacters === 0) {
                            if (result.length > 0) {
                                _.each(result.pop().split('').reverse(), function(c) {
                                    buf.unshift(c);
                                });
                            }
                            indexComponent = false;
                            openBracket = false;
                        } else {
                            indexComponent = false;
                            alignmentComponent = true;
                            componentCharacters = 0;
                        }
                    } else if (character === ':') {
                        if (componentCharacters === 0) {
                            if (result.length > 0) {
                                _.each(result.pop().split('').reverse(), function(c) {
                                    buf.unshift(c);
                                });
                            }
                            indexComponent = false;
                            openBracket = false;
                        } else {
                            indexComponent = false;
                            formatComponent = true;
                            componentCharacters = 0;
                        }
                    } else if (character === '}') {
                        if (componentCharacters === 0) {
                            if (result.length > 0) {
                                _.each(result.pop().split('').reverse(), function(c) {
                                    buf.unshift(c);
                                });
                            }
                            indexComponent = false;
                            openBracket = false;
                        } else {
                            indexComponent = false;
                            openBracket = false;
                            componentCharacters = 0;
                            
                            if ((index < characters.length - 1 && characters[index + 1] !== '}')
                                || index === characters.length - 1) {
                                result.push(buf.join(''));
                                buf = [];
                            } else {
                                // We thought we were in a placeholder, but it ends with }}
                                for (safeIndex = index + 1; safeIndex < characters.length; safeIndex++) {
                                    if (characters[safeIndex] === '}') {
                                        buf.push(characters[safeIndex]);
                                    } else {
                                        break;
                                    }
                                }
                                
                                if (result.length > 0) {
                                    _.each(result.pop().split('').reverse(), function(c) {
                                        buf.unshift(c);
                                    });
                                }
                            }
                        }
                    } else {
                        // Invalid character
                        indexComponent = false;
                        openBracket = false;
                        componentCharacters = 0;
                        if (result.length > 0) {
                            _.each(result.pop().split('').reverse(), function(c) {
                                buf.unshift(c);
                            });
                        }
                    }
                } else if (alignmentComponent) {
                    // Character may be integer digit
                    // Colon advances to formatComponent
                    // *SINGLE* closing bracket finishes placeholder
                    if (_.isFinite(character)) {
                        componentCharacters++;
                    } else if (character === ':') {
                        if (componentCharacters === 0) {
                            if (result.length > 0) {
                                _.each(result.pop().split('').reverse(), function(c) {
                                    buf.unshift(c);
                                });
                            }
                            alignmentComponent = false;
                            openBracket = false;
                        } else {
                            alignmentComponent = false;
                            formatComponent = true;
                            componentCharacters = 0;
                        }
                    } else if (character === '}') {
                        if (componentCharacters === 0) {
                            if (result.length > 0) {
                                _.each(result.pop().split('').reverse(), function(c) {
                                    buf.unshift(c);
                                });
                            }
                            alignmentComponent = false;
                            openBracket = false;
                        } else {
                            alignmentComponent = false;
                            openBracket = false;
                            componentCharacters = 0;
                            
                            if ((index < characters.length - 1 && characters[index + 1] !== '}')
                                || index === characters.length - 1) {
                                result.push(buf.join(''));
                                buf = [];
                            } else {
                                // We thought we were in a placeholder, but it ends with }}
                                for (safeIndex = index + 1; safeIndex < characters.length; safeIndex++) {
                                    if (characters[safeIndex] === '}') {
                                        buf.push(characters[safeIndex]);
                                    } else {
                                        break;
                                    }
                                }
                                
                                if (result.length > 0) {
                                    _.each(result.pop().split('').reverse(), function(c) {
                                        buf.unshift(c);
                                    });
                                }
                            }
                        }
                    } else {
                        // Invalid character
                        alignmentComponent = false;
                        openBracket = false;
                        componentCharacters = 0;
                        if (result.length > 0) {
                            _.each(result.pop().split('').reverse(), function(c) {
                                buf.unshift(c);
                            });
                        }
                    }
                } else if (formatComponent) {
                    // *SINGLE* closing bracket finishes placeholder
                    if (character === '}') {
                        if (componentCharacters === 0) {
                            if (result.length > 0) {
                                _.each(result.pop().split('').reverse(), function(c) {
                                    buf.unshift(c);
                                });
                            }
                            alignmentComponent = false;
                            openBracket = false;
                        } else {
                            formatComponent = false;
                            openBracket = false;
                            componentCharacters = 0;
                            
                            if ((index < characters.length - 1 && characters[index + 1] !== '}')
                                || index === characters.length - 1) {
                                result.push(buf.join(''));
                                buf = [];
                            } else {
                                // We thought we were in a placeholder, but it ends with }}
                                for (safeIndex = index + 1; safeIndex < characters.length; safeIndex++) {
                                    if (characters[safeIndex] === '}') {
                                        buf.push(characters[safeIndex]);
                                    } else {
                                        break;
                                    }
                                }
                                
                                if (result.length > 0) {
                                    _.each(result.pop().split('').reverse(), function(c) {
                                        buf.unshift(c);
                                    });
                                }
                            }
                        }
                    } else {
                        // All other characters are valid
                        componentCharacters++;
                    }
                }
            } else {
                // *SINGLE* opening bracket begins placeholder
                if (character === '{') {
                    if (index < characters.length - 1 && characters[index + 1] !== '{') {
                        result.push(buf.join(''));
                        buf = [character];
                        openBracket = true;
                        indexComponent = true;
                    } else {
                        // Consume all `{` in a row
                        buf.push(character);
                        for (safeIndex = index + 1; safeIndex < characters.length; safeIndex++) {
                            if (characters[safeIndex] === '{') {
                                buf.push(characters[safeIndex]);
                            } else {
                                break;
                            }
                        }
                    }
                } else {
                    buf.push(character);
                }
            }
        });
        
        if (buf.length > 0) {
            result.push(buf.join(''));
        }
        
        return result;
    }
    
    function getDefaultPrecision(format) {
        switch (format) {
            case 'c': return 2;
            case 'd': return -1;
            case 'e': return 6;
            case 'f': return 2;
            case 'g': return 15;
            case 'n': return 2;
            case 'p': return 2;
            case 'x': return -1;
            // no default case; we ensure `format` is correct with regex before calling this function
        }
    }
    
    function findExponential(number) {
        var exp = number.toExponential();
        
        return parseInt(exp.substring(exp.indexOf('+') + 1), 10);
    }
    
    function standardNumericFormat(number, format, precision) {
        var formatString, tmp;
        
        number = parseFloat(number, 10);
        precision = precision || getDefaultPrecision(format);
        
        formatString = '';
        tmp = number.toString(16);
        
        if (precision < 0) {
            if (format === 'x') {
                precision = tmp.length;
            } else {
                precision = number.toString().length;
            }
        }
        
        switch (format) {
            case 'c':
                formatString = '$#,#';
                if (precision > 0) {
                    formatString += '.';
                }
                formatString += repeat('0', precision);
                break;
            case 'd':
                formatString = repeat('0', precision);
                break;
            case 'e':
                formatString = '0';
                if (precision > 0) {
                    formatString += '.';
                }
                formatString += repeat('0', precision) + 'e+000';
                break;
            case 'f':
                formatString = '#';
                if (precision > 0) {
                    formatString += '.';
                }
                formatString += repeat('0', precision);
                break;
            case 'g':
                if (findExponential(number) > -5 && findExponential(number) < precision) {
                    return standardNumericFormat(number, 'f', precision);
                } else {
                    return standardNumericFormat(number, 'e', precision);
                }
            case 'n':
                formatString = '#,#';
                if (precision > 0) {
                    formatString += '.';
                }
                formatString += repeat('0', precision);
                break;
            case 'p':
                formatString = '#';
                if (precision > 0) {
                    formatString += '.';
                }
                formatString += repeat('0', precision) + ' %';
                break;
            case 'x':
                tmp = number.toString(16);
                return repeat('0', precision - tmp.length) + tmp;
            // skipped 'r' case, as JS doesn't give proper low-level access for it
            // no default case; we ensure `format` is correct with regex before calling this function
        }
        return customNumericFormat(number, formatString);
    }
    
    function standardDateFormat(date, format) {
        var formatString;
        
        switch (format) {
            case 'd':
                formatString = 'M/d/yyyy';
                break;
            case 'D':
                formatString = 'dddd, MMMM dd, yyyy';
                break;
            case 'f':
                formatString = 'dddd, MMMM dd, yyyy h:mm tt';
                break;
            case 'F':
                formatString = 'dddd, MMMM dd, yyyy h:mm:ss tt';
                break;
            case 'g':
                formatString = 'M/d/yyyy h:mm tt';
                break;
            case 'G':
                formatString = 'M/d/yyyy h:mm:ss tt';
                break;
            case 'M':
                // fallthrough
            case 'm':
                formatString = 'MMMM dd';
                break;
            case 'O':
                // fallthrough
            case 'o':
                formatString = 'yyyy-MM-ddTHH:mm:ssZ';
                break;
            case 'R':
                //fallthrough
            case 'r':
                formatString = 'ddd, dd MMM yyyy HH:mm:ss "GMT"';
                break;
            case 's':
                formatString = 'yyyy-MM-ddTHH:mm:ss';
                break;
            case 't':
                formatString = 'h:mm tt';
                break;
            case 'T':
                formatString = 'h:mm:ss tt';
                break;
            case 'u':
                formatString = 'yyyy-MM-dd HH:mm:ssZ';
                break;
            case 'Y':
                //fallthrough
            case 'y':
                formatString = 'MMMM, yyyy';
                break;
            // skipped 'U' case, as JS uses UTC already
        }
        
        return customDateFormat(date, formatString);
    }
    
    function customNumericFormat(number, format) {
        var sections = format.split(';');
        
        number = parseFloat(number, 10);
        _.each(sections, function(section, index) {
            sections[index] = section.trim();
        });
        
        if (sections.length === 1) {
            customNumericFormatHelper(number, sections[0]);
        } else if (sections.length === 2) {
            customNumericFormatHelper(number, sections[number >= 0 ? 0 : 1], sections[0]);
        } else if (sections.length === 3) {
            if (number > 0) {
                customNumericFormatHelper(number, sections[0], sections[2]);
            } else if (number < 0) {
                customNumericFormatHelper(number, sections[1] || sections[0], sections[2]);
            } else {
                customNumericFormatHelper(number, sections[2]);
            }
        }
    }
    
    function customNumericFormatHelper(number, format, formatIfRoundToZero) {
        var integerPart, fractionalPart, numberIsNotZero,
            explicitDecimal = format.indexOf('.') >= 0,
            decimalPlace = explicitDecimal ? format.indexOf('.') : format.length,
            fmtIntegralPart = format.substring(0, decimalPlace),
            fmtDecimalPart = (explicitDecimal ? format.substring(decimalPlace + 1) : '')
                            .split(',').join('').split('.').join(''),
            scalingSpecifier = 1,
            explicitSeparator, separatorPlace,
            isPercentage = format.indexOf('%') >= 0,
            isPermille = format.indexOf('\u2030') >= 0,
            isExponentNotation = /e[\+\-]?0+/i.test(format),
            alwaysShowExponent = isExponentNotation ? /e\+0+/i.test(format) : false,
            exponentPrecision = isExponentNotation ? format.replace(/^.*?e[\+\-]?(0+).*?$/i, '$1').length : -1;
        
        /**
         * TODO: handle escaped characters
         * # 0 . , % \u2030 E e + -
         * All need to be considered as possible for escaping necessity
         */
        
        // Split actual number into parts
        number = parseFloat(number, 10);
        numberIsNotZero = number !== 0;
        integerPart = parseInt(number, 10);
        if (number.toString().indexOf('.') >= 0) {
            fractionalPart = number.toString().substring(number.toString().indexOf('.') + 1);
        } else {
            fractionalPart = '0';
        }
        fractionalPart = parseInt(fractionalPart, 10) / Math.pow(10, fractionalPart.length);
        
        // All decimals after the first are ignored
        if (explicitDecimal) {
            format = format.split('.');
            format[0] += '.';
            format = format.join('');
        }
        
        // Consecutive commas before decimal are tallied for scaling then discarded
        fmtIntegralPart = _.reduceRight(fmtIntegralPart.split(''), function(memo, chr) {
            if (chr === ',' && !memo.integral) {
                return { scale: memo.scale * 1000, integral: memo.integral };
            } else {
                return { scale: memo.scale, integral: chr + memo.integral };
            }
        }, { scale: 1, integral: '' });
        scalingSpecifier = fmtIntegralPart.scale;
        fmtIntegralPart = fmtIntegralPart.integral;
        
        // All grouping commas after the first are discarded
        explicitSeparator = /(?:#|0),(?:#|0)/.test(fmtIntegralPart);
        separatorPlace = explicitSeparator ? fmtIntegralPart.match(/(?:#|0),(?:#|0)/).index + 1 : -1;
        if (explicitSeparator) {
            fmtIntegralPart = fmtIntegralPart.split(',');
            fmtIntegralPart[0] += ',';
            fmtIntegralPart = fmtIntegralPart.join('');
        }
        
        if (isExponentNotation) {
            fmtIntegralPart = fmtIntegralPart.split(/e[\+\-]?0+/i).join('');
            fmtDecimalPart = fmtDecimalPart.split(/e[\+\-]?0+/i).join('');
        }
        log(format);
        log(fmtIntegralPart);
        log(fmtDecimalPart);
        
        /*
        // after rounding `number`
        if (numberIsNotZero && number === 0 && formatIfRoundToZero) {
            return customNumericFormatHelper(number, formatIfRoundToZero);
        }
        */
    }
    
    function customDateFormat(date, format) {
        var dayOfWeek, dayOfMonth, preMap, map,
            milliseconds, deciseconds, decaseconds,
            era, hour12, hour24, year, decade,
            month, monthFull, seconds,
            aP, amPM, minute, month,
            result = format,
            quotedDictionary = [];
        
        date = new Date(date);
        dayOfWeek = getDayOfWeek(date.getUTCDay());
        dayOfMonth = date.getUTCDate();
        milliseconds = date.getUTCMilliseconds();
        deciseconds = parseInt(milliseconds / 10, 10);
        decaseconds = parseInt(milliseconds / 100, 10);
        era = date.getUTCFullYear() >= 0 ? 'A.D.' : 'B.C.';
        hour24 = date.getUTCHours();
        hour12 = hour24 % 12;
        minute = date.getUTCMinutes();
        month = getMonth(date.getUTCMonth());
        seconds = date.getUTCSeconds();
        amPM = hour24 < 12 ? 'A.M.' : 'P.M.';
        aP = amPM[0];
        year = date.getFullYear();
        decade = Math.round(((year / 100) - parseInt(year / 100, 10)) * 100);
        
        if (/^%[dfFgmMsty]$/.test(result)) {
            result = result.substring(1);
        }
        
        preMap = ['\\"', '\\\'', '\\d', '\\f', '\\F', '\\g', '\\h', '\\H', '\\K', '\\m', '\\M', '\\s', '\\t', '\\y'];
        
        map = {
            'dddd': dayOfWeek.full,
            'ddd': dayOfWeek.abbr,
            'dd': (dayOfMonth < 10 ? '0' : '') + dayOfMonth,
            'd': dayOfMonth,
            // JS doesn't store fractional milliseconds (ffff, fffff, ffffff, fffffff, and upper-case of the same)
            'fff': (milliseconds < 100 ? '0' : '') + (milliseconds < 10 ? '0' : '') + milliseconds,
            'FFF': milliseconds > 0 ? (milliseconds < 100 ? '0' : '') + (milliseconds < 10 ? '0' : '') + milliseconds : '',
            'ff': (deciseconds < 10 ? '0' : '') + deciseconds,
            'FF': deciseconds > 0 ? (deciseconds < 10 ? '0' : '') + deciseconds : '',
            'f': decaseconds,
            'F': decaseconds > 0 ? decaseconds : '',
            'gg': era,
            'g': era,
            'hh': (hour12 < 10 ? '0' : '') + hour12,
            'h': hour12,
            'HH': (hour24 < 10 ? '0' : '') + hour24,
            'H': hour24,
            'K': 'Z', // Cheating
            'mm': (minute < 10 ? '0' : '') + minute,
            'm': minute,
            'MMMM': month.full,
            'MMM': month.abbr,
            'MM': (month.n < 10 ? '0' : '') + month.n,
            'M': month.n,
            'ss': (seconds < 10 ? '0' : '') + seconds,
            's': seconds,
            'tt': amPM,
            't': aP,
            'yyyyy': (year < 10000 ? '0' : '') + (year < 1000 ? '0' : '') + (year < 100 ? '0' : '')
                + (year < 10 ? '0' : '') + year,
            'yyyy': year > 9999 ? (year - parseInt(year / 1000, 10))
                : ((year < 1000 ? '0' : '') + (year < 100 ? '0' : '') + (year < 10 ? '0' : '') + year),
            'yyy': (year < 100 ? '0' : '') + (year < 10 ? '0' : '') + year,
            'yy': (decade < 10 ? '0' : '') + decade,
            'y': decade
            // Not using UTC offset (zzz, zz, and z)
        };
        
        _.each(preMap, function(char, index) { result = result.replace(char, String.fromCharCode(index)); });
        result.replace(/("|')(.+?)\1/, function(match, p1, p2) {
            result = result.replace(match,
                String.fromCharCode(preMap.length) + quotedDictionary.length + String.fromCharCode(preMap.length));
            quotedDictionary.push(p2);
        });
        result = result.replace(new RegExp(_.keys(map).join('|'), 'g'), function(matched) { return map[matched]; });
        _.each(preMap, function(char, index) { result = result.replace(String.fromCharCode(index), char.substring(1)); });
        
        _.each(quotedDictionary, function(element, index) {
            result = result.replace(String.fromCharCode(preMap.length) + index + String.fromCharCode(preMap.length), element);
        });
        
        return result;
    }
    
    function getMonth(mon) {
        switch (mon) {
            case 0: return  { n: 1,  abbr: 'Jan', full: 'January' };
            case 1: return  { n: 2,  abbr: 'Feb', full: 'February' };
            case 2: return  { n: 3,  abbr: 'Mar', full: 'March' };
            case 3: return  { n: 4,  abbr: 'Apr', full: 'April' };
            case 4: return  { n: 5,  abbr: 'May', full: 'May' };
            case 5: return  { n: 6,  abbr: 'Jun', full: 'June' };
            case 6: return  { n: 7,  abbr: 'Jul', full: 'July' };
            case 7: return  { n: 8,  abbr: 'Aug', full: 'August' };
            case 8: return  { n: 9,  abbr: 'Sep', full: 'September' };
            case 9: return  { n: 10, abbr: 'Oct', full: 'October' };
            case 10: return { n: 11, abbr: 'Nov', full: 'November' };
            case 11: return { n: 12, abbr: 'Dec', full: 'December' };
        }
    }
    
    function getDayOfWeek(dow) {
        switch (dow) {
            case 0: return { abbr: 'Su', full: 'Sunday' };
            case 1: return { abbr: 'M',  full: 'Monday' };
            case 2: return { abbr: 'Tu', full: 'Tuesday' };
            case 3: return { abbr: 'W',  full: 'Wednesday' };
            case 4: return { abbr: 'Th', full: 'Thursday' };
            case 5: return { abbr: 'F',  full: 'Friday' };
            case 6: return { abbr: 'Sa', full: 'Saturday' };
        }
    }
    
    function format(format) {
        var args = _.toArray(arguments).slice(1),
            result = format,
            tokenizedResult = tokenize(result);
        
        _.each(tokenizedResult, function(token, index) {
            var parts = simpleMatch.exec(token),
                fulltext, replacementText,
                indexComponent, alignmentComponent, formatComponent;
            if (!parts) {
                return;
            }
            
            fulltext = parts.shift();
            indexComponent = parseInt(parts.shift(), 10);
            alignmentComponent = parseInt(parts.shift(), 10);
            formatComponent = parts.shift();
            if (indexComponent < args.length) {
                replacementText = args[indexComponent];
                
                if (formatComponent) {
                    if (matchStandardNumericFormatString.test(formatComponent) && _.isFinite(replacementText)) {
                        replacementText = standardNumericFormat(parseInt(replacementText, 10),
                                                                formatComponent[0].toLowerCase(),
                                                                parseInt(formatComponent.substring(1), 10));
                    } else if (matchStandardDateFormatString.test(formatComponent) && replacementText.constructor === Date) {
                        replacementText = standardDateFormat(replacementText, formatComponent);
                    } else if (_.isFinite(replacementText)) {
                        replacementText = customNumericFormat(parseInt(replacementText, 10), formatComponent);
                    } else if (replacementText.constructor === Date) {
                        replacementText = customDateFormat(replacementText, formatComponent);
                    }
                }
                result = result.replace(fulltext, replacementText);
            }
        });
        return result;
    }
    
    return format;
}());

String.prototype.format = String.prototype.format || function() {
    var args = _.toArray(arguments);
    args.unshift(this);
    return bshields.format.apply(bshields.format, args);
};

on('ready', function() {
    log('{0:#,000,00,00,,.00e+000}'.format(123.5));
    //log('  {0,5:d}'.format(123));
    //log('+ {0,5:d}'.format(234));
    //log('= {0,5:d}'.format(123+234));
    
    //log('foo{0}bar{1}'.format('123'));
    //log('foo{1,5}bar{2,1}'.format('123'));
    //log('foo{2:abc}bar{3:abc}'.format('123'));
    //log('foo{3,2:a34}bar{4,7:a4h}'.format('123'));
    //log('foo{}{0}bar{1,5}fizz{2:abc}buz{3,2:abc}'.format('123'));
    
    //log('Now: {0:r}'.format(new Date()));
    //log('Now: {0:ddd, dd MMM yyyy HH:mm:ss \'GMT\'}'.format(new Date()));
});