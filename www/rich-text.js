(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var diff = require('fast-diff');
var is = require('./is');
var op = require('./op');


var NULL_CHARACTER = String.fromCharCode(0);  // Placeholder char for embed in diff()


var Delta = function (ops) {
  // Assume we are given a well formed ops
  if (is.array(ops)) {
    this.ops = ops;
  } else if (is.object(ops) && is.array(ops.ops)) {
    this.ops = ops.ops;
  } else {
    this.ops = [];
  }
};


Delta.prototype.insert = function (text, attributes) {
  var newOp = {};
  if (is.string(text)) {
    if (text.length === 0) return this;
    newOp.insert = text;
  } else if (is.number(text)) {
    newOp.insert = text;
  }
  if (is.object(attributes) && Object.keys(attributes).length > 0) newOp.attributes = attributes;
  return this.push(newOp);
};

Delta.prototype['delete'] = function (length) {
  if (length <= 0) return this;
  return this.push({ 'delete': length });
};

Delta.prototype.retain = function (length, attributes) {
  if (length <= 0) return this;
  var newOp = { retain: length };
  if (is.object(attributes) && Object.keys(attributes).length > 0) newOp.attributes = attributes;
  return this.push(newOp);
};

Delta.prototype.push = function (newOp) {
  var index = this.ops.length;
  var lastOp = this.ops[index - 1];
  newOp = op.clone(newOp);
  if (is.object(lastOp)) {
    if (is.number(newOp['delete']) && is.number(lastOp['delete'])) {
      this.ops[index - 1] = { 'delete': lastOp['delete'] + newOp['delete'] };
      return this;
    }
    // Since it does not matter if we insert before or after deleting at the same index,
    // always prefer to insert first
    if (is.number(lastOp['delete']) && (is.string(newOp.insert) || is.number(newOp.insert))) {
      index -= 1;
      lastOp = this.ops[index - 1];
      if (!is.object(lastOp)) {
        this.ops.unshift(newOp);
        return this;
      }
    }
    if (is.equal(newOp.attributes, lastOp.attributes)) {
      if (is.string(newOp.insert) && is.string(lastOp.insert)) {
        this.ops[index - 1] = { insert: lastOp.insert + newOp.insert };
        if (is.object(newOp.attributes)) this.ops[index - 1].attributes = newOp.attributes
        return this;
      } else if (is.number(newOp.retain) && is.number(lastOp.retain)) {
        this.ops[index - 1] = { retain: lastOp.retain + newOp.retain };
        if (is.object(newOp.attributes)) this.ops[index - 1].attributes = newOp.attributes
        return this;
      }
    }
  }
  this.ops.splice(index, 0, newOp);
  return this;
};

Delta.prototype.chop = function () {
  var lastOp = this.ops[this.ops.length - 1];
  if (lastOp && lastOp.retain && !lastOp.attributes) {
    this.ops.pop();
  }
  return this;
};

Delta.prototype.length = function () {
  return this.ops.reduce(function (length, elem) {
    return length + op.length(elem);
  }, 0);
};

Delta.prototype.slice = function (start, end) {
  start = start || 0;
  if (!is.number(end)) end = Infinity;
  var delta = new Delta();
  var iter = op.iterator(this.ops);
  var index = 0;
  while (index < end && iter.hasNext()) {
    var nextOp;
    if (index < start) {
      nextOp = iter.next(start - index);
    } else {
      nextOp = iter.next(end - index);
      delta.push(nextOp);
    }
    index += op.length(nextOp);
  }
  return delta;
};


Delta.prototype.compose = function (other) {
  var thisIter = op.iterator(this.ops);
  var otherIter = op.iterator(other.ops);
  this.ops = [];
  while (thisIter.hasNext() || otherIter.hasNext()) {
    if (otherIter.peekType() === 'insert') {
      this.push(otherIter.next());
    } else if (thisIter.peekType() === 'delete') {
      this.push(thisIter.next());
    } else {
      var length = Math.min(thisIter.peekLength(), otherIter.peekLength());
      var thisOp = thisIter.next(length);
      var otherOp = otherIter.next(length);
      if (is.number(otherOp.retain)) {
        var newOp = {};
        if (is.number(thisOp.retain)) {
          newOp.retain = length;
        } else {
          newOp.insert = thisOp.insert;
        }
        // Preserve null when composing with a retain, otherwise remove it for inserts
        var attributes = op.attributes.compose(thisOp.attributes, otherOp.attributes, is.number(thisOp.retain));
        if (attributes) newOp.attributes = attributes;
        this.push(newOp);
      // Other op should be delete, we could be an insert or retain
      // Insert + delete cancels out
      } else if (is.number(otherOp['delete']) && is.number(thisOp.retain)) {
        this.push(otherOp);
      }
    }
  }
  return this.chop();
};

Delta.prototype.diff = function (other) {
  var strings = [this.ops, other.ops].map(function (ops) {
    return ops.map(function (op) {
      if (is.string(op.insert)) return op.insert;
      if (is.number(op.insert)) return NULL_CHARACTER;
      var prep = ops === other.ops ? 'on' : 'with';
      throw new Error('diff() called ' + prep + ' non-document');
    }).join('');
  });
  var diffResult = diff(strings[0], strings[1]);
  var thisIter = op.iterator(this.ops);
  var otherIter = op.iterator(other.ops);
  var delta = new Delta();
  diffResult.forEach(function (component) {
    var length = component[1].length;
    while (length > 0) {
      var opLength = 0;
      switch (component[0]) {
        case diff.INSERT:
          opLength = Math.min(otherIter.peekLength(), length);
          delta.push(otherIter.next(opLength));
          break;
        case diff.DELETE:
          opLength = Math.min(length, thisIter.peekLength());
          thisIter.next(opLength);
          delta['delete'](opLength);
          break;
        case diff.EQUAL:
          opLength = Math.min(thisIter.peekLength(), otherIter.peekLength(), length);
          var thisOp = thisIter.next(opLength);
          var otherOp = otherIter.next(opLength);
          if (thisOp.insert === otherOp.insert) {
            delta.retain(opLength, op.attributes.diff(thisOp.attributes, otherOp.attributes));
          } else {
            delta.push(otherOp)['delete'](opLength);
          }
          break;
      }
      length -= opLength;
    }
  });
  return delta.chop();
};

Delta.prototype.transform = function (other, priority) {
  priority = !!priority;
  if (is.number(other)) {
    return this.transformPosition(other, priority);
  }
  var thisIter = op.iterator(this.ops);
  var otherIter = op.iterator(other.ops);
  var delta = new Delta();
  while (thisIter.hasNext() || otherIter.hasNext()) {
    if (thisIter.peekType() === 'insert' && (priority || otherIter.peekType() !== 'insert')) {
      delta.retain(op.length(thisIter.next()));
    } else if (otherIter.peekType() === 'insert') {
      delta.push(otherIter.next());
    } else {
      var length = Math.min(thisIter.peekLength(), otherIter.peekLength());
      var thisOp = thisIter.next(length);
      var otherOp = otherIter.next(length);
      if (thisOp['delete']) {
        // Our delete either makes their delete redundant or removes their retain
        continue;
      } else if (otherOp['delete']) {
        delta.push(otherOp);
      } else {
        // We retain either their retain or insert
        delta.retain(length, op.attributes.transform(thisOp.attributes, otherOp.attributes, priority));
      }
    }
  }
  return delta.chop();
};

Delta.prototype.transformPosition = function (index, priority) {
  priority = !!priority;
  var thisIter = op.iterator(this.ops);
  var offset = 0;
  while (thisIter.hasNext() && offset <= index) {
    var length = thisIter.peekLength();
    var nextType = thisIter.peekType();
    thisIter.next();
    if (nextType === 'delete') {
      index -= Math.min(length, index - offset);
      continue;
    } else if (nextType === 'insert' && (offset < index || !priority)) {
      index += length;
    }
    offset += length;
  }
  return index;
};


module.exports = Delta;

},{"./is":2,"./op":3,"fast-diff":5}],2:[function(require,module,exports){
module.exports = {
  equal: function (a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (Object.keys(a).length != Object.keys(b).length) return false;
    for(var key in a) {
      // Only compare one level deep
      if (a[key] !== b[key]) return false;
    }
    return true;
  },

  array: function (value) {
    return Array.isArray(value);
  },

  number: function (value) {
    if (typeof value === 'number') return true;
    if (typeof value === 'object' && Object.prototype.toString.call(value) === '[object Number]') return true;
    return false;
  },

  object: function (value) {
    if (!value) return false;
    return (typeof value === 'function' || typeof value === 'object');
  },

  string: function (value) {
    if (typeof value === 'string') return true;
    if (typeof value === 'object' && Object.prototype.toString.call(value) === '[object String]') return true;
    return false;
  }
};

},{}],3:[function(require,module,exports){
var is = require('./is');


var lib = {
  attributes: {
    clone: function (attributes, keepNull) {
      if (!is.object(attributes)) return {};
      return Object.keys(attributes).reduce(function (memo, key) {
        if (attributes[key] !== undefined && (attributes[key] !== null || keepNull)) {
          memo[key] = attributes[key];
        }
        return memo;
      }, {});
    },

    compose: function (a, b, keepNull) {
      if (!is.object(a)) a = {};
      if (!is.object(b)) b = {};
      var attributes = this.clone(b, keepNull);
      for (var key in a) {
        if (a[key] !== undefined && b[key] === undefined) {
          attributes[key] = a[key];
        }
      }
      return Object.keys(attributes).length > 0 ? attributes : undefined;
    },

    diff: function(a, b) {
      if (!is.object(a)) a = {};
      if (!is.object(b)) b = {};
      var attributes = Object.keys(a).concat(Object.keys(b)).reduce(function (attributes, key) {
        if (a[key] !== b[key]) {
          attributes[key] = b[key] === undefined ? null : b[key];
        }
        return attributes;
      }, {});
      return Object.keys(attributes).length > 0 ? attributes : undefined;
    },

    transform: function (a, b, priority) {
      if (!is.object(a)) return b;
      if (!is.object(b)) return undefined;
      if (!priority) return b;  // b simply overwrites us without priority
      var attributes = Object.keys(b).reduce(function (attributes, key) {
        if (a[key] === undefined) attributes[key] = b[key];  // null is a valid value
        return attributes;
      }, {});
      return Object.keys(attributes).length > 0 ? attributes : undefined;
    }
  },

  clone: function (op) {
    var newOp = this.attributes.clone(op);
    if (is.object(newOp.attributes)) {
      newOp.attributes = this.attributes.clone(newOp.attributes, true);
    }
    return newOp;
  },

  iterator: function (ops) {
    return new Iterator(ops);
  },

  length: function (op) {
    if (is.number(op['delete'])) {
      return op['delete'];
    } else if (is.number(op.retain)) {
      return op.retain;
    } else {
      return is.string(op.insert) ? op.insert.length : 1;
    }
  }
};


function Iterator(ops) {
  this.ops = ops;
  this.index = 0;
  this.offset = 0;
};

Iterator.prototype.hasNext = function () {
  return this.peekLength() < Infinity;
};

Iterator.prototype.next = function (length) {
  if (!length) length = Infinity;
  var nextOp = this.ops[this.index];
  if (nextOp) {
    var offset = this.offset;
    var opLength = lib.length(nextOp)
    if (length >= opLength - offset) {
      length = opLength - offset;
      this.index += 1;
      this.offset = 0;
    } else {
      this.offset += length;
    }
    if (is.number(nextOp['delete'])) {
      return { 'delete': length };
    } else {
      var retOp = {};
      if (nextOp.attributes) {
        retOp.attributes = nextOp.attributes;
      }
      if (is.number(nextOp.retain)) {
        retOp.retain = length;
      } else if (is.string(nextOp.insert)) {
        retOp.insert = nextOp.insert.substr(offset, length);
      } else {
        // offset should === 0, length should === 1
        retOp.insert = nextOp.insert;
      }
      return retOp;
    }
  } else {
    return { retain: Infinity };
  }
};

Iterator.prototype.peekLength = function () {
  if (this.ops[this.index]) {
    // Should never return 0 if our index is being managed correctly
    return lib.length(this.ops[this.index]) - this.offset;
  } else {
    return Infinity;
  }
};

Iterator.prototype.peekType = function () {
  if (this.ops[this.index]) {
    if (is.number(this.ops[this.index]['delete'])) {
      return 'delete';
    } else if (is.number(this.ops[this.index].retain)) {
      return 'retain';
    } else {
      return 'insert';
    }
  }
  return 'retain';
};


module.exports = lib;

},{"./is":2}],4:[function(require,module,exports){
var Delta = require('./delta');
var pkg = require('../package.json');


module.exports = {
  Delta: Delta,
  type: {
    name: 'rich-text',
    uri: 'http://sharejs.org/types/rich-text/v1',

    create: function (initial) {
      return new Delta(initial);
    },

    apply: function (snapshot, delta) {
      snapshot = new Delta(snapshot);
      delta = new Delta(delta);
      return snapshot.compose(delta);
    },

    compose: function (delta1, delta2) {
      delta1 = new Delta(delta1);
      delta2 = new Delta(delta2);
      return delta1.compose(delta2);
    },

    diff: function (delta1, delta2) {
      delta1 = new Delta(delta1);
      delta2 = new Delta(delta2);
      return delta1.diff(delta2);
    },

    transform: function (delta1, delta2, side) {
      delta1 = new Delta(delta1);
      delta2 = new Delta(delta2);
      // Fuzzer specs is in opposite order of delta interface
      return delta2.transform(delta1, side === 'left');
    }
  }
};

// Needed for browserify front end build to attach the type to window.ottypes.
if (typeof(window) !== 'undefined') {
	var _types = window.ottypes = window.ottypes || {};
	var _t = module.exports;
	_types['rich-text'] = _t.type;

	if (_t.uri) _types[_t.uri] = _t.type;
}

},{"../package.json":6,"./delta":1}],5:[function(require,module,exports){
/**
 * This library modifies the diff-patch-match library by Neil Fraser
 * by removing the patch and match functionality and certain advanced
 * options in the diff function. The original license is as follows:
 *
 * ===
 *
 * Diff Match and Patch
 *
 * Copyright 2006 Google Inc.
 * http://code.google.com/p/google-diff-match-patch/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * The data structure representing a diff is an array of tuples:
 * [[DIFF_DELETE, 'Hello'], [DIFF_INSERT, 'Goodbye'], [DIFF_EQUAL, ' world.']]
 * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
 */
var DIFF_DELETE = -1;
var DIFF_INSERT = 1;
var DIFF_EQUAL = 0;


/**
 * Find the differences between two texts.  Simplifies the problem by stripping
 * any common prefix or suffix off the texts before diffing.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @return {Array} Array of diff tuples.
 */
function diff_main(text1, text2) {
  // Check for equality (speedup).
  if (text1 == text2) {
    if (text1) {
      return [[DIFF_EQUAL, text1]];
    }
    return [];
  }

  // Trim off common prefix (speedup).
  var commonlength = diff_commonPrefix(text1, text2);
  var commonprefix = text1.substring(0, commonlength);
  text1 = text1.substring(commonlength);
  text2 = text2.substring(commonlength);

  // Trim off common suffix (speedup).
  commonlength = diff_commonSuffix(text1, text2);
  var commonsuffix = text1.substring(text1.length - commonlength);
  text1 = text1.substring(0, text1.length - commonlength);
  text2 = text2.substring(0, text2.length - commonlength);

  // Compute the diff on the middle block.
  var diffs = diff_compute_(text1, text2);

  // Restore the prefix and suffix.
  if (commonprefix) {
    diffs.unshift([DIFF_EQUAL, commonprefix]);
  }
  if (commonsuffix) {
    diffs.push([DIFF_EQUAL, commonsuffix]);
  }
  diff_cleanupMerge(diffs);
  return diffs;
};


/**
 * Find the differences between two texts.  Assumes that the texts do not
 * have any common prefix or suffix.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @return {Array} Array of diff tuples.
 */
function diff_compute_(text1, text2) {
  var diffs;

  if (!text1) {
    // Just add some text (speedup).
    return [[DIFF_INSERT, text2]];
  }

  if (!text2) {
    // Just delete some text (speedup).
    return [[DIFF_DELETE, text1]];
  }

  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  var i = longtext.indexOf(shorttext);
  if (i != -1) {
    // Shorter text is inside the longer text (speedup).
    diffs = [[DIFF_INSERT, longtext.substring(0, i)],
             [DIFF_EQUAL, shorttext],
             [DIFF_INSERT, longtext.substring(i + shorttext.length)]];
    // Swap insertions for deletions if diff is reversed.
    if (text1.length > text2.length) {
      diffs[0][0] = diffs[2][0] = DIFF_DELETE;
    }
    return diffs;
  }

  if (shorttext.length == 1) {
    // Single character string.
    // After the previous speedup, the character can't be an equality.
    return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
  }

  // Check to see if the problem can be split in two.
  var hm = diff_halfMatch_(text1, text2);
  if (hm) {
    // A half-match was found, sort out the return data.
    var text1_a = hm[0];
    var text1_b = hm[1];
    var text2_a = hm[2];
    var text2_b = hm[3];
    var mid_common = hm[4];
    // Send both pairs off for separate processing.
    var diffs_a = diff_main(text1_a, text2_a);
    var diffs_b = diff_main(text1_b, text2_b);
    // Merge the results.
    return diffs_a.concat([[DIFF_EQUAL, mid_common]], diffs_b);
  }

  return diff_bisect_(text1, text2);
};


/**
 * Find the 'middle snake' of a diff, split the problem in two
 * and return the recursively constructed diff.
 * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @return {Array} Array of diff tuples.
 * @private
 */
function diff_bisect_(text1, text2) {
  // Cache the text lengths to prevent multiple calls.
  var text1_length = text1.length;
  var text2_length = text2.length;
  var max_d = Math.ceil((text1_length + text2_length) / 2);
  var v_offset = max_d;
  var v_length = 2 * max_d;
  var v1 = new Array(v_length);
  var v2 = new Array(v_length);
  // Setting all elements to -1 is faster in Chrome & Firefox than mixing
  // integers and undefined.
  for (var x = 0; x < v_length; x++) {
    v1[x] = -1;
    v2[x] = -1;
  }
  v1[v_offset + 1] = 0;
  v2[v_offset + 1] = 0;
  var delta = text1_length - text2_length;
  // If the total number of characters is odd, then the front path will collide
  // with the reverse path.
  var front = (delta % 2 != 0);
  // Offsets for start and end of k loop.
  // Prevents mapping of space beyond the grid.
  var k1start = 0;
  var k1end = 0;
  var k2start = 0;
  var k2end = 0;
  for (var d = 0; d < max_d; d++) {
    // Walk the front path one step.
    for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      var k1_offset = v_offset + k1;
      var x1;
      if (k1 == -d || (k1 != d && v1[k1_offset - 1] < v1[k1_offset + 1])) {
        x1 = v1[k1_offset + 1];
      } else {
        x1 = v1[k1_offset - 1] + 1;
      }
      var y1 = x1 - k1;
      while (x1 < text1_length && y1 < text2_length &&
             text1.charAt(x1) == text2.charAt(y1)) {
        x1++;
        y1++;
      }
      v1[k1_offset] = x1;
      if (x1 > text1_length) {
        // Ran off the right of the graph.
        k1end += 2;
      } else if (y1 > text2_length) {
        // Ran off the bottom of the graph.
        k1start += 2;
      } else if (front) {
        var k2_offset = v_offset + delta - k1;
        if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] != -1) {
          // Mirror x2 onto top-left coordinate system.
          var x2 = text1_length - v2[k2_offset];
          if (x1 >= x2) {
            // Overlap detected.
            return diff_bisectSplit_(text1, text2, x1, y1);
          }
        }
      }
    }

    // Walk the reverse path one step.
    for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      var k2_offset = v_offset + k2;
      var x2;
      if (k2 == -d || (k2 != d && v2[k2_offset - 1] < v2[k2_offset + 1])) {
        x2 = v2[k2_offset + 1];
      } else {
        x2 = v2[k2_offset - 1] + 1;
      }
      var y2 = x2 - k2;
      while (x2 < text1_length && y2 < text2_length &&
             text1.charAt(text1_length - x2 - 1) ==
             text2.charAt(text2_length - y2 - 1)) {
        x2++;
        y2++;
      }
      v2[k2_offset] = x2;
      if (x2 > text1_length) {
        // Ran off the left of the graph.
        k2end += 2;
      } else if (y2 > text2_length) {
        // Ran off the top of the graph.
        k2start += 2;
      } else if (!front) {
        var k1_offset = v_offset + delta - k2;
        if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] != -1) {
          var x1 = v1[k1_offset];
          var y1 = v_offset + x1 - k1_offset;
          // Mirror x2 onto top-left coordinate system.
          x2 = text1_length - x2;
          if (x1 >= x2) {
            // Overlap detected.
            return diff_bisectSplit_(text1, text2, x1, y1);
          }
        }
      }
    }
  }
  // Diff took too long and hit the deadline or
  // number of diffs equals number of characters, no commonality at all.
  return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
};


