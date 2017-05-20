// looking for profit between exchanges!!

'use strict';
const ripple = require('ripple-lib');

var request = require('request');

var axios = require('axios');

var BigNumber = require('bignumber.js');


const RippleAPI = ripple.RippleAPI; // require('ripple-lib')

var RippleOrderBook = require('./libs/ripple-orderbook').OrderBook;

const api = new RippleAPI({server: 'wss://s2.ripple.com:443'});
// var api = new RippleAPI({server: 'wss://s1.ripple.com'});
const address = 'rrrrrrrrrrrrrrrrrrrrBZbvji';

const NAMES = {
  bitstamp: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
  rippleChina: 'razqQKzJRdB4UxFPWf5NEpEG3WMkmwgcXA',
  rippleFox: 'rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y',
  gatehubFifth: 'rchGBxcD1A1C2tdxF6papQYZ8kjRKMYcL',
  gatehubFifthETH: 'rcA8X3TVMST1n3CJeAdGk1RdRCHii7N2h',
  gatehub: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq',
  rippleCN: 'rnuF96W4SZoCJmbHYBFoJZpR8eCaxNvekK',
  xiaobu: 'rBqC5LRFE93v8jX5Hdu5K9qKAMziwLrKMb',
  rippleSignapore: 'r9Dr5xwkeLegBeXq6ujinjSBLQzQ1zQGjH',
}


/*

  Variables

*/

// ask, bid (ETH)
const prices = {
  fox: [null, null],
  china: [null, null],
  btsd: [null, null],
}
// ask eth(means I buy from the seller), bid eth(means I sell to the buyers)
const fees = {
  fox: [0.001, 0.003],  // amortized withdraw fee
  china: [0.001, 0.003], // amortized withdraw fee
  btsd: [0.003, 0.003], // amortized withdraw fee
}

/*

  Retrieve prices

*/
function calcAverage(offers, amount, isAsk) {
  let count = 0;
  let total = 0;
  for(let i = 0; i < offers.length && count < amount; i++) {
    const offer = offers[i];
     //console.log(offer);
    const eth = isAsk ? parseFloat(offer.taker_gets_funded) : parseFloat(offer.taker_pays_funded);
    const cny = isAsk ? parseFloat(offer.taker_pays_funded) : parseFloat(offer.taker_gets_funded);
    count += eth;
    total += cny;
  }
  return total / count;
}

function calcAverageBtsd(offers, amount) {
  let count = 0;
  let total = 0;
  for(let i = 0; i < offers.length && count < amount; i++) {
    const offer = offers[i];
     //console.log(offer);
    const xrp = parseFloat(offer[1]);
    const cny = parseFloat(offer[0]) * xrp;
    count += xrp;
    total += cny;
  }
  return total / count;
}

/*

  Compare prices

*/
let lastCheck = null;
let lastNotification = null;
function comparePrices(a, b, minProfit = 0.025) {
  lastCheck = Date.now();
  if (!prices[a][1] || !prices[b][0]) {
    return;
  }

  // console.log('***')
  // console.log(a.toString() + prices[a][0].toString())
  // console.log(a.toString() + prices[a][1].toString())
  // console.log(b.toString() + prices[b][0].toString())
  // console.log(b.toString() + prices[b][1].toString()) 
  // console.log('@@@') 
  const costSellABuyB = prices[a][1] * fees[a][1] + prices[b][0] * fees[b][1];
  const profitSellABuyB = (prices[a][1] - prices[b][0] - costSellABuyB) / prices[b][0];

  // console.log(`卖了${a}，买${b}`, profitSellABuyB * 100);

  if (lastNotification && (Date.now() - lastNotification < 1000 * 60 * 10)) {
    // 5分钟内提醒过了
    return;
  }
  if (profitSellABuyB > minProfit) {
    lastNotification = Date.now();

    var fs = require('fs');
    var stream = fs.createWriteStream("./send_message/result_xrp.txt");
    stream.once('open', function (fd) {
        stream.write(`[XRP] ${(profitSellABuyB * 100).toFixed(2)}% profit!! Sell ${a} at ¥${prices[a][1].toFixed(2)}, and buy ${b} at ¥${prices[b][0].toFixed(2)}!!`);
        stream.end();
    });

  }
  return profitSellABuyB;
}



function initRippleListeners(issuer, pricePtr) {
  const asksFox = RippleOrderBook.createOrderBook(api, {
    currency_pays: 'CNY',
    issuer_pays: issuer,
    currency_gets: 'XRP',
  });
  const bidsFox = RippleOrderBook.createOrderBook(api, {
    currency_pays: 'XRP',
    currency_gets: 'CNY',
    issuer_gets: issuer,
  });
  asksFox.on('model', (offers) => {
    const average = calcAverage(offers, 20000, true);
    prices[pricePtr][0] = average * 1000000;
  });
  bidsFox.on('model', (offersB) => {
    const average = calcAverage(offersB, 20000, false);
    prices[pricePtr][1] = average * 1000000;
    comparePrices(pricePtr, 'btsd');
    comparePrices('btsd', pricePtr);

  });
}


function listenBtsd() {
  btsdListeners();
  const interval = setInterval(btsdListeners, 60000);
}

async function btsdListeners() {
  try {
    const result = await axios.get('http://www.btc38.com/trade/getTradeList30.php?coinname=XRP&mk_type=CNY');
    const data = result.data;
    if (!data) return;
    const averageSell = calcAverageBtsd(data.sellStr, 20000);
    const averageBuy = calcAverageBtsd(data.buyStr, 20000);
    prices['btsd'][0] = averageSell;
    prices['btsd'][1] = averageBuy;
    // console.log('平均sell', averageSell);
    // console.log('平均buy', averageBuy);
  } catch (ex) {
    console.log(ex);
  }
}


async function listenRipple() {
  try {
    const result = await api.connect();
    api.on('error', (errorCode, errorMessage, data) => {
      console.log(errorCode + ': ' + errorMessage);
    });
    console.log('Connected');

  } catch(ex) {
    console.log('error', ex);
  }
  try {
    initRippleListeners(NAMES.rippleFox, 'fox');
    // initRippleListeners(NAMES.rippleChina, 'china');

  } catch(ex) {
    console.log(' errored', ex);
  }

  /*
    Order book
  */
}


listenBtsd();
listenRipple();


setInterval(() => {
  if (Date.now() - lastCheck > 1000 * 60 * 3) {
    // something happened;
    console.log('Reconnect??');
    api.disconnect();
    api.connect();
    lastCheck = Date.now();

  }
}, 60000)

api.connect();
