"use strict";
const appRoot  = require('app-root-path');
const events   = require('events');
const Logger   = require(appRoot + '/utils/logger.js');
const Poloniex = require('poloniex-api-node');
const Queue    = require('superqueue');

const config   = require(appRoot + '/config/local.config.json');

const Log = Logger('trader_01', appRoot + '/data/logs/ledger', appRoot + '/data/logs/info');
const emitter = new events.EventEmitter();
const poloniex = new Poloniex();
const privatePolo = {
    private_0: new Poloniex(...config.private_0),
    private_1: new Poloniex(...config.private_1),
    private_2: new Poloniex(...config.private_2),
    private_util: new Poloniex(...config.private_util),
};

const tradeCount = {
    total: 0,
    successful: 0,
    unsuccessful: 0,
};

const queue = new Queue({
    rate: 6,
    concurrency: 100000,
});
queue.addFlag('private_0', { concurrency: 1 });
queue.addFlag('private_1', { concurrency: 1 });
queue.addFlag('private_2', { concurrency: 1 });
queue.addFlag('private_util', { concurrency: 1 });
queue.addFlag('ticker', { concurrency: 100000, interval: 350 });
queue.addFlag('ticker', { concurrency: 100000, interval: 350 });

const prices = { BTC_ETH: {}, BTC_BCH: {}, ETH_BCH: {} };
const balances = { BTC: 0, ETH: 0, BCH: 0 };

let tradeInProgress = false;


// Permanent rolling ticker
const addTicker = (priority, once) => {
    if (tradeInProgress) {
        return;
    }
    return queue.push({ flags: ['ticker'], priority: priority || 5 }, () => { return poloniex.returnTicker(); })
        .then((result) => {
            console.log('Started')
            let changed = false;
            if (JSON.stringify(prices.BTC_ETH) !== JSON.stringify(result.BTC_ETH)) {
                prices.BTC_ETH = {
                    highestBid: result.BTC_ETH.highestBid,
                    lowestAsk: result.BTC_ETH.lowestAsk,
                };
                console.log('Alpha', prices.BTC_ETH)
                changed = true;
            }
            if (JSON.stringify(prices.BTC_BCH) !== JSON.stringify(result.BTC_BCH)) {
                prices.BTC_BCH = {
                    highestBid: result.BTC_BCH.highestBid,
                    lowestAsk: result.BTC_BCH.lowestAsk,
                };
                console.log('Beta', prices.BTC_BCH)
                changed = true;
            }
            if (JSON.stringify(prices.ETH_BCH) !== JSON.stringify(result.ETH_BCH)) {
                prices.ETH_BCH = {
                    highestBid: result.ETH_BCH.highestBid,
                    lowestAsk: result.ETH_BCH.lowestAsk,
                };
                console.log('Gamma', prices.ETH_BCH)
                changed = true;
            }
            if (changed) {
                console.log('Delta')
                //Log.info(Date.now() + ' ' + JSON.stringify(prices));
                emitter.emit('tryTrade');
            }
        })
        .catch((err) => {
            console.error('Error:', err);
        })
        .then(() => {
            if (!once) {
                setImmediate(addTicker);
            }
        });
};

const profitableCW = () => {
    return (((1 / prices.BTC_ETH.lowestAsk) / prices.ETH_BCH.lowestAsk) * prices.BTC_BCH.highestBid) > 1.008;
};

const profitableCCW = () => {
    return ((1 / prices.BTC_BCH.lowestAsk) * prices.ETH_BCH.highestBid * prices.BTC_ETH.highestBid) > 1.008;
};

async function executeTrade({ pair, isForwards, poloName, price, amount }) {
    const polo = privatePolo[poloName];
    if (isForwards) {
        return await queue.push({ flags: [poloName], priority: 11 }, () => {
            return polo.buy(pair, price, amount, false, false, false);
        });
    } else {
        return await queue.push({ flags: [poloName], priority: 11 }, () => {
            return polo.sell(pair, price, amount, false, false, false);
        });
    }
}

async function tradesCompleted(orderIds) {
    const currentOrders = await queue.push({ flags: ['private_util'] }, () =>
        privatePolo.private_util.returnOpenOrders('all'));
    return currentOrders.every((trade) => !orderIds.includes(trade.orderNumber));
}

