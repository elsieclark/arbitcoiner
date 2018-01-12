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
queue.addFlag('ticker', { concurrency: 3, interval: 400 });


const status = {
    BTC: {
        balance: 0,
        busy: false,
        ETH: { lowestAsk: 0, highestBid: 0 },
        BCH: { lowestAsk: 0, highestBid: 0 },
    },
    ETH: {
        balance: 0,
        busy: false,
        BTC: { lowestAsk: 0, highestBid: 0 },
        BCH: { lowestAsk: 0, highestBid: 0 },
    },
    BCH: {
        balance: 0,
        busy: false,
        BTC: { lowestAsk: 0, highestBid: 0 },
        ETH: { lowestAsk: 0, highestBid: 0 },
    },
};


const timestamp = () => {
    const time = new Date();
    return time.toString();
};


// Permanent rolling ticker
const addTicker = (priority = 5, once = false) => {
    console.log('Adding ticker');
    return queue.push({ flags: ['ticker'], priority: priority }, () => { return poloniex.returnTicker(); })
        .then((result) => {
            let changed = false;

            console.log('Ticker occurred', typeof result.BTC_ETH.highestBid, result.BTC_ETH.highestBid);

            if (result.BTC_ETH.highestBid !== status.BTC.ETH.highestBid) {
                changed = true;
                status.BTC.ETH.highestBid = result.BTC_ETH.highestBid;
                status.ETH.BTC.lowestAsk = 1/ result.BTC_ETH.highestBid;
            }

            if (changed) {
                //Log.info(Date.now() + ' ' + JSON.stringify(prices));
                emitter.emit('tryTrade');
            }
        })
        .catch((err) => {
            Log.info('Error:', err);
        })
        .then(() => {
            if (!once) {
                setImmediate(addTicker);
            }
        });
};
addTicker();
console.log('Reached EOF');

