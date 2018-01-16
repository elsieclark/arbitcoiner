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

let tradeCount = 0;

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

const appraisePortfolioIn = (targetCoin, targetPortfolio) => {
    let portfolio = targetPortfolio;
    if (!targetPortfolio) {
        portfolio = {
            BTC: status.BTC.balance,
            ETH: status.ETH.balance,
            BCH: status.BCH.balance,
        };
    }
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

const createValueList = (portfolio, soldCoin, boughtCoin, valueCoin) => {
    return {
        soldCoin: appraisePortfolioIn(soldCoin, portfolio),
        boughtCoin: appraisePortfolioIn(boughtCoin, portfolio),
        valueCoin: appraisePortfolioIn(valueCoin, portfolio),
    };
};

const createPercentChangeList = (listA, listB) => {
    const changes = {
        soldCoin: 100 * (listB.soldCoin - listA.soldCoin) / listA.soldCoin,
        boughtCoin: 100 * (listB.boughtCoin - listA.boughtCoin) / listA.boughtCoin,
        valueCoin: 100 * (listB.valueCoin - listA.valueCoin) / listA.valueCoin,
    };
    changes.sum = changes.soldCoin + changes.boughtCoin + changes.valueCoin;
    return changes;
};

const formatPercent = (input) => {
    return `    ${input.toFixed(3)}`.slice(-6);
};

const printUpdateMessage = (percentChanges, soldCoin, boughtCoin, valueCoin) => {
    return Log.info(timestamp(),
        `Sell: ${soldCoin}, Buy: ${boughtCoin}, Value: ${valueCoin}`,
        `% gains:`,
        `${formatPercent(percentChanges.soldCoin)},`,
        `${formatPercent(percentChanges.boughtCoin)},`,
        `${formatPercent(percentChanges.valueCoin)},`,
        `Sum: ${formatPercent(percentChanges.sum)},`,
        `Trades: ${tradeCount},`,
        `Balances:`,
        `{ BTC: ${status.BTC.balance.toFixed(8)},`,
        `ETH: ${status.ETH.balance.toFixed(8)},`,
        `BCH: ${status.BCH.balance.toFixed(8)} }`,
        `Ticker count: ${tickerData.executions}`);
};

const printTradeMessage = ({ percentChanges, soldCoin, boughtCoin, valueCoin, initialValues, initialPortfolio,
                               finalValues, finalPortfolio, statusSnapshot, msg,  printType = 'info' }) => {
    return Log[printType](`\n${msg}: ${timestamp()}`,
        `\n    Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}`,
        `\n    Initial value: ${initialValues.valueCoin}`,
        `\n    Initial portfolio: `, initialPortfolio,
        `\n    Final value:   ${finalValues.valueCoin}`,
        `\n    Final portfolio:   `, finalPortfolio,
        `\n    Final % gain soldCoin   ${soldCoin}: ${formatPercent(percentChanges.soldCoin)}`,
        `\n    Final % gain boughtCoin ${boughtCoin}: ${formatPercent(percentChanges.boughtCoin)}`,
        `\n    Final % gain valueCoin  ${valueCoin}: ${formatPercent(percentChanges.valueCoin)}`,
        `\n    Final % gain total         : ${formatPercent(percentChanges.sum)}`,
        `\n\n   `, statusSnapshot, '\n');

};

const checkProfitability = (soldCoin, boughtCoin, valueCoin, frozenStatus) => {
    const initialPortfolio = { BTC: 0, ETH: 0, BCH: 0 };
    initialPortfolio[soldCoin] = frozenStatus[soldCoin].balance;
    const initialValues = createValueList(initialPortfolio, soldCoin, boughtCoin, valueCoin);

    const finalPortfolio = { BTC: 0, ETH: 0, BCH: 0 };
    finalPortfolio[boughtCoin] = initialPortfolio[soldCoin] * frozenStatus[boughtCoin][soldCoin].highestBid * 0.9975;
    const finalValues = createValueList(finalPortfolio, soldCoin, boughtCoin, valueCoin);

    const percentChanges = createPercentChangeList(initialValues, finalValues);


    // A new value has been calculated
    if (profits[soldCoin][boughtCoin][valueCoin] !== percentChanges.sum.toFixed(3)) {
        profits[soldCoin][boughtCoin][valueCoin] = percentChanges.sum.toFixed(3);

        if (percentChanges.sum > -0.3) {
            printUpdateMessage(percentChanges, soldCoin, boughtCoin, valueCoin);
        }

        if (percentChanges.sum > 0.02) {
            printTradeMessage({
                percentChanges,
                soldCoin, boughtCoin, valueCoin,
                initialValues, initialPortfolio,
                finalValues, finalPortfolio,
                statusSnapshot: frozenStatus, msg: 'Trade found', printType: 'info',
            });
        }
    }

    return percentChanges.sum;
};

const makeTrade = async(soldCoin, boughtCoin, frozenStatus, rawFraction) => {
    const fraction = rawFraction * 0.99999;
    const rate = frozenStatus[soldCoin][boughtCoin].lowestAsk;
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
            return polo.buy(`${soldCoin}_${boughtCoin}`, rate, fraction * frozenStatus[soldCoin].balance/rate, 0, 1, 0);
        } else {
            return polo.sell(`${boughtCoin}_${soldCoin}`, 1/rate, fraction * frozenStatus[soldCoin].balance, 0, 1, 0);
        }
    });
};

