"use strict";
const fs       = require('fs');
const Poloniex = require('poloniex-api-node');
const Queue    = require('superqueue');

const prices = {
    BTC_ETH: {},
    BTC_BCH: {},
    ETH_BCH: {},
};

const poloniex = new Poloniex();
const queue = new Queue({
    rate: 4,
    concurrency: 100000,
});
queue.addFlag('private', { concurrency: 1 });
queue.addFlag('ticker', { concurrency: 100000, interval: 300 });


// Permanent rolling ticker
 const addTicker = () => {
    queue.push({ flags: ['ticker'], priority: 5 }, () => { return poloniex.returnTicker(); })
        .then((result) => {
            let changed = false;
            if (JSON.stringify(prices.BTC_ETH) !== JSON.stringify(result.BTC_ETH)) {
                prices.BTC_ETH = result.BTC_ETH;
                changed = true;
            }
            if (JSON.stringify(prices.BTC_BCH) !== JSON.stringify(result.BTC_BCH)) {
                prices.BTC_BCH = result.BTC_BCH;
                changed = true;
            }
            if (JSON.stringify(prices.ETH_BCH) !== JSON.stringify(result.ETH_BCH)) {
                prices.ETH_BCH = result.ETH_BCH;
                changed = true;
            }
            if (changed) {
                console.log(Date.now(), 'Prices updated');
                fs.appendFileSync(`${process.cwd()}/data/recon/data.txt`, Date.now() + ' ' + JSON.stringify(prices) + '\n');
            }
        })
        .catch((err) => {
            console.error('Error:', err);
        })
        .then(() => {
            setImmediate(addTicker);
        });
};

addTicker();
