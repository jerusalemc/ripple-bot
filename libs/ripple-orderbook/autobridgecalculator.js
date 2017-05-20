

'use strict';

var _createClass = require('babel-runtime/helpers/create-class')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _Promise = require('babel-runtime/core-js/promise')['default'];

var _ = require('lodash');
var assert = require('assert');
var Utils = require('./orderbookutils');

var _require = require('ripple-lib-value');

var IOUValue = _require.IOUValue;

function assertValidNumber(number, message) {
  assert(!_.isNull(number) && !isNaN(number), message);
}

function assertValidLegOneOffer(legOneOffer, message) {
  assert(legOneOffer);
  assert.strictEqual(typeof legOneOffer, 'object', message);
  assert.strictEqual(typeof legOneOffer.TakerPays, 'object', message);
  assertValidNumber(legOneOffer.TakerGets, message);
}

var ZERO_VALUE = new IOUValue('0');

var AutobridgeCalculator = (function () {
  function AutobridgeCalculator(currencyGets, currencyPays, legOneOffers, legTwoOffers, issuerGets, issuerPays) {
    _classCallCheck(this, AutobridgeCalculator);

    this._currencyGets = currencyGets;
    this._currencyPays = currencyPays;
    this._issuerGets = issuerGets;
    this._issuerPays = issuerPays;
    this.legOneOffers = _.cloneDeep(legOneOffers);
    this.legTwoOffers = _.cloneDeep(legTwoOffers);

    this._ownerFundsLeftover = {};
  }

  /**
   * Calculates an ordered array of autobridged offers by quality
   *
   * @return {Array}
   */

  _createClass(AutobridgeCalculator, [{
    key: 'calculate',
    value: function calculate() {
      var _this = this;

      var legOnePointer = 0;
      var legTwoPointer = 0;

      var offersAutobridged = [];

      this._ownerFundsLeftover = {};

      return new _Promise(function (resolve) {
        _this._calculateInternal(legOnePointer, legTwoPointer, offersAutobridged, resolve);
      });
    }
  }, {
    key: '_calculateInternal',
    value: function _calculateInternal(legOnePointer_, legTwoPointer_, offersAutobridged, resolve) {

      var legOnePointer = legOnePointer_;
      var legTwoPointer = legTwoPointer_;

      var startTime = Date.now();

      while (this.legOneOffers[legOnePointer] && this.legTwoOffers[legTwoPointer]) {
        // manually implement cooperative multitasking that yields after 30ms
        // of execution so user's browser stays responsive
        var lasted = Date.now() - startTime;
        if (lasted > 30) {
          setTimeout(this._calculateInternal.bind(this, legOnePointer, legTwoPointer, offersAutobridged, resolve), 0);

          return;
        }

        var legOneOffer = this.legOneOffers[legOnePointer];
        var legTwoOffer = this.legTwoOffers[legTwoPointer];
        var leftoverFunds = this._getLeftoverOwnerFunds(legOneOffer.Account);
        var autobridgedOffer = undefined;

        if (legOneOffer.Account === legTwoOffer.Account) {
          this._unclampLegOneOwnerFunds(legOneOffer);
        } else if (!legOneOffer.is_fully_funded && !leftoverFunds.isZero()) {
          this._adjustLegOneFundedAmount(legOneOffer);
        }

        var legOneTakerGetsFunded = this._getOfferTakerGetsFunded(legOneOffer);
        var legTwoTakerPaysFunded = this._getOfferTakerPaysFunded(legTwoOffer);

        if (legOneTakerGetsFunded.isZero()) {
          legOnePointer++;

          continue;
        }

        if (legTwoTakerPaysFunded.isZero()) {
          legTwoPointer++;

          continue;
        }

        var compared = legOneTakerGetsFunded.comparedTo(legTwoTakerPaysFunded);
        if (compared > 0) {
          autobridgedOffer = this._getAutobridgedOfferWithClampedLegOne(legOneOffer, legTwoOffer);

          legTwoPointer++;
        } else if (compared < 0) {
          autobridgedOffer = this._getAutobridgedOfferWithClampedLegTwo(legOneOffer, legTwoOffer);

          legOnePointer++;
        } else {
          autobridgedOffer = this._getAutobridgedOfferWithoutClamps(legOneOffer, legTwoOffer);

          legOnePointer++;
          legTwoPointer++;
        }

        // calculate quality from leg qualities
        var legOneQuality = new IOUValue(legOneOffer.quality);
        var legTwoQuality = new IOUValue(legTwoOffer.quality);
        autobridgedOffer.quality = legOneQuality.multiply(legTwoQuality).toFixed();
        autobridgedOffer.BookDirectory = Utils.convertOfferQualityToHexFromText(autobridgedOffer.quality);
        autobridgedOffer.qualityHex = autobridgedOffer.BookDirectory;

        offersAutobridged.push(autobridgedOffer);
      }

      resolve(offersAutobridged);
    }

    /**
    * In this case, the output from leg one and the input to leg two are the
    * same. We do not need to clamp either.
    * @param {Object} legOneOffer
    * @param {Object} legTwoOffer
    *
    * @return {Object}
    */

  }, {
    key: '_getAutobridgedOfferWithoutClamps',
    value: function _getAutobridgedOfferWithoutClamps(legOneOffer, legTwoOffer) {
      var autobridgedTakerGets = this._getOfferTakerGetsFunded(legTwoOffer);
      var autobridgedTakerPays = this._getOfferTakerPaysFunded(legOneOffer);

      return this._formatAutobridgedOffer(autobridgedTakerGets, autobridgedTakerPays);
    }

    /**
     * In this case, the input from leg two is greater than the output to leg one.
     * Therefore, we must effectively clamp leg two input to leg one output.
     *
     * @param {Object} legOneOffer
     * @param {Object} legTwoOffer
     *
     * @return {Object}
     */

  }, {
    key: '_getAutobridgedOfferWithClampedLegTwo',
    value: function _getAutobridgedOfferWithClampedLegTwo(legOneOffer, legTwoOffer) {
      var legOneTakerGetsFunded = this._getOfferTakerGetsFunded(legOneOffer);
      var legTwoTakerPaysFunded = this._getOfferTakerPaysFunded(legTwoOffer);
      var legTwoQuality = new IOUValue(legTwoOffer.quality);

      var autobridgedTakerGets = legOneTakerGetsFunded.divide(legTwoQuality);
      var autobridgedTakerPays = this._getOfferTakerPaysFunded(legOneOffer);

      // Update funded amount since leg two offer was not completely consumed
      legTwoOffer.taker_gets_funded = this._getOfferTakerGetsFunded(legTwoOffer).subtract(autobridgedTakerGets).toFixed();
      legTwoOffer.taker_pays_funded = legTwoTakerPaysFunded.subtract(legOneTakerGetsFunded).toFixed();

      return this._formatAutobridgedOffer(autobridgedTakerGets, autobridgedTakerPays);
    }

    /**
     * In this case, the output from leg one is greater than the input to leg two.
     * Therefore, we must effectively clamp leg one output to leg two input.
     *
     * @param {Object} legOneOffer
     * @param {Object} legTwoOffer
     *
     * @return {Object}
     */

  }, {
    key: '_getAutobridgedOfferWithClampedLegOne',
    value: function _getAutobridgedOfferWithClampedLegOne(legOneOffer, legTwoOffer) {
      var legOneTakerGetsFunded = this._getOfferTakerGetsFunded(legOneOffer);
      var legTwoTakerPaysFunded = this._getOfferTakerPaysFunded(legTwoOffer);
      var legOneQuality = new IOUValue(legOneOffer.quality);

      var autobridgedTakerGets = this._getOfferTakerGetsFunded(legTwoOffer);
      var autobridgedTakerPays = legTwoTakerPaysFunded.multiply(legOneQuality);

      if (legOneOffer.Account === legTwoOffer.Account) {
        var legOneTakerGets = this._getOfferTakerGets(legOneOffer);
        var updatedTakerGets = legOneTakerGets.subtract(legTwoTakerPaysFunded);

        this._setLegOneTakerGets(legOneOffer, updatedTakerGets);

        this._clampLegOneOwnerFunds(legOneOffer);
      } else {
        // Update funded amount since leg one offer was not completely consumed
        var updatedTakerGetsFunded = legOneTakerGetsFunded.subtract(legTwoTakerPaysFunded);

        this._setLegOneTakerGetsFunded(legOneOffer, updatedTakerGetsFunded);
      }

      return this._formatAutobridgedOffer(autobridgedTakerGets, autobridgedTakerPays);
    }

    /**
     * Format an autobridged offer and compute synthetic values (e.g. quality)
     *
     * @param {IOUValue} takerGets
     * @param {IOUValue} takerPays
     *
     * @return {Object}
     */

  }, {
    key: '_formatAutobridgedOffer',
    value: function _formatAutobridgedOffer(takerGets, takerPays) {
      assert(takerGets instanceof IOUValue, 'Autobridged taker gets is invalid');
      assert(takerPays instanceof IOUValue, 'Autobridged taker pays is invalid');

      var autobridgedOffer = {};

      autobridgedOffer.TakerGets = {
        value: takerGets.toFixed(),
        currency: this._currencyGets,
        issuer: this._issuerGets
      };

      autobridgedOffer.TakerPays = {
        value: takerPays.toFixed(),
        currency: this._currencyPays,
        issuer: this._issuerPays
      };

      autobridgedOffer.taker_gets_funded = autobridgedOffer.TakerGets.value;
      autobridgedOffer.taker_pays_funded = autobridgedOffer.TakerPays.value;
      autobridgedOffer.autobridged = true;

      return autobridgedOffer;
    }

    /**
     * Apply clamp back on leg one offer after a round of autobridge calculation
     * completes. We must reapply clamps that have been removed because we cannot
     * guarantee that the next offer from leg two will also be from the same
     * account.
     *
     * When we reapply, it could happen that the amount of TakerGets left after
     * the autobridge calculation is less than the original funded amount. In this
     * case, we have extra funds we can use towards unfunded offers with worse
     * quality by the same owner.
     *
     * @param {Object} legOneOffer - IOU:XRP offer
     */

  }, {
    key: '_clampLegOneOwnerFunds',
    value: function _clampLegOneOwnerFunds(legOneOffer) {
      assertValidLegOneOffer(legOneOffer, 'Leg one offer is invalid');

      var takerGets = this._getOfferTakerGets(legOneOffer);

      if (takerGets.comparedTo(legOneOffer.initTakerGetsFunded) > 0) {
        // After clamping, TakerGets is still greater than initial funded amount
        this._setLegOneTakerGetsFunded(legOneOffer, legOneOffer.initTakerGetsFunded);
      } else {
        var updatedLeftover = legOneOffer.initTakerGetsFunded.subtract(takerGets);

        this._setLegOneTakerGetsFunded(legOneOffer, takerGets);
        this._addLeftoverOwnerFunds(legOneOffer.Account, updatedLeftover);
      }
    }

    /**
     * Add funds to account's leftover funds
     *
     * @param {String} account
     * @param {IOUValue} amount
     *
     * @return {IOUValue}
     */

  }, {
    key: '_addLeftoverOwnerFunds',
    value: function _addLeftoverOwnerFunds(account, amount) {
      assert(amount instanceof IOUValue, 'Amount is invalid');

      this._ownerFundsLeftover[account] = this._getLeftoverOwnerFunds(account).add(amount);

      return this._ownerFundsLeftover[account];
    }

    /**
     * Remove funds clamp on leg one offer. This is necessary when the two offers
     * are owned by the same account. In this case, it doesn't matter if offer one
     * is not fully funded. Leg one out goes to leg two in and since its the same
     * account, an infinite amount can flow.
     *
     * @param {Object} legOneOffer - IOU:XRP offer
     */

  }, {
    key: '_unclampLegOneOwnerFunds',
    value: function _unclampLegOneOwnerFunds(legOneOffer) {
      assertValidLegOneOffer(legOneOffer, 'Leg one offer is invalid');

      legOneOffer.initTakerGetsFunded = this._getOfferTakerGetsFunded(legOneOffer);

      this._setLegOneTakerGetsFunded(legOneOffer, this._getOfferTakerGets(legOneOffer));
    }

    /**
     * Set taker gets amount for a IOU:XRP offer. Also calculates taker pays
     * using offer quality
     *
     * @param {Object} legOneOffer - IOU:XRP offer
     * @param {IOUValue} takerGets
     */

  }, {
    key: '_setLegOneTakerGets',
    value: function _setLegOneTakerGets(legOneOffer, takerGets) {
      assertValidLegOneOffer(legOneOffer, 'Leg one offer is invalid');
      assert(takerGets instanceof IOUValue, 'Taker gets funded is invalid');

      var legOneQuality = new IOUValue(legOneOffer.quality);

      legOneOffer.TakerGets = takerGets.toFixed();
      var value = takerGets.multiply(legOneQuality);
      legOneOffer.TakerPays = {
        currency: this._currencyPays,
        issuer: this._issuerPays,
        value: value.toFixed()
      };
    }

    /**
     * Set taker gets funded amount for a IOU:XRP offer. Also calculates taker
     * pays funded using offer quality and updates is_fully_funded flag
     *
     * @param {Object} legOneOffer - IOU:XRP offer
     * @param {IOUValue} takerGetsFunded
     */

  }, {
    key: '_setLegOneTakerGetsFunded',
    value: function _setLegOneTakerGetsFunded(legOneOffer, takerGetsFunded) {
      assertValidLegOneOffer(legOneOffer, 'Leg one offer is invalid');
      assert(takerGetsFunded instanceof IOUValue, 'Taker gets funded is invalid');

      legOneOffer.taker_gets_funded = takerGetsFunded.toFixed();
      legOneOffer.taker_pays_funded = takerGetsFunded.multiply(new IOUValue(legOneOffer.quality)).toFixed();

      if (legOneOffer.taker_gets_funded === legOneOffer.TakerGets.value) {
        legOneOffer.is_fully_funded = true;
      }
    }

    /**
     * Increase leg one offer funded amount with extra funds found after applying
     * clamp.
     *
     * @param {Object} legOneOffer - IOU:XRP offer
     */

  }, {
    key: '_adjustLegOneFundedAmount',
    value: function _adjustLegOneFundedAmount(legOneOffer) {
      assertValidLegOneOffer(legOneOffer, 'Leg one offer is invalid');
      assert(!legOneOffer.is_fully_funded, 'Leg one offer cannot be fully funded');

      var fundedSum = this._getOfferTakerGetsFunded(legOneOffer).add(this._getLeftoverOwnerFunds(legOneOffer.Account));

      if (fundedSum.comparedTo(this._getOfferTakerGets(legOneOffer)) >= 0) {
        // There are enough extra funds to fully fund the offer
        var legOneTakerGets = this._getOfferTakerGets(legOneOffer);
        var updatedLeftover = fundedSum.subtract(legOneTakerGets);

        this._setLegOneTakerGetsFunded(legOneOffer, legOneTakerGets);
        this._setLeftoverOwnerFunds(legOneOffer.Account, updatedLeftover);
      } else {
        // There are not enough extra funds to fully fund the offer
        this._setLegOneTakerGetsFunded(legOneOffer, fundedSum);
        this._resetOwnerFundsLeftover(legOneOffer.Account);
      }
    }

    /**
     * Reset owner funds leftovers for an account to 0
     *
     * @param {String} account
     *
     * @return {IOUValue}
     */

  }, {
    key: '_resetOwnerFundsLeftover',
    value: function _resetOwnerFundsLeftover(account) {
      this._ownerFundsLeftover[account] = ZERO_VALUE;

      return this._ownerFundsLeftover[account];
    }

    /**
     * Set account's leftover funds
     *
     * @param {String} account
     * @param {IOUValue} amount
     */

  }, {
    key: '_setLeftoverOwnerFunds',
    value: function _setLeftoverOwnerFunds(account, amount) {
      assert(amount instanceof IOUValue, 'Amount is invalid');

      this._ownerFundsLeftover[account] = amount;
    }

    /**
     * Retrieve leftover funds found after clamping leg one by account
     *
     * @param {String} account
     *
     * @return {IOUValue}
     */

  }, {
    key: '_getLeftoverOwnerFunds',
    value: function _getLeftoverOwnerFunds(account) {
      var amount = this._ownerFundsLeftover[account];

      if (!amount) {
        amount = ZERO_VALUE;
      }

      return amount;
    }
  }, {
    key: '_getOfferTakerGetsFunded',
    value: function _getOfferTakerGetsFunded(offer) {
      assertValidNumber(offer.taker_gets_funded, 'Taker gets funded is invalid');
      return new IOUValue(offer.taker_gets_funded);
    }
  }, {
    key: '_getOfferTakerPaysFunded',
    value: function _getOfferTakerPaysFunded(offer) {
      assertValidNumber(offer.taker_pays_funded, 'Taker pays funded is invalid');
      return new IOUValue(offer.taker_pays_funded);
    }
  }, {
    key: '_getOfferTakerGets',
    value: function _getOfferTakerGets(offer) {
      assert(typeof offer, 'object', 'Offer is invalid');
      return new IOUValue(Utils.getValueFromRippledAmount(offer.TakerGets));
    }
  }]);

  return AutobridgeCalculator;
})();

exports.AutobridgeCalculator = AutobridgeCalculator;