const isEnoughToTrade = (soldCoin, boughtCoin, frozenStatus, fraction) => {
    // Check balance of the traded currency is high enough
    if (soldCoin === 'BTC') {
        if (frozenStatus.BTC.balance * fraction < 0.00012) {
            return false;
        }
    } else if (boughtCoin === 'BTC') {
        if (frozenStatus[soldCoin].balance * fraction * frozenStatus.BTC[soldCoin].highestBid < 0.00012) {
            return false;
        }
    } else if (soldCoin === 'ETH') {
        if (frozenStatus.ETH.balance * fraction < 0.00012) {
            return false;
        }
    } else if (boughtCoin === 'ETH') {
        if (frozenStatus.BCH.balance * fraction * frozenStatus.ETH.BCH.highestBid < 0.00012) {
            return false;
        }
    }
    return true
};

const commitToTrade = async (soldCoin, boughtCoin, frozenStatus, fraction = 1) => {
    const valueCoin = COINS.reduce((acc, val) => {
        return (val === soldCoin || val === boughtCoin) ? acc : val;
    }, '');

    // Check if balance is high enough
    if (!isEnoughToTrade(soldCoin, boughtCoin, frozenStatus, fraction)) {
        return;
    }

    if (status[soldCoin].busy) {
        return;
    }

    try {
        status[soldCoin].busy = true;
        const tradeResult = await makeTrade(soldCoin, boughtCoin, frozenStatus, fraction);
        await Log.ledger(`\n${timestamp()}    Trade #${tradeCount} Executed:`, tradeResult);
        await updateBalances();
        await Log.ledger(`\n${timestamp()}    Balances Updated:`);

        const initialPortfolio = {
            BTC: frozenStatus.BTC.balance,
            ETH: frozenStatus.ETH.balance,
            BCH: frozenStatus.BCH.balance,
        };
        const finalPortfolio = {
            BTC: status.BTC.balance,
            ETH: status.ETH.balance,
            BCH: status.BCH.balance,
        };

        const initialValues = createValueList(initialPortfolio, soldCoin, boughtCoin, valueCoin);
        const finalValues = createValueList(finalPortfolio, soldCoin, boughtCoin, valueCoin);
        const percentChanges = createPercentChangeList(initialValues, finalValues);

        await printTradeMessage({
            percentChanges,
            soldCoin, boughtCoin, valueCoin,
            initialValues, initialPortfolio,
            finalValues, finalPortfolio,
            statusSnapshot: status, msg: 'Trade completed', printType: 'ledger',
        });

        tradeCount++;
    } catch (err) {
        await Log.info('Order placement failed', err);
        if (err.code !== 'ESOCKETTIMEDOUT') {
            process.exit(1);
        }
    }
    status[soldCoin].busy = false;
    emitter.emit('tryTrade');
};

// Coin specified is the one being sold. The other two are the one being bought, and the one being used to value
const tryTradeForCoin = async(soldCoin) => {
    const otherCoins = coinListWithExclude(soldCoin);
    const frozenStatus = JSON.parse(JSON.stringify(status));
    let boughtCoin = '';

    const profitability = [
        checkProfitability(soldCoin, otherCoins[0], otherCoins[1], frozenStatus),
        checkProfitability(soldCoin, otherCoins[1], otherCoins[0], frozenStatus),
    ];

    profitability.forEach((val, i) => {
        if (val > 0.2) {
            boughtCoin = otherCoins[i];
            return commitToTrade(soldCoin, otherCoins[i], frozenStatus, 1);
        } else if (val > 0.02) {
            const totalValue = appraisePortfolioIn(soldCoin);
            const soldCoinFraction = status[soldCoin].balance / totalValue;
            const boughtCoinFraction = status[otherCoins[i]].balance *
                status[soldCoin][otherCoins[i]].highestBid / totalValue;
            if (soldCoinFraction > 0.6 && boughtCoinFraction < 0.2) {
                const fractionToTrade = Math.min(soldCoinFraction - boughtCoinFraction / 2, 1/3);
                return commitToTrade(soldCoin, otherCoins[i], frozenStatus, fractionToTrade);
            }
        }
    });
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
