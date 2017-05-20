

'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
var _ = require('lodash');
var binary = require('ripple-binary-codec');
var OrderBookUtils = {};

/**
 * Formats an offer quality amount to a hex that can be parsed by
 * Amount.parse_quality
 *
 * @param {String} quality
 *
 * @return {String}
 */

OrderBookUtils.convertOfferQualityToHexFromText = function (quality) {
  return binary.encodeQuality(quality);
};

var NODE_TYPES = ['CreatedNode', 'ModifiedNode', 'DeletedNode'];

/**
 * @param {Object} node
 * @api private
 */

function getNodeType(node) {
  var result = null;

  for (var i = 0; i < NODE_TYPES.length; i++) {
    var type = NODE_TYPES[i];
    if (node.hasOwnProperty(type)) {
      result = type;
      break;
    }
  }

  return result;
}

function rippledAmountToCurrencyString(amount) {
  return typeof amount === 'string' ? 'XRP' : amount.currency + '/' + (amount.issuer ? amount.issuer : '');
}

OrderBookUtils.getValueFromRippledAmount = function (amount) {
  return typeof amount === 'string' ? amount : amount.value;
};

OrderBookUtils.getAffectedNodes = function (meta, filter) {
  if (!Array.isArray(meta.AffectedNodes)) {
    // throw new Error('Metadata missing AffectedNodes');
    return [];
  }

  var nodes = [];

  meta.AffectedNodes.forEach(function (rawNode) {
    var result = {};
    result.nodeType = getNodeType(rawNode);
    if (result.nodeType) {
      var _node = rawNode[result.nodeType];
      result.diffType = result.nodeType;
      result.entryType = _node.LedgerEntryType;
      result.ledgerIndex = _node.LedgerIndex;
      result.fields = _.extend({}, _node.PreviousFields, _node.NewFields, _node.FinalFields);
      result.fieldsPrev = _node.PreviousFields || {};
      result.fieldsNew = _node.NewFields || {};
      result.fieldsFinal = _node.FinalFields || {};

      if (result.entryType === 'Offer') {
        var gets = rippledAmountToCurrencyString(result.fields.TakerGets);
        var pays = rippledAmountToCurrencyString(result.fields.TakerPays);

        var key = gets + ':' + pays;

        result.bookKey = key;
      }

      nodes.push(result);
    }
  });

  if (typeof filter === 'object') {
    return nodes.filter(function (node) {
      if (filter.nodeType && filter.nodeType !== node.nodeType) {
        return false;
      }
      if (filter.entryType && filter.entryType !== node.entryType) {
        return false;
      }
      if (filter.bookKey && filter.bookKey !== node.bookKey) {
        return false;
      }
      return true;
    });
  }

  return nodes;
};

module.exports = OrderBookUtils;