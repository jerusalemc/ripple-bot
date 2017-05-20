'use strict';
const ripple = require('ripple-lib');

var request = require('request');


const RippleAPI = ripple.RippleAPI; // require('ripple-lib')

// const api = new RippleAPI({server: 'wss://s1.ripple.com:443'});
const api = new RippleAPI({server: 'wss://stellar.chat:8443'});

const address = 'rGMg4W3XiD1HLF7kzuBbz7EBBZptMCnysk';

// rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y
// rEt2Zom7pVT7oTYvV1uLVRg3tcL4dGFdb6

const nameToAd = {
  bitstamp: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
  rippleChina: 'razqQKzJRdB4UxFPWf5NEpEG3WMkmwgcXA',
  rippleFox: 'rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y',
  gatehubFifth: 'rchGBxcD1A1C2tdxF6papQYZ8kjRKMYcL',
  gatehub: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq',
  rippleCN: 'rnuF96W4SZoCJmbHYBFoJZpR8eCaxNvekK',
  xiaobu: 'rBqC5LRFE93v8jX5Hdu5K9qKAMziwLrKMb',
  rippleSignapore: 'r9Dr5xwkeLegBeXq6ujinjSBLQzQ1zQGjH',
}

const adToName = (function(ads) {
  const dict = {};
  Object.keys(ads).forEach(key => {
    dict[ads[key]] = key;
  });
  return dict;
})(nameToAd);

const fox = {
  "currency": "CNY",
  "counterparty": "rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y",
};

const china = {
  "currency": "CNY",
  "counterparty": "razqQKzJRdB4UxFPWf5NEpEG3WMkmwgcXA",
};

const foxChina = {
  base: fox,
  counter: china,
};

const chinaFox = {
  base: china,
  counter: fox,
};


let foxBalance = 0;
let chinaBalance = 0;

let hasFoxSell = false;
let hasChinaSell = false;

const NOTI_INTERVAL = 60 * 1000 * 30;

let lastNotification = Date.now() - NOTI_INTERVAL;


function notifyIFTTT(name) {
  const myJSONObject = {
    value1: name + ' is available to sell now! Let\'s sell some ' + name + '!',
  };
  request({
      url: "https://maker.ifttt.com/trigger/ripple/with/key/c7EH2oDnWYMHwos5qVC771",
      method: "POST",
      json: true,   // <--Very important!!!
      body: myJSONObject
  }, function (error, response, body){
    if (error) {
      console.log('Send Requst Error:', JSON.stringify(error));
    }
  });
}

// notifyIFTTT('China');

function output() {
  console.log('===== Current Status =====')
  console.log('Total CNY:' + foxBalance + chinaBalance);
  console.log('Fox:' + foxBalance);
  console.log('China:' + chinaBalance);
  console.log('Open orders:');
  if (hasFoxSell) {
    console.log('Fox is open');
  }
  if (hasChinaSell) {
    console.log('China is open');
  }
  if (Date.now() - lastNotification > NOTI_INTERVAL) {
    if (!hasChinaSell && chinaBalance > 0) {
      console.log('We could sell china');
      notifyIFTTT('China');
    } else if (!hasFoxSell && foxBalance > 0) {
      console.log('We could sell fox');
      notifyIFTTT('Fox');
    }
  }
}

function showPrices(orderbook, key, reverse) {
  const len = Math.min(5, orderbook[key].length);
  for (let i = 0; i < len; i++) {
    // if (reverse) {
    //  console.log (1 / orderbook[key][i].properties.makerExchangeRate);
    //} else {
      console.log(orderbook[key][i].properties.makerExchangeRate);
    // }
  }
}


