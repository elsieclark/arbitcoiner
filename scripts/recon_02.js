"use strict";
process.env.UV_THREADPOOL_SIZE = 128;
const appRoot  = require('app-root-path');
const events   = require('events');
const Logger   = require(appRoot + '/utils/logger.js');
const Poloniex = require('poloniex-api-node');
const Queue    = require('superqueue');

const config   = require(appRoot + '/config/local.config.json');

process.on('unhandledRejection', (reason, p) => {
    Log.info('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

const Log = Logger('trader_02', appRoot + '/data/logs/ledger', appRoot + '/data/logs/info');
const emitter = new events.EventEmitter();
const poloniex = new Poloniex();
const privatePolo = {
    private_0: new Poloniex(...config.private_0),
    private_1: new Poloniex(...config.private_1),
    private_2: new Poloniex(...config.private_2),
    private_util: new Poloniex(...config.private_util),
};


const queue = new Queue({
    rate: 6,
    concurrency: 100000,
});
queue.addFlag('private_0', { concurrency: 1 });
queue.addFlag('private_1', { concurrency: 1 });
queue.addFlag('private_2', { concurrency: 1 });
queue.addFlag('private_util', { concurrency: 1 });

let initialized = false;

const COINS = ['BTC', 'ETH', 'BCH'];
const status = COINS.reduce((acc, val) => {
    acc[val] = {
        balance: 0,
        busy: false,
        BTC: { lowestAsk: 0, highestBid: 0 },
        ETH: { lowestAsk: 0, highestBid: 0 },
        BCH: { lowestAsk: 0, highestBid: 0 },
    };
    acc[val][val] = { lowestAsk: 1, highestBid: 1 };
    return acc;
}, {});


const timestamp = () => {
    const time = new Date();
    return time.toString();
};

const tickerData = {
    startTime: 0,
    executions: 0,
};


poloniex.subscribe('ticker');

poloniex.on('message', (channelName, data, seq) => {
    if (channelName === 'ticker') {
        handleTicker(data);
    }
});

poloniex.on('open', () => {
    console.log(`Poloniex WebSocket connection open`);
});

poloniex.on('close', (reason, details) => {
    console.log(`Poloniex WebSocket connection disconnected`, reason, details);
});

poloniex.on('error', (error) => {
    console.log(`An error has occured`, error);
});

poloniex.openWebSocket({ version: 2 });


const handleTicker = (data) => {
    let changed = false;
    if (data.currencyPair === 'BTC_ETH') {
        tickerData.executions++;
        if (status.BTC.ETH.highestBid = (+data.highestBid).toFixed(8)) {
            changed = true;
            status.BTC.ETH.highestBid = (+data.highestBid).toFixed(8);
            status.ETH.BTC.lowestAsk = 1/ (+data.highestBid).toFixed(8);
        }

        if (status.BTC.ETH.lowestAsk = (+data.lowestAsk).toFixed(8)) {
            changed = true;
            status.BTC.ETH.lowestAsk = (+data.lowestAsk).toFixed(8);
            status.ETH.BTC.highestBid = 1/ (+data.lowestAsk).toFixed(8);
        }
    } else if (data.currencyPair === 'BTC_BCH') {
        if (status.BTC.BCH.highestBid = (+data.highestBid).toFixed(8)) {
            changed = true;
            status.BTC.BCH.highestBid = (+data.highestBid).toFixed(8);
            status.BCH.BTC.lowestAsk = 1/ (+data.highestBid).toFixed(8);
        }

        if (status.BTC.BCH.lowestAsk = (+data.lowestAsk).toFixed(8)) {
            changed = true;
            status.BTC.BCH.lowestAsk = (+data.lowestAsk).toFixed(8);
            status.BCH.BTC.highestBid = 1/ (+data.lowestAsk).toFixed(8);
        }
    } else if (data.currencyPair === 'ETH_BCH') {
        if (status.ETH.BCH.highestBid = (+data.highestBid).toFixed(8)) {
            changed = true;
            status.ETH.BCH.highestBid = (+data.highestBid).toFixed(8);
            status.BCH.ETH.lowestAsk = 1/ (+data.highestBid).toFixed(8);
        }

        if (status.ETH.BCH.lowestAsk = (+data.lowestAsk).toFixed(8)) {
            changed = true;
            status.ETH.BCH.lowestAsk = (+data.lowestAsk).toFixed(8);
            status.BCH.ETH.highestBid = 1/ (+data.lowestAsk).toFixed(8);
        }
    }
    if (changed && status.BTC.ETH.highestBid && status.BTC.BCH.highestBid && status.ETH.BCH.highestBid && initialized) {
        emitter.emit('tryTrade');
    }
};

async function updateBalances() {
    const newBal = await queue.push({ flags: ['private_util'] }, () => privatePolo.private_util.returnBalances());
    status.BTC.balance = newBal.BTC;
    status.BCH.balance = newBal.BCH;
    status.ETH.balance = newBal.ETH;
}

const appraisePortfolioIn = (targetCoin, portfolio) => {
    return COINS.reduce((acc, coin) => acc + portfolio[coin] * status[targetCoin][coin].highestBid, 0);
};

const coinListWithExclude = (coin) => {
    return COINS.reduce((acc, val) => {
        if (coin !== val) {
            acc.push(val);
        }
        return acc;
    }, []);
};

const profits = {
    BTC: {
        BTC: { BTC: 0, ETH: 0, BCH: 0 },
        ETH: { BTC: 0, ETH: 0, BCH: 0 },
        BCH: { BTC: 0, ETH: 0, BCH: 0 },
    },
    ETH: {
        BTC: { BTC: 0, ETH: 0, BCH: 0 },
        ETH: { BTC: 0, ETH: 0, BCH: 0 },
        BCH: { BTC: 0, ETH: 0, BCH: 0 },
    },
    BCH: {
        BTC: { BTC: 0, ETH: 0, BCH: 0 },
        ETH: { BTC: 0, ETH: 0, BCH: 0 },
        BCH: { BTC: 0, ETH: 0, BCH: 0 },
    },
};

const checkProfitability = (soldCoin, boughtCoin, valueCoin) => {
    const initialPortfolio = {};
    initialPortfolio[soldCoin] = status[soldCoin].balance;
    initialPortfolio[boughtCoin] = 0;
    initialPortfolio[valueCoin] = 0;

    const initialValue = appraisePortfolioIn(valueCoin, initialPortfolio);

    const finalPortfolio = {};
    finalPortfolio[soldCoin] = 0;
    finalPortfolio[boughtCoin] = initialPortfolio[soldCoin] * status[boughtCoin][soldCoin].highestBid * 0.9975;
    finalPortfolio[valueCoin] = 0;

    const finalValue = appraisePortfolioIn(valueCoin, finalPortfolio);

    if (profits[soldCoin][boughtCoin][valueCoin] !== ((finalValue - initialValue) / initialValue).toFixed(5)) {
        profits[soldCoin][boughtCoin][valueCoin] = ((finalValue - initialValue) / initialValue).toFixed(5);
        Log.info(timestamp(), `Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}, `,
            `% gain: ${((finalValue - initialValue) / initialValue).toFixed(5)}`,
            `Ticker rate: ${tickerData.executions / ((Date.now() - tickerData.startTime) / 1000)}, `,
            `Ticker calls: ${tickerData.executions}`);
        if ((finalValue - initialValue) / initialValue > 0.005) {
            Log.ledger(`\n    Trade found! ${timestamp()}`,
                `\n        Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}`,
                `\n        Initial value: ${initialValue}`,
                `\n        Initial portfolio: `, initialPortfolio,
                `\n        Final value: ${finalValue}`,
                `\n        Final portfolio: `, finalPortfolio,
                `\n        Final % gain: ${((finalValue - initialValue) / initialValue).toFixed(5)}\n`,
                `\n       `, status, '\n');
        }
    }

    return (finalValue - initialValue) / initialValue > 0.005;
};

// Coin specified is the one being sold. The other two are the one being bought, and the one being used to value
const tryTradeForCoin = (soldCoin) => {
    const otherCoins = coinListWithExclude(soldCoin);

    if (checkProfitability(soldCoin, otherCoins[0], otherCoins[1])) {

    } else if (checkProfitability(soldCoin, otherCoins[1], otherCoins[0])) {

    }
};

emitter.on('tryTrade', () => {
    COINS.forEach(tryTradeForCoin);
});

function wait(delay) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), delay);
    });
}

const initialize = async() => {
    Log.console('Initializing');
    await updateBalances();
    await Log.ledger(timestamp(), status, '\n');
    Log.console('Initialized');
    tickerData.startTime = Date.now();
    initialized = true;
};

initialize();
Log.console('Reached EOF');
