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
    BTC: new Poloniex(...config.private_0),
    ETH: new Poloniex(...config.private_1),
    BCH: new Poloniex(...config.private_2),
    private_util: new Poloniex(...config.private_util),
};

const tickerData = {
    startTime: 0,
    executions: 0,
};


const queue = new Queue({
    rate: 6,
    concurrency: 100000,
});
queue.addFlag('private_BTC', { concurrency: 1 });
queue.addFlag('private_ETH', { concurrency: 1 });
queue.addFlag('private_BCH', { concurrency: 1 });
queue.addFlag('private_util', { concurrency: 1 });
queue.addFlag('ticker', { concurrency: 1, interval: 350 });

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


// Permanent rolling ticker
const addTicker = (priority = 5, once = false) => {
    return queue.push({ flags: ['ticker'], priority: priority }, () => {
        return Promise.race([poloniex.returnTicker(), wait(3000)]);
    })
        .then((result) => {
            if (!result) {
                return;
            }
            let changed = false;

            if (status.BTC.ETH.highestBid = +result.BTC_ETH.highestBid) {
                changed = true;
                status.BTC.ETH.highestBid = +result.BTC_ETH.highestBid;
                status.ETH.BTC.lowestAsk = 1/ +result.BTC_ETH.highestBid;
            }

            if (status.BTC.ETH.lowestAsk = +result.BTC_ETH.lowestAsk) {
                changed = true;
                status.BTC.ETH.lowestAsk = +result.BTC_ETH.lowestAsk;
                status.ETH.BTC.highestBid = 1/ +result.BTC_ETH.lowestAsk;
            }

            if (status.BTC.BCH.highestBid = +result.BTC_BCH.highestBid) {
                changed = true;
                status.BTC.BCH.highestBid = +result.BTC_BCH.highestBid;
                status.BCH.BTC.lowestAsk = 1/ +result.BTC_BCH.highestBid;
            }

            if (status.BTC.BCH.lowestAsk = +result.BTC_BCH.lowestAsk) {
                changed = true;
                status.BTC.BCH.lowestAsk = +result.BTC_BCH.lowestAsk;
                status.BCH.BTC.highestBid = 1/ +result.BTC_BCH.lowestAsk;
            }

            if (status.ETH.BCH.highestBid = +result.ETH_BCH.highestBid) {
                changed = true;
                status.ETH.BCH.highestBid = +result.ETH_BCH.highestBid;
                status.BCH.ETH.lowestAsk = 1/ +result.ETH_BCH.highestBid;
            }

            if (status.ETH.BCH.lowestAsk = +result.ETH_BCH.lowestAsk) {
                changed = true;
                status.ETH.BCH.lowestAsk = +result.ETH_BCH.lowestAsk;
                status.BCH.ETH.highestBid = 1/ +result.ETH_BCH.lowestAsk;
            }

            if (changed && !once) {
                emitter.emit('tryTrade');
            }
        })
        .catch((err) => {
            Log.info('Error:', err);
        })
        .then(() => {
            if (!once) {
                tickerData.executions++;
                setImmediate(addTicker);
            }
        });
};