/*
const profitableCW = () => {
    Log.info(`\n${timestamp()}`);
    Log.info('CW:', ((1 / prices.BTC_ETH.lowestAsk) / prices.ETH_BCH.lowestAsk) * prices.BTC_BCH.highestBid);
    return (((1 / prices.BTC_ETH.lowestAsk) / prices.ETH_BCH.lowestAsk) * prices.BTC_BCH.highestBid) > 1.008;
};

const profitableCCW = () => {
    Log.info('CCW:', (1 / prices.BTC_BCH.lowestAsk) * prices.ETH_BCH.highestBid * prices.BTC_ETH.highestBid);
    return ((1 / prices.BTC_BCH.lowestAsk) * prices.ETH_BCH.highestBid * prices.BTC_ETH.highestBid) > 1.008;
};

async function executeTrade({ pair, isForwards, poloName, price, amount}) {
    const polo = privatePolo[poloName];
    Log.ledger(`Pushing trade #${tradeCount.total + 1}: ${isForwards ? 'buy' : 'sell'} ${pair}. Price: ${price}, Amount: ${amount}`);
    if (isForwards) {
        return await queue.push({ flags: [poloName], priority: 11 }, () => {
            Log.info(`Actually executing ${pair} buy`);
            return polo.buy(pair, price, amount, false, false, false);
        });
    } else {
        return await queue.push({ flags: [poloName], priority: 11 }, () => {
            Log.info(`Actually executing ${pair} sell`);
            return polo.sell(pair, price, amount, false, false, false);
        });
    }
}

async function tradesCompleted(orderIds) {
    // Get all outstanding orders, and flatten the array
    const ordersByCurrency = await queue.push({ flags: ['private_util'] }, () =>
        privatePolo.private_util.returnOpenOrders('all'));
    const currentOrders = Object.values(ordersByCurrency).reduce((acc, val) => acc.concat(val), []);
    Log.info('Outstanding trades:', currentOrders, orderIds);

    // Compare the two arrays, check for overlaps
    const areCompleted = currentOrders.every((trade) => !orderIds.includes(trade.orderNumber));
    return areCompleted;
}

let tempTradeCounter = 0;
async function finishTriangle() {
    const tradeNumber = ++tradeCount.total;
    const d = new Date();
    await updateBalances();
    tradeInProgress = false;
    emitter.emit('tryTrade');
    await addTicker(10);
    await Log.ledger(`\nAfter trade #${tradeNumber}:`,
        `\n    Time:     ${d.toString()}`,
        '\n    Prices:   ', prices,
        '\n    Balances: ', balances,
        '\n    Record:   ', tradeCount, '\n');
    if (tempTradeCounter++ === 4) {
        await Log.info('Shutting down');
        process.exit(1);
    }
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
        trade.amount = 0.999 * (trade.isForwards ? balances[trade.pair.split('_')[0]] / prices[trade.pair].lowestAsk :
            balances[trade.pair.split('_')[1]]);
    });
}

async function cancelTrade(orderNumber) {
    let cancelSuccessful;
    try {
        cancelSuccessful = await privatePolo.private_util.cancelOrder(orderNumber);
    } catch (e) {
        return false;
    }
    Log.info(`Cancelled order ${orderNumber}. Details:`, cancelSuccessful);
    return cancelSuccessful.success === 1;
}

async function executeTriangle(isCW) {
    tradeInProgress = true;
    Log.ledger(`\nMaking ${isCW ? 'clockwise' : 'counter-clockwise'} trade (trade #${tradeCount.total + 1})`,
        `\n    Time:     ${timestamp()}`,
        '\n    Prices:   ', prices,
        '\n    Balances: ', balances, '\n');

    const triDetails = [
        { pair: 'BTC_ETH', isForwards: isCW, poloName: 'private_0' },
        { pair: 'BTC_BCH', isForwards: !isCW, poloName: 'private_1' },
        { pair: 'ETH_BCH', isForwards: isCW, poloName: 'private_2' },
    ];
    calculateTrade(triDetails);
    Log.info('Calculating triangle details', triDetails);

    let orders;
    try {
        orders = await Promise.all([
            executeTrade(triDetails[2]),
            executeTrade(triDetails[1]),
            executeTrade(triDetails[0]),
        ]);
    } catch (err) {
        await Log.info('Order placement failed', err);
        process.exit(1);
    }
    let orderNumbers = orders.map((order) => order.orderNumber);
    const startTime = Date.now();

    Log.info('\nTrades made with IDs:', orders, orderNumbers);

    // Check if trades are filled immediately
    const tradesFilled = orders.reduce((acc, order, i) => {
        if (!acc) {
            return acc;
        }
        const filledSum = order.resultingTrades.reduce((acc, trade) => acc + trade.amount, 0);
        console.log(`Checking ${triDetails[i].pair}`, triDetails[i].amount,
            filledSum, Math.abs(triDetails[i].amount - filledSum) < 0.00000001);
        return Math.abs(triDetails[i].amount - filledSum) < 0.00000001;
    }, true);

    if (tradesFilled) {
        Log.ledger(`Trade immediately successful after ${(Date.now() - startTime)/1000}s`);
        tradeCount.successful++;
        await finishTriangle();
        return;
    }

    while (Date.now() - startTime < 20000) {
        let tradesComplete = false;
        try {
            tradesComplete = await tradesCompleted(orderNumbers);
        } catch (e) {
            await Log.info('Error checking if trades completed', e);
        }
        if (tradesComplete) {
            Log.ledger(`Trade successful after ${(Date.now() - startTime)/1000}s`);
            tradeCount.successful++;
            await finishTriangle();
            return;
        }
        await wait(2000);
    }

    Log.info('Trade did not pass after 20s. Attempting auxiliary trades.', timestamp());

    let failureCount = 1;
    while (!await tradesCompleted(orderNumbers)) {
        Log.ledger(`Trade failed. Count: ${failureCount++}. Time: ${timestamp()}`);
        // Cancel outstanding trades
        const cancelled = [];
        cancelled[0] = await cancelTrade(orderNumbers[0]);
        cancelled[1] = await cancelTrade(orderNumbers[1]);
        cancelled[2] = await cancelTrade(orderNumbers[2]);

        if (!cancelled[0] && !cancelled[1] && !cancelled[2]) {
            break;
        }

        Log.info('Trade has not completed, but trades have been cancelled', cancelled);

        // Try again at the new price
        await addTicker(10, true);

        Log.info('Ticker has been updated once');

        for (let j = 0; j < orderNumbers.length; j++) {
            if (!cancelled[j]) {
                continue;
            }
            calculateTrade([triDetails[j]]);
            await Log.ledger(`Trying new makeup trade: `, triDetails[j]);
            orders[j] = await executeTrade(triDetails[j]);
            orderNumbers[j] = orders[j].orderNumber;
        }

        await wait(10000);
        Log.info('Waited 10s', timestamp());
    }

    Log.ledger(`Trade failed after ${(Date.now() - startTime)/1000}s`);
    tradeCount.unsuccessful++;
    await finishTriangle();
}

emitter.on('tryTrade', () => {
    if (tradeInProgress) {
        return;
    }
    //const time = new Date();
    //Log.info(time.toString(), 'Checking for triangular trade');
    try {
        if (profitableCW()) {
            Log.ledger('Detected clockwise trade');
            return executeTriangle(true);
        } else if (profitableCCW()) {
            Log.ledger('Detected counter-clockwise trade');
            return executeTriangle(false);
        }
    } catch (err) {
        Log.info('Attempting trade error', err);
    }
});

async function initialize() {
    await updateBalances();
    await addTicker(10, true);
    await Log.ledger(`Initializing trader`,
        `\n    Time:     ${timestamp()}`,
        '\n    Prices:   ', prices,
        '\n    Balances: ', balances, '\n');
    tradeInProgress = false;
    addTicker();
}

initialize();
*/