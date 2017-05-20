// looking for profit between exchanges!!


'use strict';
const ripple = require('ripple-lib');

var request = require('axios');

// deprecated
// const RippleAPI = ripple.RippleAPI; // require('ripple-lib')
// const api = new RippleAPI({server: 'wss://stellar.chat:8443'});

const address = 'rGMg4W3XiD1HLF7kzuBbz7EBBZptMCnysk';

// rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y
// rEt2Zom7pVT7oTYvV1uLVRg3tcL4dGFdb6

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


const FOX = `CNY+${NAMES.rippleFox}`;
const CHINA = `CNY+${NAMES.rippleChina}`;

const GATEHUB = `ETH+${NAMES.gatehubFifthETH}`;

const BASE_URL = 'https://data.ripple.com/v2/exchanges/';



async function listenRipple() {
  try {
    const result = await request.get(`${BASE_URL}${GATEHUB}/${FOX}?&start=2017-04-26T00:00:00&end=2017-04-27T23:59:59&descending=true`);
    const books = result.data.exchanges;
    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      console.log(book.rate);
      console.log(book.base_amount);
      console.log(book.tx_type);
      console.log(book.base_currency);
      // console.log(book.counter_amount / book.base_amount);
    }
  } catch(ex) {
    console.log('Some shit happened', ex);
  }

}

/*
async function listenRipple() {
  const result = await api.connect();
  console.log('Connected');
  try {
    const orderbook = await api.getOrderbook(address, CHINA_GATEHUB);
    console.log(JSON.stringify(orderbook));
  } catch(ex) {

  }
}
*/




listenRipple();