async function updateBalances() {
    const newBal = await queue.push({ flags: ['private_util'] }, () => privatePolo.private_util.returnBalances());
    status.BTC.balance = +newBal.BTC;
    status.BCH.balance = +newBal.BCH;
    status.ETH.balance = +newBal.ETH;
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

const checkProfitability = (soldCoin, boughtCoin, valueCoin, frozenStatus) => {
    const initialPortfolio = {};
    initialPortfolio[soldCoin] = frozenStatus[soldCoin].balance;
    initialPortfolio[boughtCoin] = 0;
    initialPortfolio[valueCoin] = 0;

    const initialValues = {
        soldCoin: appraisePortfolioIn(soldCoin, initialPortfolio),
        boughtCoin: appraisePortfolioIn(boughtCoin, initialPortfolio),
        valueCoin: appraisePortfolioIn(valueCoin, initialPortfolio),
    };

    const finalPortfolio = {};
    finalPortfolio[soldCoin] = 0;
    finalPortfolio[boughtCoin] = initialPortfolio[soldCoin] * frozenStatus[boughtCoin][soldCoin].highestBid * 0.9975;
    finalPortfolio[valueCoin] = 0;

    const finalValues = {
        soldCoin: appraisePortfolioIn(soldCoin, finalPortfolio),
        boughtCoin: appraisePortfolioIn(boughtCoin, finalPortfolio),
        valueCoin: appraisePortfolioIn(valueCoin, finalPortfolio),
    };

    const percentChanges = {
        soldCoin: (100 * (finalValues.soldCoin - initialValues.soldCoin) / initialValues.soldCoin),
        boughtCoin: (100 * (finalValues.boughtCoin - initialValues.boughtCoin) / initialValues.boughtCoin),
        valueCoin: (100 * (finalValues.valueCoin - initialValues.valueCoin) / initialValues.valueCoin),
    };
    const percentChangeSum = percentChanges.soldCoin + percentChanges.boughtCoin + percentChanges.valueCoin;

    if (profits[soldCoin][boughtCoin][valueCoin] !== percentChangeSum.toFixed(3)) {
        profits[soldCoin][boughtCoin][valueCoin] = percentChangeSum.toFixed(3);

        if (percentChanges.valueCoin > 0.5) {
            Log.info('Old trigger reached!');
        }

        Log.info(timestamp(), `Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}, `,
            `% gain: ${percentChanges.soldCoin.toFixed(3)}, ${percentChanges.boughtCoin.toFixed(3)}, ${percentChanges.valueCoin.toFixed(3)}, `,
            `Sum: ${percentChangeSum.toFixed(3)}, `,
            `Trades: ${tradeCount}`);
        if (percentChangeSum > 0.2) {
            Log.info(`\n    Trade found! ${timestamp()}`,
                `\n        Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}`,
                `\n        Initial value: ${initialValues.valueCoin}`,
                `\n        Initial portfolio: `, initialPortfolio,
                `\n        Final value: ${finalValues.valueCoin}`,
                `\n        Final portfolio: `, finalPortfolio,
                `\n        Final % gain soldCoin   ${soldCoin}: ${percentChanges.soldCoin.toFixed(3)}`,
                `\n        Final % gain boughtCoin ${boughtCoin}: ${percentChanges.boughtCoin.toFixed(3)}`,
                `\n        Final % gain valueCoin  ${valueCoin}: ${percentChanges.valueCoin.toFixed(3)}`,
                `\n        Final % gain total         : ${percentChangeSum.toFixed(3)}`,
                `\n\n       `, frozenStatus, '\n');
        }
    }

    // Check balance of the traded currency is high enough
    if (soldCoin === 'BTC') {
        if (status.BTC.balance < 0.00012) {
            //Log.info(`${timestamp()} Can't trade: Not enough BTC (have ${status.BTC.balance})`);
            return false;
        }
    } else if (boughtCoin === 'BTC') {
        if (status[soldCoin].balance * status.BTC[soldCoin].highestBid < 0.00012) {
            //Log.info(`${timestamp()} Can't trade: Not enough ${soldCoin} (have ${status[soldCoin].balance}`,
            //    `[worth ${status[soldCoin].balance * frozenStatus.ETH[soldCoin].highestBid} BTC])`);
            return false;
        }
    } else if (soldCoin === 'ETH') {
        if (status.ETH.balance < 0.00012) {
            //Log.info(`${timestamp()} Can't trade: Not enough ETH (have ${status.BTC.balance})`);
            return false;
        }
    } else if (boughtCoin === 'ETH') {
        if (status.BCH.balance * status.ETH.BCH.highestBid < 0.00012) {
            //Log.info(`${timestamp()} Can't trade: Not enough BCH (have ${status.BCH.balance}`,
            //    `[worth ${status.BCH.balance * frozenStatus.ETH.BCH.highestBid} ETH])`);
            return false;
        }
    }

    if (status[soldCoin].busy) {
        //Log.info(`${timestamp()} Can't make trade: ${soldCoin} is busy`);
        return false;
    }

    return percentChangeSum > 0.2;
};

const makeTrade = async(soldCoin, boughtCoin, frozenStatus) => {
    const rate = frozenStatus[soldCoin][boughtCoin].lowestAsk;
    status[soldCoin].busy = true;
    const polo = privatePolo[soldCoin];

    return queue.push({ flags: [`private_${soldCoin}`], priority: 11 }, () => {
        Log.ledger(`\nMaking trade:`, timestamp(),
            `\n    Selling: ${soldCoin}, `,
            `\n    Buying:  ${boughtCoin}, `,
            `\n    Amount:  ${frozenStatus[soldCoin].balance}`,
            `\n    Rate:    ${rate}`,
            `\n    Projected final amount: ${frozenStatus[boughtCoin].balance + (0.9975 * frozenStatus[soldCoin].balance / rate)}`,
            `\n\n   `, frozenStatus);

        if (soldCoin === 'BTC' || (soldCoin === 'ETH' && boughtCoin !== 'BTC')) {
            return polo.buy(`${soldCoin}_${boughtCoin}`, rate, 0.99999*frozenStatus[soldCoin].balance/rate, 0, 1, 0);
        } else {
            return polo.sell(`${boughtCoin}_${soldCoin}`, 1/rate, 0.99999*frozenStatus[soldCoin].balance, 0, 1, 0);
        }
    });
};

let tradeCount = 0;

// Coin specified is the one being sold. The other two are the one being bought, and the one being used to value
const tryTradeForCoin = async(soldCoin) => {
    const otherCoins = coinListWithExclude(soldCoin);
    const frozenStatus = JSON.parse(JSON.stringify(status));
    let boughtCoin = '';

    if (checkProfitability(soldCoin, otherCoins[0], otherCoins[1], frozenStatus)) {
        boughtCoin = otherCoins[0]
    } else if (checkProfitability(soldCoin, otherCoins[1], otherCoins[0], frozenStatus)) {
        boughtCoin = otherCoins[1]
    }

    if (!boughtCoin) {
        return;
    }
    const valueCoin = COINS.reduce((acc, val) => {
        return (val === soldCoin || val === boughtCoin) ? acc : val;
    }, '');

    try {
        const tradeResult = await makeTrade(soldCoin, boughtCoin, frozenStatus);
        await Log.ledger(`\n${timestamp()}    Trade #${tradeCount} Executed:`, tradeResult);
        await updateBalances();
        await Log.ledger(`\n${timestamp()}    Balances Updated:`);

        const initialPortfolio = {};
        initialPortfolio[soldCoin] = frozenStatus[soldCoin].balance;
        initialPortfolio[boughtCoin] = frozenStatus[boughtCoin].balance;
        initialPortfolio[valueCoin] = frozenStatus[valueCoin].balance;

        const initialValues = {
            soldCoin: appraisePortfolioIn(soldCoin, initialPortfolio),
            boughtCoin: appraisePortfolioIn(boughtCoin, initialPortfolio),
            valueCoin: appraisePortfolioIn(valueCoin, initialPortfolio),
        };

        const finalPortfolio = {};
        finalPortfolio[soldCoin] = status[soldCoin].balance;
        finalPortfolio[boughtCoin] = status[boughtCoin].balance;
        finalPortfolio[valueCoin] = status[valueCoin].balance;

        const finalValues = {
            soldCoin: appraisePortfolioIn(soldCoin, finalPortfolio),
            boughtCoin: appraisePortfolioIn(boughtCoin, finalPortfolio),
            valueCoin: appraisePortfolioIn(valueCoin, finalPortfolio),
        };

        const percentChanges = {
            soldCoin: (100 * (finalValues.soldCoin - initialValues.soldCoin) / initialValues.soldCoin),
            boughtCoin: (100 * (finalValues.boughtCoin - initialValues.boughtCoin) / initialValues.boughtCoin),
            valueCoin: (100 * (finalValues.valueCoin - initialValues.valueCoin) / initialValues.valueCoin),
        };
        const percentChangeSum = percentChanges.soldCoin + percentChanges.boughtCoin + percentChanges.valueCoin;

        await Log.ledger(`\nTrade completed: ${timestamp()}`,
            `\n    Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}`,
            `\n    Initial value: ${initialValues.valueCoin}`,
            `\n    Initial portfolio: `, initialPortfolio,
            `\n    Final value:   ${finalValues.valueCoin}`,
            `\n    Final portfolio:   `, finalPortfolio,
            `\n    Final % gain soldCoin   ${soldCoin}: ${percentChanges.soldCoin.toFixed(3)}`,
            `\n    Final % gain boughtCoin ${boughtCoin}: ${percentChanges.boughtCoin.toFixed(3)}`,
            `\n    Final % gain valueCoin  ${valueCoin}: ${percentChanges.valueCoin.toFixed(3)}`,
            `\n    Final % gain total         : ${percentChangeSum.toFixed(3)}`,
            `\n\n   `, status, '\n\n');

        tradeCount++;
        if (tradeCount > 6) {
            await Log.ledger(`\nExecuted trade #${tradeCount}. Quitting.`);
            process.exit(1);
        }

    } catch (err) {
        await Log.info('Order placement failed', err);
        if (err.code !== 'ESOCKETTIMEDOUT') {
            process.exit(1);
        }
    }
    status[soldCoin].busy = false;
    emitter.emit('tryTrade');
};

emitter.on('tryTrade', () => {
    COINS.forEach(tryTradeForCoin);
});

function wait(delay) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(false), delay);
    });
}

const initialize = async() => {
    Log.console('Initializing');
    await Log.ledger('\n');
    await wait(1000);
    await updateBalances();
    await addTicker(5, true);
    await Log.ledger(timestamp(), status);
    Log.console('Initialized');
    tickerData.startTime = Date.now();
    addTicker();
    addTicker();
};

initialize();