/**
 * Given the location of the 'middle snake', split the diff in two parts
 * and recurse.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} x Index of split point in text1.
 * @param {number} y Index of split point in text2.
 * @return {Array} Array of diff tuples.
 */
function diff_bisectSplit_(text1, text2, x, y) {
  var text1a = text1.substring(0, x);
  var text2a = text2.substring(0, y);
  var text1b = text1.substring(x);
  var text2b = text2.substring(y);

  // Compute both diffs serially.
  var diffs = diff_main(text1a, text2a);
  var diffsb = diff_main(text1b, text2b);

  return diffs.concat(diffsb);
};


/**
 * Determine the common prefix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the start of each
 *     string.
 */
function diff_commonPrefix(text1, text2) {
  // Quick check for common null cases.
  if (!text1 || !text2 || text1.charAt(0) != text2.charAt(0)) {
    return 0;
  }
  // Binary search.
  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
  var pointermin = 0;
  var pointermax = Math.min(text1.length, text2.length);
  var pointermid = pointermax;
  var pointerstart = 0;
  while (pointermin < pointermid) {
    if (text1.substring(pointerstart, pointermid) ==
        text2.substring(pointerstart, pointermid)) {
      pointermin = pointermid;
      pointerstart = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
};


/**
 * Determine the common suffix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the end of each string.
 */
function diff_commonSuffix(text1, text2) {
  // Quick check for common null cases.
  if (!text1 || !text2 ||
      text1.charAt(text1.length - 1) != text2.charAt(text2.length - 1)) {
    return 0;
  }
  // Binary search.
  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
  var pointermin = 0;
  var pointermax = Math.min(text1.length, text2.length);
  var pointermid = pointermax;
  var pointerend = 0;
  while (pointermin < pointermid) {
    if (text1.substring(text1.length - pointermid, text1.length - pointerend) ==
        text2.substring(text2.length - pointermid, text2.length - pointerend)) {
      pointermin = pointermid;
      pointerend = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
};


/**
 * Do the two texts share a substring which is at least half the length of the
 * longer text?
 * This speedup can produce non-minimal diffs.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {Array.<string>} Five element Array, containing the prefix of
 *     text1, the suffix of text1, the prefix of text2, the suffix of
 *     text2 and the common middle.  Or null if there was no match.
 */
function diff_halfMatch_(text1, text2) {
  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
    return null;  // Pointless.
  }

  /**
   * Does a substring of shorttext exist within longtext such that the substring
   * is at least half the length of longtext?
   * Closure, but does not reference any external variables.
   * @param {string} longtext Longer string.
   * @param {string} shorttext Shorter string.
   * @param {number} i Start index of quarter length substring within longtext.
   * @return {Array.<string>} Five element Array, containing the prefix of
   *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
   *     of shorttext and the common middle.  Or null if there was no match.
   * @private
   */
  function diff_halfMatchI_(longtext, shorttext, i) {
    // Start with a 1/4 length substring at position i as a seed.
    var seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
    var j = -1;
    var best_common = '';
    var best_longtext_a, best_longtext_b, best_shorttext_a, best_shorttext_b;
    while ((j = shorttext.indexOf(seed, j + 1)) != -1) {
      var prefixLength = diff_commonPrefix(longtext.substring(i),
                                           shorttext.substring(j));
      var suffixLength = diff_commonSuffix(longtext.substring(0, i),
                                           shorttext.substring(0, j));
      if (best_common.length < suffixLength + prefixLength) {
        best_common = shorttext.substring(j - suffixLength, j) +
            shorttext.substring(j, j + prefixLength);
        best_longtext_a = longtext.substring(0, i - suffixLength);
        best_longtext_b = longtext.substring(i + prefixLength);
        best_shorttext_a = shorttext.substring(0, j - suffixLength);
        best_shorttext_b = shorttext.substring(j + prefixLength);
      }
    }
    if (best_common.length * 2 >= longtext.length) {
      return [best_longtext_a, best_longtext_b,
              best_shorttext_a, best_shorttext_b, best_common];
    } else {
      return null;
    }
  }

  // First check if the second quarter is the seed for a half-match.
  var hm1 = diff_halfMatchI_(longtext, shorttext,
                             Math.ceil(longtext.length / 4));
  // Check again based on the third quarter.
  var hm2 = diff_halfMatchI_(longtext, shorttext,
                             Math.ceil(longtext.length / 2));
  var hm;
  if (!hm1 && !hm2) {
    return null;
  } else if (!hm2) {
    hm = hm1;
  } else if (!hm1) {
    hm = hm2;
  } else {
    // Both matched.  Select the longest.
    hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
  }

  // A half-match was found, sort out the return data.
  var text1_a, text1_b, text2_a, text2_b;
  if (text1.length > text2.length) {
    text1_a = hm[0];
    text1_b = hm[1];
    text2_a = hm[2];
    text2_b = hm[3];
  } else {
    text2_a = hm[0];
    text2_b = hm[1];
    text1_a = hm[2];
    text1_b = hm[3];
  }
  var mid_common = hm[4];
  return [text1_a, text1_b, text2_a, text2_b, mid_common];
};


/**
 * Reorder and merge like edit sections.  Merge equalities.
 * Any edit section can move as long as it doesn't cross an equality.
 * @param {Array} diffs Array of diff tuples.
 */
function diff_cleanupMerge(diffs) {
  diffs.push([DIFF_EQUAL, '']);  // Add a dummy entry at the end.
  var pointer = 0;
  var count_delete = 0;
  var count_insert = 0;
  var text_delete = '';
  var text_insert = '';
  var commonlength;
  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case DIFF_INSERT:
        count_insert++;
        text_insert += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_DELETE:
        count_delete++;
        text_delete += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_EQUAL:
        // Upon reaching an equality, check for prior redundancies.
        if (count_delete + count_insert > 1) {
          if (count_delete !== 0 && count_insert !== 0) {
            // Factor out any common prefixies.
            commonlength = diff_commonPrefix(text_insert, text_delete);
            if (commonlength !== 0) {
              if ((pointer - count_delete - count_insert) > 0 &&
                  diffs[pointer - count_delete - count_insert - 1][0] ==
                  DIFF_EQUAL) {
                diffs[pointer - count_delete - count_insert - 1][1] +=
                    text_insert.substring(0, commonlength);
              } else {
                diffs.splice(0, 0, [DIFF_EQUAL,
                                    text_insert.substring(0, commonlength)]);
                pointer++;
              }
              text_insert = text_insert.substring(commonlength);
              text_delete = text_delete.substring(commonlength);
            }
            // Factor out any common suffixies.
            commonlength = diff_commonSuffix(text_insert, text_delete);
            if (commonlength !== 0) {
              diffs[pointer][1] = text_insert.substring(text_insert.length -
                  commonlength) + diffs[pointer][1];
              text_insert = text_insert.substring(0, text_insert.length -
                  commonlength);
              text_delete = text_delete.substring(0, text_delete.length -
                  commonlength);
            }
          }
          // Delete the offending records and add the merged ones.
          if (count_delete === 0) {
            diffs.splice(pointer - count_insert,
                count_delete + count_insert, [DIFF_INSERT, text_insert]);
          } else if (count_insert === 0) {
            diffs.splice(pointer - count_delete,
                count_delete + count_insert, [DIFF_DELETE, text_delete]);
          } else {
            diffs.splice(pointer - count_delete - count_insert,
                count_delete + count_insert, [DIFF_DELETE, text_delete],
                [DIFF_INSERT, text_insert]);
          }
          pointer = pointer - count_delete - count_insert +
                    (count_delete ? 1 : 0) + (count_insert ? 1 : 0) + 1;
        } else if (pointer !== 0 && diffs[pointer - 1][0] == DIFF_EQUAL) {
          // Merge this equality with the previous one.
          diffs[pointer - 1][1] += diffs[pointer][1];
          diffs.splice(pointer, 1);
        } else {
          pointer++;
        }
        count_insert = 0;
        count_delete = 0;
        text_delete = '';
        text_insert = '';
        break;
    }
  }
  if (diffs[diffs.length - 1][1] === '') {
    diffs.pop();  // Remove the dummy entry at the end.
  }

  // Second pass: look for single edits surrounded on both sides by equalities
  // which can be shifted sideways to eliminate an equality.
  // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
  var changes = false;
  pointer = 1;
  // Intentionally ignore the first and last element (don't need checking).
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] == DIFF_EQUAL &&
        diffs[pointer + 1][0] == DIFF_EQUAL) {
      // This is a single edit surrounded by equalities.
      if (diffs[pointer][1].substring(diffs[pointer][1].length -
          diffs[pointer - 1][1].length) == diffs[pointer - 1][1]) {
        // Shift the edit over the previous equality.
        diffs[pointer][1] = diffs[pointer - 1][1] +
            diffs[pointer][1].substring(0, diffs[pointer][1].length -
                                        diffs[pointer - 1][1].length);
        diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
        diffs.splice(pointer - 1, 1);
        changes = true;
      } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) ==
          diffs[pointer + 1][1]) {
        // Shift the edit over the next equality.
        diffs[pointer - 1][1] += diffs[pointer + 1][1];
        diffs[pointer][1] =
            diffs[pointer][1].substring(diffs[pointer + 1][1].length) +
            diffs[pointer + 1][1];
        diffs.splice(pointer + 1, 1);
        changes = true;
      }
    }
    pointer++;
  }
  // If shifts were made, the diff needs reordering and another shift sweep.
  if (changes) {
    diff_cleanupMerge(diffs);
  }
};