async function finishTriangle() {
    tradeCount.total++;
    await updateBalances();
    await addTicker(10);
    tradeInProgress = false;
    emitter.emit('tryTrade');
    Log.info(`After trade:`,
        `\n    Time:     ${Date.now().toString()}`,
        '\n    Prices:   ', prices,
        '\n    Balances: ', balances,
        '\n    Record:   ', tradeCount);
    Log.info('Shutting down');
    process.exit(1);
}

async function updateBalances() {
    const newBal = await queue.push({ flags: ['private_util'] }, () => privatePolo.private_util.returnBalances());
    balances.BTC = newBal.BTC;
    balances.BCH = newBal.BCH;
    balances.ETH = newBal.ETH;
}

function wait(delay) {
    return new Promise((resolve, reject) => {
        setTimeout(() => resolve(), delay);
    });
}

function calculateTrade(triDetails) {
    triDetails.forEach((trade) => {
        trade.price = trade.isForwards ? prices[trade.pair].lowestAsk : prices[trade.pair].highestBid;
        trade.amount = 0.99 * (trade.isForwards ? balances[trade.pair.split('-')[0]] * prices[trade.pair].lowestAsk :
            balances[trade.pair.split('-')[1]]);
    });
}

async function cancelTrade(orderNumber) {
    const cancelSuccessful = await privatePolo.private_util.cancelOrder(orderNumber);
    Log.info(`Cancelled order ${orderNumber}. Details:`, cancelSuccessful);
    return cancelSuccessful.success === 1;
}

async function executeTriangle(isCW) {
    tradeInProgress = true;
    Log.info(`\nMaking ${isCW ? 'clockwise' : 'counter-clockwise'} trade (trade #${tradeCount.total + 1})`,
        `\n    Time:     ${Date.now().toString()}`,
        '\n    Prices:   ', prices,
        '\n    Balances: ', balances);

    const triDetails = [
        { pair: 'BTC_ETH', isForwards: isCW, poloName: 'private_0' },
        { pair: 'BTC_BCH', isForwards: !isCW, poloName: 'private_1' },
        { pair: 'ETH_BCH', isForwards: isCW, poloName: 'private_2' },
    ];
    calculateTrade(triDetails);

    let orderNumbers = await Promise.all([
        executeTrade(triDetails[0]),
        executeTrade(triDetails[1]),
        executeTrade(triDetails[2]),
    ]);
    const startTime = Date.now();

    while (Date.now() - startTime < 10000) {
        if (await tradesCompleted(orderNumbers)) {
            Log.info(`Trade successful after ${(Date.now() - startTime)/1000}s`);
            tradeCount.successful++;
            await finishTriangle();
            return;
        }
    }

    let failureCount = 1;
    while (!await tradesCompleted(orderNumbers)) {
        Log.info(`Trade failed. Count: ${failureCount++}. Time: ${Date.now().toString()}`);
        // Cancel outstanding trades
        const cancelled = await Promise.all(orderNumbers.map((orderNumber) => cancelTrade(orderNumber)));
        if (cancelled.every((order) => !order)) {
            break;
        }

        // Try again at the new price
        await addTicker(10, true);
        orderNumbers = orderNumbers.map(async(orderNumber, i) => {
            if (!cancelled[i]) {
                return orderNumber;
            }
            calculateTrade([triDetails[i]]);
            Log.info(`Trying new makeup trade: `, triDetails[i]);
            return await executeTrade(triDetails[i]);
        });

        await wait(10000);
    }
    // Uh-oh. Everything's gone wrong. Fix it here.

    Log.info(`Trade failed after ${(Date.now() - startTime)/1000}s`);
    tradeCount.unsuccessful++;
    await finishTriangle();
}

emitter.on('tryTrade', () => {
    if (tradeInProgress) {
        return;
    }
    if (profitableCW()) {
        return executeTriangle(true);
    } else if (profitableCCW()) {
        return executeTriangle(false);
    }
});

async function initialize() {
    await updateBalances();
    await addTicker(10, true);
    Log.info(`Initializing trader`,
        `\n    Time:     ${Date.now().toString()}`,
        '\n    Prices:   ', prices,
        '\n    Balances: ', balances, '\n');
    addTicker();
}

initialize();




