function checkStatus() {
  api.getBalances(address).then(balances => {
    for (const balance of balances) {
      if (balance.currency === 'CNY') {
        if (balance.counterparty === fox.counterparty) {
          foxBalance = balance.value;
        } else if (balance.counterparty === china.counterparty) {
          chinaBalance = balance.value;
        }
      }
    }

    /* Get orders*/

    api.getOrders(address).then(orders => {
      hasChinaSell = false;
      hasFoxSell = false;
      for (const order of orders) {
        if (
          // sell from China to Fox
          order.specification.direction === 'sell' &&
          order.specification.quantity.currency === 'CNY'
          && order.specification.quantity.counterparty === china.counterparty
          && order.specification.totalPrice.currency === 'CNY'
          && order.specification.totalPrice.counterparty === fox.counterparty
        ) {
          console.log('Selling China at:', order.properties.makerExchangeRate);
          hasChinaSell = true;
        } else if (
          // sell from Fox to China
          order.specification.direction === 'sell' &&
          order.specification.quantity.currency === 'CNY'
          && order.specification.quantity.counterparty === fox.counterparty
          && order.specification.totalPrice.currency === 'CNY'
          && order.specification.totalPrice.counterparty === china.counterparty
        ) {
          console.log('Selling  Fox at:', order.properties.makerExchangeRate);
          hasFoxSell = true;
        }
      }

      output();

    });


    api.getOrderbook(address, foxChina)
      .then(orderbook => {
        console.log('===== Current Price =====')
        console.log('China selling price:');
        showPrices(orderbook, 'bids', true);
        console.log('Fox selling price:');
        showPrices(orderbook, 'asks');
        // console.log(JSON.stringify(orderbook));
    }).catch(ex => {
      console.log('Something went wrong...', ex);
    });

  });
}


function notify(msg) {
  console.log(msg);

  const myJSONObject = {
    value1: msg,
  };
  request({
      url: "https://maker.ifttt.com/trigger/ripple/with/key/c7EH2oDnWYMHwos5qVC771",
      method: "POST",
      json: true,
      body: myJSONObject
  }, function (error, response, body){
    // console.log(body);

    if (error) {
      console.log('Send Requst Error:', JSON.stringify(error));
    }
  });
}

function getCurrency(quantity) {
  const str = quantity.currency === 'XRP' ?
  'XRP' : `${quantity.currency}.${adToName[quantity.counterparty] ? adToName[quantity.counterparty] : quantity.counterparty}`;
  return str;
}


var sellingStore = {};
function diffSelling() {
  api.getOrders(address).then(orders => {

    const newSelling = {};
    for (const order of orders) {
      const key = `${order.specification.direction}/${getCurrency(order.specification.quantity)}/${getCurrency(order.specification.totalPrice)}`;
      newSelling[key] = true;
      if (key in sellingStore) {
        delete sellingStore[key];
      }
      // console.log(order.specification.direction, getCurrency(order.specification.quantity), order.specification.quantity.value);
      // console.log('For', getCurrency(order.specification.totalPrice), order.specification.totalPrice.value);
    }
    // console.log(sellingStore, newSelling);

    const remaining = Object.keys(sellingStore);
    if (remaining.length) {
      const msg = Object.keys(sellingStore).reduce((prev, curr) => {
        return prev + curr + '<br/>';
      }, '<b>Some order has been filed:</b><br/>');
      notify(msg);
    } else {
      console.log('Checked Orders');
    }
    // sellingStore = null;
    sellingStore = newSelling;

  });
}


const balanceStore = {};
function diffBalance() {
  api.getBalances(address).then(balances => {
    let msg = '<b>Balance Changed:</b><br/>';
    let hasChange = false;
    for (const balance of balances) {
      const key = getCurrency(balance);
      if (balanceStore[key] !== balance.value) { // value changes
        const diffAmount = balance.value - (balanceStore[key] ? balanceStore[key] : 0);
        msg += `${key}: ${diffAmount >= 0 ? '+' : ''}${diffAmount}<br/>`;
        msg += `Current ${key}: ${balance.value}<br/>`;
        hasChange = true;
      }
      balanceStore[key] = balance.value;
      // console.log(`${getCurrency(balance)}: ${balance.value}`);
    }
    if (hasChange) {
      notify(msg);
    } else {
      console.log('Checked Balance');
    }
  });
}

api.connect().then(() => {
  // checkStatus();

  // check every one minute
  // setInterval(checkStatus, 60 * 1000);

  diffBalance();
  diffSelling();

  setInterval(() => {
    diffBalance();
    diffSelling();
  }, 30 * 1000);

  api.on('error', (errorCode, errorMessage, data) => {
    console.log(errorCode + ': ' + errorMessage);
  });

});

// https://maker.ifttt.com/trigger/ripple/with/key/c7EH2oDnWYMHwos5qVC771
