

// Routines for working with an orderbook.
//
// One OrderBook object represents one half of an order book. (i.e. bids OR
// asks) Which one depends on the ordering of the parameters.
//
// Events:
//  - model
//  - trade
//  - transaction

'use strict';

var _get = require('babel-runtime/helpers/get')['default'];

var _inherits = require('babel-runtime/helpers/inherits')['default'];

var _createClass = require('babel-runtime/helpers/create-class')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _Promise = require('babel-runtime/core-js/promise')['default'];

var _Object$keys = require('babel-runtime/core-js/object/keys')['default'];

var _ = require('lodash');
var assert = require('assert');

var _require = require('events');

var EventEmitter = _require.EventEmitter;

var _require2 = require('./currencyutils');

var normalizeCurrency = _require2.normalizeCurrency;
var isValidCurrency = _require2.isValidCurrency;

var _require3 = require('./autobridgecalculator');

var AutobridgeCalculator = _require3.AutobridgeCalculator;

var OrderBookUtils = require('./orderbookutils');

var _require4 = require('ripple-address-codec');

var isValidAddress = _require4.isValidAddress;

var _require5 = require('ripple-lib-value');

var XRPValue = _require5.XRPValue;
var IOUValue = _require5.IOUValue;

var log = require('./log').internal.sub('orderbook');

var DEFAULT_TRANSFER_RATE = new IOUValue('1.000000000');

var ZERO_NATIVE_AMOUNT = new XRPValue('0');

var ZERO_NORMALIZED_AMOUNT = new IOUValue('0');

/**
 * Events emitted from OrderBook
 */
var EVENTS = ['transaction', 'model', 'trade', 'offer_added', 'offer_removed', 'offer_changed', 'offer_funds_changed'];

function prepareTrade(currency, issuer_) {
  var issuer = issuer_ === undefined ? '' : issuer_;
  var suffix = normalizeCurrency(currency) === 'XRP' ? '' : '/' + issuer;
  return currency + suffix;
}

function parseRippledAmount(amount) {
  return typeof amount === 'string' ? new XRPValue(amount) : new IOUValue(amount.value);
}

function _sortOffersQuick(a, b) {
  return a.qualityHex.localeCompare(b.qualityHex);
}

/**
 * account is to specify a "perspective", which affects which unfunded offers
 * are returned
 *
 * @constructor OrderBook
 * @param {RippleAPI} api
 * @param {String} account
 * @param {String} ask currency
 * @param {String} ask issuer
 * @param {String} bid currency
 * @param {String} bid issuer
 */