var diff = diff_main;
diff.INSERT = DIFF_INSERT;
diff.DELETE = DIFF_DELETE;
diff.EQUAL = DIFF_EQUAL;


module.exports = diff;

},{}],6:[function(require,module,exports){
module.exports={
  "name": "rich-text",
  "version": "1.1.0",
  "description": "Format for representing rich text documents and changes.",
  "author": {
    "name": "Jason Chen",
    "email": "jhchen7@gmail.com"
  },
  "homepage": "https://github.com/ottypes/rich-text",
  "main": "index.js",
  "dependencies": {
    "fast-diff": "~1.0.0"
  },
  "devDependencies": {
    "chai": "~2.1.1",
    "coveralls": "~2.11.1",
    "grunt": "~0.4.5",
    "istanbul": "~0.3.0",
    "lodash": "~3.5.0",
    "mocha": "~2.2.1",
    "ot-fuzzer": "~1.0.0"
  },
  "engines": {
    "node": ">=0.10"
  },
  "license": "MIT",
  "scripts": {
    "test": "grunt test"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/ottypes/rich-text"
  },
  "bugs": {
    "url": "https://github.com/ottypes/rich-text/issues"
  },
  "keywords": [
    "rich text",
    "ot",
    "operational transform",
    "delta"
  ],
  "readme": "# Rich Text [![Build Status](https://travis-ci.org/ottypes/rich-text.svg?branch=master)](http://travis-ci.org/ottypes/rich-text) [![Coverage Status](https://img.shields.io/coveralls/ottypes/rich-text.svg)](https://coveralls.io/r/ottypes/rich-text)\n\nA format for representing rich text documents and changes. It aimes to be intuitive and human readable with the ability to express any change necessary to deal with rich text. A document can also be expressed with this format--as the change from an empty document.\n\n## Quick Example\n\n```js\nvar delta = new Delta([\n  { insert: 'Gandalf', attributes: { bold: true } },\n  { insert: ' the ' },\n  { insert: 'Grey', attributes: { color: '#ccc' } }\n]);\n\n// Keep the first 12 characters, delete the next 4, and insert a white 'White'\nvar death = new Delta().retain(12)\n                       .delete(4)\n                       .insert('White', { color: '#fff' });\n// this produces:\n// {\n//   ops: [\n//     { retain: 12 },\n//     { delete: '4 ' },\n//     { insert: 'White', attributes: { color: '#fff' } }\n//   ]\n// }\n\ndelta.compose(death);\n// delta is now:\n// {\n//   ops: [\n//     { insert: 'Gandalf ', attributes: { bold: true } },\n//     { insert: 'the ' },\n//     { insert: 'White', attributes: { color: '#fff' } }\n//   ]\n// }\n\n```\n\nThis format is suitable for [Operational Transform](https://en.wikipedia.org/wiki/Operational_transformation) and defines several functions to support this use case.\n\n## Contents\n\n#### [Operations](#operations-1)\n\n- [insert](#insert-operation)\n- [delete](#delete-operation)\n- [retain](#retain-operation)\n\n#### [Deltas](#deltas-1)\n\n- [`constructor`](#constructor)\n- [`insert`](#insert)\n- [`delete`](#delete)\n- [`retain`](#retain)\n- [`length`](#length)\n- [`slice`](#slice)\n- [`compose`](#compose)\n- [`transform`](#transform)\n\n#### [Documents](#documents-1)\n\n- [`diff`](#diff)\n\n\n## Operations\n\nOperations describe a singular change to a document. They can be an [`insert`](#insert-operation), [`delete`](#delete-operation) or [`retain`](#retain-operation). Note operations do not take an index. They always describe the change at the current index. Use retains to \"keep\" or \"skip\" certain parts of the document.\n\n### Insert Operation\n\nInsert operations have an `insert` key defined. A String value represents inserting text. A Number value represents inserting an embed, with the value corresponding to an embed type (such as an image or video).\n\nHere we will use 1 to represent images and 2 to represent videos, but your application can choose whatever mapping is convenient.\n\nIn both cases of text and embeds, an optional `attributes` key can be defined with an Object to describe additonal formatting information. Formats can be changed by the [retain](#retain) operation.\n\n```js\n// Insert a bolded \"Text\"\n{ insert: \"Text\", attributes: { bold: true } }\n\n// Insert a link\n{ insert: \"Google\", attributes: { href: 'https://www.google.com' } }\n\n// Insert an image\n{\n  insert: 1,\n  attributes: {\n    alt: \"Lab Octocat\",\n    src: 'https://octodex.github.com/images/labtocat.png'\n  }\n}\n\n// Insert a video\n{\n  insert: 2,\n  attributes: {\n    src: \"https://www.youtube.com/watch?v=dMH0bHeiRNg\",\n    width: 420,\n    height: 315\n  }\n}\n```\n\n### Delete Operation\n\nDelete operations have a Number `delete` key defined representing the number of characters to delete. All embeds have a length of 1.\n\n```js\n// Delete the next 10 characters\n{ delete: 10 }\n```\n\n### Retain Operation\n\nRetain operations have a Number `retain` key defined representing the number of characters to keep (other libraries might use the name keep or skip). An optional `attributes` key can be defined with an Object to describe formatting changes to the character range. A value of null in the `attributes` Object represents removal of that key.\n\n*Note: It is not necessary to retain the last characters of a document as this is implied.*\n\n```js\n// Keep the next 5 characters\n{ retain: 5 }\n\n// Keep and bold the next 5 characters\n{ retain: 5, attributes: { bold: true } }\n\n// Keep and unbold the next 5 characters\n// More specifically, remove the bold key in the attributes Object\n// in the next 5 characters\n{ retain: 5, attributes: { bold: null } }\n```\n\n\n## Deltas\n\nA Delta is made up of an array of operations. Unless otherwise specified all methods are self modifying and return `this` for chainability.\n\nAll methods also maintain the property that Deltas are represented in the most compact form. For example two consecutive insert operations of plain text will be merged into one.\n\n---\n\n### constructor\n\nCreates a new Delta object.\n\n#### Methods\n\n- `new Delta()`\n- `new Delta(ops)`\n- `new Delta(delta)`\n\n#### Parameters\n\n- `ops` - Array of operations\n- `delta` - Object with an `ops` key set to an array of operations\n\n*Note: No validity/sanity check is performed when constructed with ops or delta. The new delta's internal ops array will also be assigned to ops or delta.ops without deep copying.*\n\n#### Example\n\n```js\nvar delta = new Delta([\n  { insert: 'Hello World' },\n  { insert: '!', attributes: { bold: true }}\n]);\n\nvar packet = JSON.stringify(delta);\n\nvar other = new Delta(JSON.parse(packet));\n\nvar chained = new Delta().insert('Hello World').insert('!', { bold: true });\n```\n\n---\n\n### insert()\n\nAppends an insert operation.\n\n#### Methods\n\n- `insert(text, attributes)`\n- `insert(embed, attributes)`\n\n#### Parameters\n\n- `text` - String representing text to insert\n- `embed` - Number representing embed type to insert\n- `attributes` - Optional attributes to apply\n\n#### Example\n\n```js\ndelta.insert('Text', { bold: true, color: '#ccc' });\ndelta.insert(1, { src: 'https://octodex.github.com/images/labtocat.png' });\n```\n\n---\n\n### delete()\n\nAppends a delete operation.\n\n#### Methods\n\n- `delete(length)`\n\n#### Parameters\n\n- `length` - Number of characters to delete\n\n#### Example\n\n```js\ndelta.delete(5);\n```\n\n---\n\n### retain()\n\nAppends a retain operation.\n\n#### Methods\n\n- `retain(length, attributes)`\n\n#### Parameters\n\n- `length` - Number of characters to retain\n- `attributes` - Optional attributes to apply\n\n#### Example\n\n```js\ndelta.retain(4).retain(5, { color: '#0c6' });\n```\n\n---\n\n### length()\n\nReturns length of Delta.\n\n#### Methods\n\n- `length()`\n\n#### Example\n\n```js\nnew Delta().insert('Hello').length();  // Returns 5\n\nnew Delta().insert('A').retain(2).delete(1) // Returns 4\n```\n\n---\n\n### slice()\n\nReturns copy of delta with subset of operations.\n\n#### Methods\n\n- `slice()`\n- `slice(start)`\n- `slice(start, end)`\n\n#### Parameters\n\n- `start` - Start index of subset, defaults to 0\n- `end` - End index of subset, defaults to rest of operations\n\n#### Example\n\n```js\nvar delta = new Delta().insert('Hello', { bold: true }).insert(' World');\n\n// {\n//   ops: [\n//     { insert: 'Hello', attributes: { bold: true } },\n//     { insert: ' World' }\n//   ]\n// }\nvar copy = delta.slice();\n\n// { ops: [{ insert: 'World' }] }\nvar world = delta.slice(6);\n\n// { ops: [{ insert: ' ' }] }\nvar space = delta.slice(5, 6);\n```\n\n---\n\n### compose()\n\nCompose with another Delta, i.e. merge the operations of another Delta. This method is self modifying.\n\n#### Methods\n\n- `compose(other)`\n\n#### Parameters\n\n- `other` - Delta to compose\n\n#### Example\n\n```js\nvar a = new Delta().insert('abc');\nvar b = new Delta().retain(1).delete(1);\n\na.compose(b);  // a == new Delta().insert('ac');\n```\n\n---\n\n### transform()\n\nTransform given Delta against own operations.\n\n#### Methods\n\n- `transform(other, priority)`\n- `transform(index)` - Alias for [`transformPosition`](#tranformposition)\n\n#### Parameters\n\n- `other` - Delta to transform\n- `priority` - Boolean used to break ties\n\n#### Returns\n\n- `Delta` - transformed Delta\n\n#### Example\n\n```js\nvar a = new Delta().insert('a');\nvar b = new Delta().insert('b');\n\nb = a.transform(b, true);  // new Delta().retain(1).insert('b');\n```\n\n---\n\n### transformPosition()\n\nTransform an index against the delta. Useful for representing cursor/selection positions.\n\n#### Methods\n\n- `transformPosition(index)`\n\n#### Parameters\n\n- `index` - index to transform\n\n#### Returns\n\n- `Number` - transformed index\n\n#### Example\n\n```js\nvar index = 12;\nvar transformedIndex = delta.transformPosition(index);\n```\n\n\n## Documents\n\nA Delta with only insert operations can be used to represent a rich text document. This can be thought of as a Delta applied to an empty document.\n\nThe following methods are supported only for Deltas that represent a document (i.e. they only contain inserts). There are no guarantees on the behavior on non-document Deltas.\n\n---\n\n### diff()\n\nCalculates the difference between two documents expressed as a Delta.\n\n#### Methods\n\n- `diff(other)`\n\n#### Parameters\n\n- `other` - Document Delta to diff against\n\n#### Returns\n\n- `Delta` - difference between the two documents\n\n#### Example\n\n```js\nvar a = new Delta().insert('Hello');\nvar b = new Delta().insert('Hello!');\n\nvar diff = a.diff(b);  // { ops: [{ retain: 5 }, { insert: '!' }] }\n```\n\n---\n\n### length()\n\nCalculates the length of the document.\n\n#### Methods\n\n- `length()`\n\n#### Returns\n\n- `Number` - length of the document\n\n#### Example\n\n```js\nvar delta = new Delta().insert('Hello');\nvar length = delta.length();\n```\n",
  "readmeFilename": "README.md",
  "gitHead": "794a4b9f6419f890aa3dec9471781e6f822ea4a1",
  "_id": "rich-text@1.1.0",
  "_shasum": "dea3e14bb7da17eae446ab6943b6d25f09b48832",
  "_from": "rich-text"
}

},{}]},{},[4]);