var OrderBook = (function (_EventEmitter) {
  _inherits(OrderBook, _EventEmitter);

  function OrderBook(api, currencyGets, issuerGets, currencyPays, issuerPays, account, ledgerIndex) {
    var trace = arguments.length <= 7 || arguments[7] === undefined ? false : arguments[7];

    _classCallCheck(this, OrderBook);

    _get(Object.getPrototypeOf(OrderBook.prototype), 'constructor', this).call(this);

    this._trace = trace;
    if (this._trace) {
      log.info('OrderBook:constructor', currencyGets, issuerGets, currencyPays, issuerPays, ledgerIndex);
    }

    this._api = api;
    this._account = account !== undefined ? account : '';
    this._currencyGets = normalizeCurrency(currencyGets);
    this._issuerGets = issuerGets !== undefined ? issuerGets : '';
    this._currencyPays = normalizeCurrency(currencyPays);
    this._issuerPays = issuerPays !== undefined ? issuerPays : '';
    this._key = prepareTrade(currencyGets, issuerGets) + ':' + prepareTrade(currencyPays, issuerPays);
    this._ledgerIndex = ledgerIndex;

    // When orderbook is IOU/IOU, there will be IOU/XRP and XRP/IOU
    // books that we must keep track of to compute autobridged offers
    this._legOneBook = null;
    this._legTwoBook = null;

    this._listeners = 0;
    this._transactionsLeft = -1;
    this._waitingForOffers = false;
    this._subscribed = false;
    this._synced = false;

    this._isAutobridgeable = this._currencyGets !== 'XRP' && this._currencyPays !== 'XRP';

    this._issuerTransferRate = null;
    this._transferRateIsDefault = false;

    this._offerCounts = {};
    this._ownerFundsUnadjusted = {};
    this._ownerFunds = {};
    this._ownerOffersTotal = {};
    this._validAccounts = {};
    this._validAccountsCount = 0;
    this._offers = [];

    this._closedLedgerVersion = 0;
    this._lastUpdateLedgerSequence = 0;
    this._calculatorRunning = false;
    this._gotOffersFromLegOne = false;
    this._gotOffersFromLegTwo = false;

    this._onReconnectBound = this._onReconnect.bind(this);
    this._onTransactionBound = this._onTransaction.bind(this);

    if (this._isAutobridgeable) {
      this._legOneBook = new OrderBook(api, 'XRP', undefined, currencyPays, issuerPays, account, this._ledgerIndex, this._trace);

      this._legTwoBook = new OrderBook(api, currencyGets, issuerGets, 'XRP', undefined, account, this._ledgerIndex, this._trace);
    }

    this._initializeSubscriptionMonitoring();
  }

  /**
   * Creates OrderBook instance using options object same as for
   * old Remote.createOrderBook method.
   *
   * @param {Object} api
   * @param {Object} api
   *
   */

  _createClass(OrderBook, [{
    key: 'isValid',

    /**
     * Whether the OrderBook is valid
     *
     * Note: This only checks whether the parameters (currencies and issuer) are
     *       syntactically valid. It does not check anything against the ledger.
     *
     * @return {Boolean} is valid
     */

    value: function isValid() {
      // XXX Should check for same currency (non-native) && same issuer
      return Boolean(this._currencyPays) && isValidCurrency(this._currencyPays) && (this._currencyPays === 'XRP' || isValidAddress(this._issuerPays)) && Boolean(this._currencyGets) && isValidCurrency(this._currencyGets) && (this._currencyGets === 'XRP' || isValidAddress(this._issuerGets)) && !(this._currencyPays === 'XRP' && this._currencyGets === 'XRP');
    }

    /**
     * Return latest known offers
     *
     * Usually, this will just be an empty array if the order book hasn't been
     * loaded yet. But this accessor may be convenient in some circumstances.
     *
     * @return {Array} offers
     */

  }, {
    key: 'getOffersSync',
    value: function getOffersSync() {
      return this._offers;
    }
  }, {
    key: 'requestOffers',
    value: function requestOffers() {
      var _this = this;

      if (this._waitingForOffers) {
        return new _Promise(function (resolve) {
          _this.once('model', resolve);
        });
      }
      if (!this._api.isConnected()) {
        // do not make request if not online.
        // that requests will be queued and
        // eventually all of them will fire back
        return _Promise.reject(new this._api.errors.RippleError('Server is offline'));
      }

      if (this._isAutobridgeable) {
        this._gotOffersFromLegOne = false;
        this._gotOffersFromLegTwo = false;

        if (this._legOneBook !== null && this._legOneBook !== undefined) {
          this._legOneBook.requestOffers();
        }
        if (this._legTwoBook !== null && this._legTwoBook !== undefined) {
          this._legTwoBook.requestOffers();
        }
      }

      this._waitingForOffers = true;
      this._resetCache();
      return this._requestTransferRate().then(this._requestOffers.bind(this));
    }
  }, {
    key: 'toJSON',
    value: function toJSON() {
      var json = {
        taker_gets: {
          currency: this._currencyGets
        },
        taker_pays: {
          currency: this._currencyPays
        }
      };

      if (this._currencyGets !== 'XRP') {
        json.taker_gets.issuer = this._issuerGets;
      }

      if (this._currencyPays !== 'XRP') {
        json.taker_pays.issuer = this._issuerPays;
      }

      return json;
    }
  }, {
    key: '_initializeSubscriptionMonitoring',
    value: function _initializeSubscriptionMonitoring() {
      var self = this;

      function computeAutobridgedOffersWrapperOne() {
        if (!self._gotOffersFromLegOne) {
          self._gotOffersFromLegOne = true;
          self._computeAutobridgedOffersWrapper();
        }
      }

      function computeAutobridgedOffersWrapperTwo() {
        if (!self._gotOffersFromLegTwo) {
          self._gotOffersFromLegTwo = true;
          self._computeAutobridgedOffersWrapper();
        }
      }

      function onLedgerClosedWrapper(message) {
        self._onLedgerClosed(message);
        self._pruneExpiredOffers(message);
      }

      function listenersModified(action, event) {
        // Automatically subscribe and unsubscribe to orderbook
        // on the basis of existing event listeners
        if (_.contains(EVENTS, event)) {

          switch (action) {
            case 'add':
              if (++self._listeners === 1) {

                if (self._isAutobridgeable) {
                  if (self._legOneBook !== null && self._legOneBook !== undefined) {
                    self._legOneBook.on('model', computeAutobridgedOffersWrapperOne);
                  }
                  if (self._legTwoBook !== null && self._legTwoBook !== undefined) {
                    self._legTwoBook.on('model', computeAutobridgedOffersWrapperTwo);
                  }
                }

                if (self._ledgerIndex) {
                  self._getHistoricalOrderbook();
                } else {
                  self._api.on('ledger', onLedgerClosedWrapper);
                  self._subscribe(true);
                }
              }
              break;
            case 'remove':
              if (--self._listeners === 0) {
                self._api.removeListener('ledger', onLedgerClosedWrapper);

                self._gotOffersFromLegOne = false;
                self._gotOffersFromLegTwo = false;

                if (self._isAutobridgeable) {
                  if (self._legOneBook !== null && self._legOneBook !== undefined) {
                    self._legOneBook.removeListener('model', computeAutobridgedOffersWrapperOne);
                  }
                  if (self._legTwoBook !== null && self._legTwoBook !== undefined) {
                    self._legTwoBook.removeListener('model', computeAutobridgedOffersWrapperTwo);
                  }
                }
                self._subscribe(false);

                self._resetCache();
              }
              break;
          }
        }
      }

      this.on('newListener', function (event) {
        listenersModified('add', event);
      });

      this.on('removeListener', function (event) {
        listenersModified('remove', event);
      });
    }
  }, {
    key: '_onReconnect',
    value: function _onReconnect() {
      setTimeout(this._subscribe.bind(this, false), 1);
      setTimeout(this._subscribe.bind(this, true), 2);
    }
  }, {
    key: '_getHistoricalOrderbook',
    value: function _getHistoricalOrderbook() {
      this._requestTransferRate().then(this._requestOffers.bind(this));
    }
  }, {
    key: '_subscribe',
    value: function _subscribe(subscribe) {
      var _this2 = this;

      var request = {
        command: subscribe ? 'subscribe' : 'unsubscribe',
        streams: ['transactions']
      };
      this._api.connection.request(request).then(function () {
        _this2._subscribed = subscribe;
      });

      if (subscribe) {
        this._api.connection.on('connected', this._onReconnectBound);
        this._api.connection.on('transaction', this._onTransactionBound);
        this._waitingForOffers = true;
        this._requestTransferRate().then(this._requestOffers.bind(this));
      } else {
        this._api.connection.removeListener('transaction', this._onTransactionBound);
        this._api.connection.removeListener('connected', this._onReconnectBound);
        this._resetCache();
      }
    }
  }, {
    key: '_onLedgerClosed',
    value: function _onLedgerClosed(message) {
      this._transactionsLeft = -1;
      this._closedLedgerVersion = message.ledgerVersion;
      if (!message || message && !_.isNumber(message.transactionCount) || this._waitingForOffers) {
        return;
      }
      this._transactionsLeft = message.transactionCount;

      return;
    }
  }, {
    key: '_onTransaction',
    value: function _onTransaction(transaction) {
      if (this._subscribed && !this._waitingForOffers && this._transactionsLeft > 0) {
        this._processTransaction(transaction);

        if (--this._transactionsLeft === 0) {
          var lastClosedLedger = this._closedLedgerVersion;
          if (this._isAutobridgeable && this._legOneBook !== null && this._legTwoBook !== null) {
            if (!this._calculatorRunning) {
              if (this._legOneBook._lastUpdateLedgerSequence === lastClosedLedger || this._legTwoBook._lastUpdateLedgerSequence === lastClosedLedger) {
                this._computeAutobridgedOffersWrapper();
              } else if (this._lastUpdateLedgerSequence === lastClosedLedger) {
                this._mergeDirectAndAutobridgedBooks();
              }
            }
          } else if (this._lastUpdateLedgerSequence === lastClosedLedger) {
            this._emitAsync(['model', this._offers]);
          }
        }
      }
    }
  }, {
    key: '_processTransaction',
    value: function _processTransaction(transaction) {
      if (this._trace) {
        log.info('_processTransaction', this._key, transaction.transaction.hash);
      }

      var metadata = transaction.meta || transaction.metadata;
      if (!metadata) {
        return;
      }

      var affectedNodes = OrderBookUtils.getAffectedNodes(metadata, {
        entryType: 'Offer',
        bookKey: this._key
      });

      if (this._trace) {
        log.info('_processTransaction:affectedNodes.length: ' + String(affectedNodes.length));
      }
      if (affectedNodes.length > 0) {

        var state = {
          takerGetsTotal: this._currencyGets === 'XRP' ? new XRPValue('0') : new IOUValue('0'),
          takerPaysTotal: this._currencyPays === 'XRP' ? new XRPValue('0') : new IOUValue('0'),
          transactionOwnerFunds: transaction.transaction.owner_funds
        };

        var isOfferCancel = transaction.transaction.TransactionType === 'OfferCancel';

        affectedNodes.forEach(this._processTransactionNode.bind(this, isOfferCancel, state));

        this.emit('transaction', transaction.transaction);
        this._lastUpdateLedgerSequence = this._closedLedgerVersion;

        if (!state.takerGetsTotal.isZero()) {
          this.emit('trade', state.takerPaysTotal, state.takerGetsTotal);
        }
      }

      this._updateFundedAmounts(transaction);
    }
  }, {
    key: '_processTransactionNode',
    value: function _processTransactionNode(isOfferCancel, state, node) {
      if (this._trace) {
        log.info('_processTransactionNode', isOfferCancel, node);
      }
      switch (node.nodeType) {
        case 'DeletedNode':
          {
            this._validateAccount(node.fields.Account);
            this._deleteOffer(node, isOfferCancel);

            // We don't want to count an OfferCancel as a trade
            if (!isOfferCancel) {
              state.takerGetsTotal = state.takerGetsTotal.add(parseRippledAmount(node.fieldsFinal.TakerGets));
              state.takerPaysTotal = state.takerPaysTotal.add(parseRippledAmount(node.fieldsFinal.TakerPays));
            }
            break;
          }
        case 'ModifiedNode':
          {
            this._validateAccount(node.fields.Account);
            this._modifyOffer(node);

            state.takerGetsTotal = state.takerGetsTotal.add(parseRippledAmount(node.fieldsPrev.TakerGets)).subtract(parseRippledAmount(node.fieldsFinal.TakerGets));

            state.takerPaysTotal = state.takerPaysTotal.add(parseRippledAmount(node.fieldsPrev.TakerPays)).subtract(parseRippledAmount(node.fieldsFinal.TakerPays));
            break;
          }
        case 'CreatedNode':
          {
            this._validateAccount(node.fields.Account);
            // rippled does not set owner_funds if the order maker is the issuer
            // because the value would be infinite
            var fundedAmount = state.transactionOwnerFunds !== undefined ? state.transactionOwnerFunds : 'Infinity';
            this._setOwnerFunds(node.fields.Account, fundedAmount);
            this._insertOffer(node);
            break;
          }
      }
    }

    /**
     * Updates funded amounts/balances using modified balance nodes
     *
     * Update owner funds using modified AccountRoot and RippleState nodes
     * Update funded amounts for offers in the orderbook using owner funds
     *
     * @param {Object} transaction - transaction that holds meta nodes
     */

  }, {
    key: '_updateFundedAmounts',
    value: function _updateFundedAmounts(transaction) {
      var _this3 = this;

      var metadata = transaction.meta || transaction.metadata;
      if (!metadata) {
        return;
      }

      if (this._currencyGets !== 'XRP' && !this._issuerTransferRate) {
        if (this._trace) {
          log.info('waiting for transfer rate');
        }

        this._requestTransferRate().then(function () {
          // Defer until transfer rate is requested
          _this3._updateFundedAmounts(transaction);
        }, function (err) {
          log.error('Failed to request transfer rate, will not update funded amounts: ' + err.toString());
        });
        return;
      }

      var affectedNodes = OrderBookUtils.getAffectedNodes(metadata, {
        nodeType: 'ModifiedNode',
        entryType: this._currencyGets === 'XRP' ? 'AccountRoot' : 'RippleState'
      });

      if (this._trace) {
        log.info('_updateFundedAmounts:affectedNodes.length: ' + String(affectedNodes.length));
      }

      affectedNodes.forEach(function (node) {
        if (_this3._isBalanceChangeNode(node)) {
          var result = _this3._parseAccountBalanceFromNode(node);

          if (_this3._hasOwnerFunds(result.account)) {
            // We are only updating owner funds that are already cached
            _this3._setOwnerFunds(result.account, result.balance);

            _this3._updateOwnerOffersFundedAmount(result.account);
          }
        }
      });
    }

    /**
     * Get account and final balance of a meta node
     *
     * @param {Object} node - RippleState or AccountRoot meta node
     * @return {Object}
     */

  }, {
    key: '_parseAccountBalanceFromNode',
    value: function _parseAccountBalanceFromNode(node) {
      var result = {
        account: '',
        balance: ''
      };

      switch (node.entryType) {
        case 'AccountRoot':
          result.account = node.fields.Account;
          result.balance = node.fieldsFinal.Balance;
          break;

        case 'RippleState':
          if (node.fields.HighLimit.issuer === this._issuerGets) {
            result.account = node.fields.LowLimit.issuer;
            result.balance = node.fieldsFinal.Balance.value;
          } else if (node.fields.LowLimit.issuer === this._issuerGets) {
            result.account = node.fields.HighLimit.issuer;

            // Negate balance on the trust line
            result.balance = parseRippledAmount(node.fieldsFinal.Balance).negate().toFixed();
          }
          break;
      }

      assert(!isNaN(String(result.balance)), 'node has an invalid balance');
      this._validateAccount(result.account);

      return result;
    }

    /**
     * Check that affected meta node represents a balance change
     *
     * @param {Object} node - RippleState or AccountRoot meta node
     * @return {Boolean}
     */

  }, {
    key: '_isBalanceChangeNode',
    value: function _isBalanceChangeNode(node) {
      // Check meta node has balance, previous balance, and final balance
      if (!(node.fields && node.fields.Balance && node.fieldsPrev && node.fieldsFinal && node.fieldsPrev.Balance && node.fieldsFinal.Balance)) {
        return false;
      }

      // Check if taker gets currency is native and balance is not a number
      if (this._currencyGets === 'XRP') {
        return !isNaN(node.fields.Balance);
      }

      // Check if balance change is not for taker gets currency
      if (node.fields.Balance.currency !== this._currencyGets) {
        return false;
      }

      // Check if trustline does not refer to the taker gets currency issuer
      if (!(node.fields.HighLimit.issuer === this._issuerGets || node.fields.LowLimit.issuer === this._issuerGets)) {
        return false;
      }

      return true;
    }

    /**
     * Modify an existing offer in the orderbook
     *
     * @param {Object} node - Offer node
     */

  }, {
    key: '_modifyOffer',
    value: function _modifyOffer(node) {
      if (this._trace) {
        log.info('modifying offer', this._key, node.fields);
      }

      for (var i = 0; i < this._offers.length; i++) {
        var offer = this._offers[i];

        if (offer.index === node.ledgerIndex) {
          // TODO: This assumes no fields are deleted, which is
          // probably a safe assumption, but should be checked.
          _.extend(offer, node.fieldsFinal);

          break;
        }
      }

      this._updateOwnerOffersFundedAmount(node.fields.Account);
    }

    /**
     * Delete an existing offer in the orderbook
     *
     * NOTE: We only update funded amounts when the node comes from an OfferCancel
     *       transaction because when offers are deleted, it frees up funds to
     *       fund other existing offers in the book
     *
     * @param {Object} node - Offer node
     * @param {Boolean} isOfferCancel - whether node came from an OfferCancel
     */

  }, {
    key: '_deleteOffer',
    value: function _deleteOffer(node, isOfferCancel) {
      if (this._trace) {
        log.info('deleting offer', this._key, node.fields);
      }

      for (var i = 0; i < this._offers.length; i++) {
        var offer = this._offers[i];

        if (offer.index === node.ledgerIndex) {
          // Remove offer amount from sum for account
          this._subtractOwnerOfferTotal(offer.Account, offer.TakerGets);

          this._offers.splice(i, 1);
          this._decrementOwnerOfferCount(offer.Account);

          this.emit('offer_removed', offer);

          break;
        }
      }

      if (isOfferCancel) {
        this._updateOwnerOffersFundedAmount(node.fields.Account);
      }
    }

    /**
     * Subtract amount sum being offered for owner
     *
     * @param {String} account - owner's account address
     * @param {Object|String} amount - offer amount as native string or IOU
     *                                 currency format
     * @return {Amount}
     */

  }, {
    key: '_subtractOwnerOfferTotal',
    value: function _subtractOwnerOfferTotal(account, amount) {
      var previousAmount = this._getOwnerOfferTotal(account);
      var newAmount = previousAmount.subtract(parseRippledAmount(amount));

      this._ownerOffersTotal[account] = newAmount;
      if (newAmount.isNegative()) {
        // why the heck does it happen?
        console.log('wtf?');
        console.log(newAmount);
        newAmount = previousAmount;
      }
      // assert(!newAmount.isNegative(), 'Offer total cannot be negative');
      return newAmount;
    }

    /**
     * Insert an offer into the orderbook
     *
     * NOTE: We *MUST* update offers' funded amounts when a new offer is placed
     *       because funds go to the highest quality offers first.
     *
     * @param {Object} node - Offer node
     */

  }, {
    key: '_insertOffer',
    value: function _insertOffer(node) {
      if (this._trace) {
        log.info('inserting offer', this._key, node.fields);
      }

      var originalLength = this._offers.length;
      var offer = OrderBook._offerRewrite(node.fields);
      var takerGets = new IOUValue(offer.TakerGets.value || offer.TakerGets);
      var takerPays = new IOUValue(offer.TakerPays.value || offer.TakerPays);

      // We're safe to calculate quality for newly created offers
      offer.quality = takerPays.divide(takerGets).toFixed();
      offer.LedgerEntryType = node.entryType;
      offer.index = node.ledgerIndex;

      for (var i = 0; i < originalLength; i++) {
        if (offer.qualityHex <= this._offers[i].qualityHex) {
          this._offers.splice(i, 0, offer);
          break;
        }
      }

      if (this._offers.length === originalLength) {
        this._offers.push(offer);
      }

      this._incrementOwnerOfferCount(offer.Account);

      this._updateOwnerOffersFundedAmount(offer.Account);

      this.emit('offer_added', offer);
    }
  }, {
    key: '_pruneExpiredOffers',
    value: function _pruneExpiredOffers(ledger) {
      var _this4 = this;

      var offersLength = this._offers.length;

      this._offers = this._offers.filter(function (offer) {
        if (offer.Expiration <= ledger.ledger_time) {
          _this4._subtractOwnerOfferTotal(offer.Account, offer.TakerGets);
          _this4._decrementOwnerOfferCount(offer.Account);
          _this4._updateOwnerOffersFundedAmount(offer.Account);
          _this4.emit('offer_removed', offer);

          return false;
        }

        return true;
      });

      if (this._offers.length < offersLength) {
        this.emit('model', this._offers);
      }
    }

    /**
     * Decrement offer count for owner
     * When an account has no more orders, we also stop tracking their account
     * funds
     *
     * @param {String} account - owner's account address
     * @return {Number}
     */

  }, {
    key: '_decrementOwnerOfferCount',
    value: function _decrementOwnerOfferCount(account) {
      var result = (this._offerCounts[account] || 1) - 1;
      this._offerCounts[account] = result;

      if (result < 1) {
        this._deleteOwnerFunds(account);
      }

      return result;
    }

    /**
     * Remove cached owner's funds
     *
     * @param {String} account - owner's account address
     */

  }, {
    key: '_deleteOwnerFunds',
    value: function _deleteOwnerFunds(account) {
      delete this._ownerFunds[account];
    }

    /**
     * Update offers' funded amount with their owner's funds
     *
     * @param {String} account - owner's account address
     */

  }, {
    key: '_updateOwnerOffersFundedAmount',
    value: function _updateOwnerOffersFundedAmount(account) {
      var _this5 = this;

      if (!this._hasOwnerFunds(account)) {
        // We are only updating owner funds that are already cached
        return;
      }

      if (this._trace) {
        var ownerFunds = this._getOwnerFunds(account);
        log.info('updating offer funds', this._key, account, ownerFunds ? ownerFunds.toString() : 'undefined');
      }

      this._resetOwnerOfferTotal(account);

      this._offers.forEach(function (offer) {
        if (offer.Account !== account) {
          return;
        }

        // Save a copy of the old offer so we can show how the offer has changed
        var previousOffer = _.extend({}, offer);
        var previousFundedGets = null;

        if (_.isString(offer.taker_gets_funded)) {
          // Offer is not new, so we should consider it for offer_changed and
          // offer_funds_changed events
          // previousFundedGets = OrderBookUtils.getOfferTakerGetsFunded(offer);
          previousFundedGets = _this5._getOfferTakerGetsFunded(offer);
        }

        _this5._setOfferFundedAmount(offer);
        _this5._addOwnerOfferTotal(offer.Account, offer.TakerGets);

        var takerGetsFunded = _this5._getOfferTakerGetsFunded(offer);
        var areFundsChanged = previousFundedGets !== null && !takerGetsFunded.equals(previousFundedGets);

        if (areFundsChanged) {
          _this5.emit('offer_changed', previousOffer, offer);
          _this5.emit('offer_funds_changed', offer, previousOffer.taker_gets_funded, offer.taker_gets_funded);
        }
      });
    }
  }, {
    key: '_getOfferTakerGetsFunded',
    value: function _getOfferTakerGetsFunded(offer) {
      return this._currencyGets === 'XRP' ? new XRPValue(offer.taker_gets_funded) : new IOUValue(offer.taker_gets_funded);
    }

    /**
     * Reset offers amount sum for owner to 0
     *
     * @param {String} account - owner's account address
     * @return {Amount}
     */

  }, {
    key: '_resetOwnerOfferTotal',
    value: function _resetOwnerOfferTotal(account) {
      if (this._currencyGets === 'XRP') {
        this._ownerOffersTotal[account] = ZERO_NATIVE_AMOUNT;
      } else {
        this._ownerOffersTotal[account] = ZERO_NORMALIZED_AMOUNT;
      }
    }
  }, {
    key: '_validateAccount',
    value: function _validateAccount(account) {
      if (this._validAccounts[account] === undefined) {
        assert(isValidAddress(account), 'node has an invalid account');
        this._validAccounts[account] = true;
        this._validAccountsCount++;
      }
    }

    /**
     * Request transfer rate for this orderbook's issuer
     *
     * @param {Function} callback
     */

  }, {
    key: '_requestTransferRate',
    value: function _requestTransferRate() {
      var _this6 = this;

      if (this._currencyGets === 'XRP') {
        // Transfer rate is default for the native currency
        this._issuerTransferRate = DEFAULT_TRANSFER_RATE;
        this._transferRateIsDefault = true;

        return _Promise.resolve(this._issuerTransferRate);
      }

      if (this._issuerTransferRate) {
        // Transfer rate has already been cached
        return _Promise.resolve(this._issuerTransferRate);
      }

      return this._api.getSettings(this._issuerGets, {}).then(function (settings) {
        // When transfer rate is not explicitly set on account, it implies the
        // default transfer rate
        _this6._transferRateIsDefault = !Boolean(settings.transferRate);
        _this6._issuerTransferRate = settings.transferRate ? new IOUValue(settings.transferRate) : DEFAULT_TRANSFER_RATE;
        return _this6._issuerTransferRate;
      });
    }

    /**
     * Request orderbook entries from server
     *
     * @param {Function} callback
     */

  }, {
    key: '_requestOffers',
    value: function _requestOffers() {
      var _this7 = this;

      if (!this._api.isConnected()) {
        // do not make request if not online.
        // that requests will be queued and
        // eventually all of them will fire back
        return _Promise.reject(new this._api.errors.RippleError('Server is offline'));
      }

      if (this._trace) {
        log.info('requesting offers', this._key);
      }

      var requestMessage = _.extend({
        command: 'book_offers',
        taker: this._account ? this._account : 'rrrrrrrrrrrrrrrrrrrrBZbvji',
        ledger_index: this._ledgerIndex || 'validated'
      }, this.toJSON());

      return this._api.connection.request(requestMessage).then(function (response) {
        _this7._lastUpdateLedgerSequence = response.ledger_index;
        if (!Array.isArray(response.offers)) {
          _this7._emitAsync(['model', []]);
          throw new _this7._api.errors.RippleError('Invalid response');
        }

        if (_this7._ledgerIndex) {
          assert(response.ledger_index === _this7._ledgerIndex);
        }

        if (_this7._trace) {
          log.info('requested offers', _this7._key, 'offers: ' + response.offers.length);
        }

        _this7._setOffers(response.offers);

        if (!_this7._isAutobridgeable) {
          _this7._waitingForOffers = false;
          _this7._emitAsync(['model', _this7._offers]);
          return _this7._offers;
        }

        _this7._computeAutobridgedOffersWrapper();

        return new _Promise(function (resolve) {
          _this7.once('model', function (offers) {
            _this7._waitingForOffers = false;
            resolve(offers);
          });
        });
      });
    }

    /**
     * Reset internal offers cache from book_offers request
     *
     * @param {Array} offers
     * @api private
     */

  }, {
    key: '_setOffers',
    value: function _setOffers(offers) {
      assert(Array.isArray(offers), 'Offers is not an array');

      this._resetCache();

      var i = -1;
      var offer = undefined;
      var length = offers.length;

      while (++i < length) {
        offer = OrderBook._offerRewrite(offers[i]);

        this._validateAccount(offer.Account);
        if (offer.owner_funds !== undefined) {
          // The first offer of each owner from book_offers contains owner balance
          // of offer's output
          this._setOwnerFunds(offer.Account, offer.owner_funds);
        }

        this._incrementOwnerOfferCount(offer.Account);

        this._setOfferFundedAmount(offer);
        this._addOwnerOfferTotal(offer.Account, offer.TakerGets);
        offers[i] = offer;
      }

      this._offers = offers;
      this._synced = true;
    }

    /**
     * Check whether owner's funds have been cached
     *
     * @param {String} account - owner's account address
     */

  }, {
    key: '_hasOwnerFunds',
    value: function _hasOwnerFunds(account) {
      if (account === undefined) {
        return false;
      }
      return this._ownerFunds[account] !== undefined;
    }

    /**
     * Set owner's, transfer rate adjusted, funds in cache
     *
     * @param {String} account - owner's account address
     * @param {String} fundedAmount
     */

  }, {
    key: '_setOwnerFunds',
    value: function _setOwnerFunds(account, fundedAmount) {
      assert(!isNaN(Number(fundedAmount)), 'Funded amount is invalid');

      this._ownerFundsUnadjusted[account] = fundedAmount;
      this._ownerFunds[account] = this._applyTransferRate(fundedAmount);
    }

    /**
     * Compute adjusted balance that would be left after issuer's transfer fee is
     * deducted
     *
     * @param {String} balance
     * @return {String}
     */

  }, {
    key: '_applyTransferRate',
    value: function _applyTransferRate(balance) {
      assert(!isNaN(Number(balance)), 'Balance is invalid');

      if (this._transferRateIsDefault) {
        return balance;
      }

      var adjustedBalance = new IOUValue(balance).divide(this._issuerTransferRate).toFixed();

      return adjustedBalance;
    }

    /**
    * Increment offer count for owner
    *
    * @param {String} account - owner's account address
    * @return {Number}
    */

  }, {
    key: '_incrementOwnerOfferCount',
    value: function _incrementOwnerOfferCount(account) {
      var result = (this._offerCounts[account] || 0) + 1;
      this._offerCounts[account] = result;
      return result;
    }

    /**
     * Set funded amount on offer with its owner's cached funds
     *
     * is_fully_funded indicates if these funds are sufficient for the offer
     * placed.
     * taker_gets_funded indicates the amount this account can afford to offer.
     * taker_pays_funded indicates adjusted TakerPays for partially funded offer.
     *
     * @param {Object} offer
     * @return offer
     */

  }, {
    key: '_setOfferFundedAmount',
    value: function _setOfferFundedAmount(offer) {
      assert.strictEqual(typeof offer, 'object', 'Offer is invalid');

      var takerGets = parseRippledAmount(offer.TakerGets);
      var fundedAmount = this._getOwnerFunds(offer.Account);
      var previousOfferSum = this._getOwnerOfferTotal(offer.Account);
      var currentOfferSum = previousOfferSum.add(takerGets);

      offer.owner_funds = this._getUnadjustedOwnerFunds(offer.Account);

      assert(fundedAmount.constructor === currentOfferSum.constructor);
      offer.is_fully_funded = fundedAmount.comparedTo(currentOfferSum) >= 0;

      if (offer.is_fully_funded) {
        offer.taker_gets_funded = takerGets.toString();
        offer.taker_pays_funded = OrderBook._getValFromRippledAmount(offer.TakerPays);
      } else if (previousOfferSum.comparedTo(fundedAmount) < 0) {
        offer.taker_gets_funded = fundedAmount.subtract(previousOfferSum).toString();

        var quality = new IOUValue(offer.quality);
        var takerPaysFunded = quality.multiply(new IOUValue(offer.taker_gets_funded));

        offer.taker_pays_funded = this._currencyPays === 'XRP' ? String(Math.floor(Number(takerPaysFunded.toString()))) : takerPaysFunded.toString();
      } else {
        offer.taker_gets_funded = '0';
        offer.taker_pays_funded = '0';
      }

      return offer;
    }

    /**
     * Add amount sum being offered for owner
     *
     * @param {String} account - owner's account address
     * @param {Object|String} amount - offer amount as native string or IOU
     *                                 currency format
     * @return {Amount}
     */

  }, {
    key: '_addOwnerOfferTotal',
    value: function _addOwnerOfferTotal(account, amount) {
      var previousAmount = this._getOwnerOfferTotal(account);
      var currentAmount = previousAmount.add(this._makeGetsValue(amount));

      this._ownerOffersTotal[account] = currentAmount;

      return currentAmount;
    }

    /**
    * Get offers amount sum for owner
    *
    * @param {String} account - owner's account address
    * @return {Value}
    */

  }, {
    key: '_getOwnerOfferTotal',
    value: function _getOwnerOfferTotal(account) {
      var amount = this._ownerOffersTotal[account];
      if (amount) {
        return amount;
      }
      return this._currencyGets === 'XRP' ? ZERO_NATIVE_AMOUNT : ZERO_NORMALIZED_AMOUNT;
    }
  }, {
    key: '_makeGetsValue',
    value: function _makeGetsValue(value_) {
      var value = OrderBook._getValFromRippledAmount(value_);
      return this._currencyGets === 'XRP' ? new XRPValue(value) : new IOUValue(value);
    }

    /**
     * Get owner's cached unadjusted funds
     *
     * @param {String} account - owner's account address
     * @return {String}
     */

  }, {
    key: '_getUnadjustedOwnerFunds',
    value: function _getUnadjustedOwnerFunds(account) {
      return this._ownerFundsUnadjusted[account];
    }

    /**
     * Get owner's cached, transfer rate adjusted, funds
     *
     * @param {String} account - owner's account address
     * @return {Value}
     */

  }, {
    key: '_getOwnerFunds',
    value: function _getOwnerFunds(account) {
      if (this._hasOwnerFunds(account)) {
        return this._makeGetsValue(this._ownerFunds[account]);
      }
      if (this._trace) {
        log.info('No owner funds for ' + account, this._key);
      }
      throw new this._api.errors.RippleError('No owner funds');
    }

    /**
     * Reset cached owner's funds, offer counts, and offer sums
     */

  }, {
    key: '_resetCache',
    value: function _resetCache() {
      this._ownerFundsUnadjusted = {};
      this._ownerFunds = {};
      this._ownerOffersTotal = {};
      this._offerCounts = {};
      this._offers = [];
      this._synced = false;

      if (this._validAccountsCount > 3000) {
        this._validAccounts = {};
        this._validAccountsCount = 0;
      }
    }
  }, {
    key: '_emitAsync',
    value: function _emitAsync(args) {
      var _this8 = this;

      setTimeout(function () {
        return _this8.emit.apply(_this8, args);
      }, 0);
    }

    /**
     * Compute autobridged offers for an IOU:IOU orderbook by merging offers from
     * IOU:XRP and XRP:IOU books
     */

  }, {
    key: '_computeAutobridgedOffers',
    value: function _computeAutobridgedOffers() {
      var _this9 = this;

      assert(this._currencyGets !== 'XRP' && this._currencyPays !== 'XRP', 'Autobridging is only for IOU:IOU orderbooks');

      if (this._trace) {
        log.info('_computeAutobridgedOffers autobridgeCalculator.calculate', this._key);
      }

      // this check is only for flow
      var legOneOffers = this._legOneBook !== null && this._legOneBook !== undefined ? this._legOneBook.getOffersSync() : [];
      var legTwoOffers = this._legTwoBook !== null && this._legTwoBook !== undefined ? this._legTwoBook.getOffersSync() : [];

      var autobridgeCalculator = new AutobridgeCalculator(this._currencyGets, this._currencyPays, legOneOffers, legTwoOffers, this._issuerGets, this._issuerPays);

      return autobridgeCalculator.calculate().then(function (autobridgedOffers) {
        _this9._offersAutobridged = autobridgedOffers;
      });
    }
  }, {
    key: '_computeAutobridgedOffersWrapper',
    value: function _computeAutobridgedOffersWrapper() {
      var _this10 = this;

      if (this._trace) {
        log.info('_computeAutobridgedOffersWrapper', this._key, this._synced, this._calculatorRunning);
      }
      if (!this._gotOffersFromLegOne || !this._gotOffersFromLegTwo || !this._synced || this._calculatorRunning) {
        return;
      }

      this._calculatorRunning = true;
      this._computeAutobridgedOffers().then(function () {
        _this10._mergeDirectAndAutobridgedBooks();
        _this10._calculatorRunning = false;
      });
    }

    /**
     * Merge direct and autobridged offers into a combined orderbook
     *
     * @return
     */

  }, {
    key: '_mergeDirectAndAutobridgedBooks',
    value: function _mergeDirectAndAutobridgedBooks() {
      if (_.isEmpty(this._offers) && _.isEmpty(this._offersAutobridged)) {
        if (this._synced && this._gotOffersFromLegOne && this._gotOffersFromLegTwo) {
          // emit empty model to indicate to listeners that we've got offers,
          // just there was no one
          this._emitAsync(['model', []]);
        }
        return;
      }

      this._mergedOffers = this._offers.concat(this._offersAutobridged).sort(_sortOffersQuick);

      this._emitAsync(['model', this._mergedOffers]);
    }
  }], [{
    key: 'createOrderBook',
    value: function createOrderBook(api, options) {
      var orderbook = new OrderBook(api, options.currency_gets, options.issuer_gets, options.currency_pays, options.issuer_pays, options.account, options.ledger_index, options.trace);
      return orderbook;
    }
  }, {
    key: '_getValFromRippledAmount',
    value: function _getValFromRippledAmount(value_) {
      return typeof value_ === 'string' ? value_ : value_.value;
    }

    /**
     * Normalize offers from book_offers and transaction stream
     *
     * @param {Object} offer
     * @return {Object} normalized
     */

  }, {
    key: '_offerRewrite',
    value: function _offerRewrite(offer) {
      var result = {};
      var keys = _Object$keys(offer);

      for (var i = 0, l = keys.length; i < l; i++) {
        var _key = keys[i];
        switch (_key) {
          case 'PreviousTxnID':
          case 'PreviousTxnLgrSeq':
            break;
          default:
            result[_key] = offer[_key];
        }
      }

      result.Flags = result.Flags || 0;
      result.OwnerNode = result.OwnerNode || new Array(16 + 1).join('0');
      result.BookNode = result.BookNode || new Array(16 + 1).join('0');
      result.qualityHex = result.BookDirectory.slice(-16);

      return result;
    }
  }]);

  return OrderBook;
})(EventEmitter);

exports.OrderBook = OrderBook;
