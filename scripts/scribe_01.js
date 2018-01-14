"use strict";
process.env.UV_THREADPOOL_SIZE = 128;
const appRoot  = require('app-root-path');
const fs       = require('fs');
const Poloniex = require('poloniex-api-node');
const Queue    = require('superqueue');

const MARKETS = ['BTC_ETH', 'BTC_BCH', 'ETH_BCH'];
const ROOTDIR = appRoot + '/data/scribe';
let lastDate = '';

const poloniex = new Poloniex();
const queuePolo = new Queue({ interval: 200, concurrency: 3 });
const queueFile = new Queue();
const queueLogs = new Queue();

let tickerStats = {
    startTime: Date.now(),
    totalCalls: 0,
    misses: 0,
    latencies: {},
};

async function fileExists(fileName) {
    return new Promise((resolve) => { fs.stat(fileName, (err) => { resolve(!err); }) });
}

function mkdir(path) {
    return new Promise((resolve) => { fs.mkdir(path, () => { resolve(); }) });
}

function appendFile(path, data) {
    return new Promise((resolve, reject) => { fs.appendFile(path, data, (e) => { if (e) reject(e); resolve(); }) });
}

function wait(delay) {
    return new Promise((resolve) => { setTimeout(() => resolve(false), delay); });
}

function log(data) {
    return queueLogs.push(() => {
        console.log(data);
        return appendFile(`${ROOTDIR}/logging.txt`, '\n' + data);
    });
}

function calcTickerRate() {
    return (tickerStats.totalCalls / ((Date.now() - tickerStats.startTime)/1000)).toFixed(5);
}

function calcTickerPercentile(percentile) {
    const times = Object.keys(tickerStats.latencies).sort((a,b) => a-b);
    let index = Math.floor(tickerStats.totalCalls * percentile / 100);
    let found = false;
    return times.reduce((acc, val) => {
        if (found) return acc;
        if (acc - tickerStats.latencies[val] < 0) {
            found = true;
            return val;
        }
        return acc - tickerStats.latencies[val];
    }, index);
}

function calcTickerPercentiles() {
    return `[${calcTickerPercentile(5)},${calcTickerPercentile(25)},${calcTickerPercentile(50)},` +
        `${calcTickerPercentile(75)},${calcTickerPercentile(95)}]`;
}

async function writeToFile(data, timestamp) {
    const d = new Date(timestamp);
    const date = `${d.getUTCFullYear()}-${`0${d.getUTCMonth()+1}`.slice(-2)}-${`0${d.getUTCDate()}`.slice(-2)}`;
    const hour = `0${d.getUTCHours()}`.slice(-2);

    if (lastDate !== date) {
        if (lastDate) {
            log(`New date encountered: ${date}. (Not) zipping old date file: ${lastDate}. At ${d.toUTCString()}`);
            // Zip last date
        } else {
            log(`New date encountered: ${date} at ${d.toUTCString()}`);
        }

        log(`Ticker: Avg rate: ${calcTickerRate()}, Total: ${tickerStats.totalCalls}, Misses: ${tickerStats.misses}, ` +
            `Percentiles (ms) [5,25,50,75,95]: ${calcTickerPercentiles()}`);

        tickerStats = {
            startTime: Date.now(),
            totalCalls: 0,
            misses: 0,
            latencies: {},
        };
        lastDate = date;
    }

    const dirPath = `${ROOTDIR}/${date}/`;
    if (!await fileExists(dirPath)) {
        await mkdir(dirPath);
    }

    const filePath = `${dirPath}${date}_${hour}.txt`;
    if (!await fileExists(filePath)) {
        log(`Creating file: ${filePath} at ${d.toUTCString()}`);
        await appendFile(filePath, `// File created: ${d.toUTCString()}`);
    }

    await appendFile(filePath, data);
}

let lastTimestamp = 0;
function write(data, timestamp) {
    if (timestamp > lastTimestamp) {
        lastTimestamp = timestamp;
        return queueFile.push(writeToFile, data, timestamp);
    }
}

let lastData = '';

async function ticker() {
    try {
        const startTime = Date.now();
        const tickerData = await Promise.race([queuePolo.push(() => poloniex.returnTicker()), wait(2000)]);
        const delay = Date.now() - startTime;
        tickerStats.latencies[delay] = ~~tickerStats.latencies[delay] + 1;
        tickerStats.totalCalls++;

        if (!tickerData) {
            tickerStats.misses++;
            throw 'Ticker request timed out';
        }
        const timestamp = Date.now();
        const outputData = { time: timestamp };
        const refData = {};
        MARKETS.forEach((market) => {
            refData[market] = outputData[market] = {
                l: (+tickerData[market].last).toFixed(5),
                lA: (+tickerData[market].lowestAsk).toFixed(5),
                hB: (+tickerData[market].highestBid).toFixed(5),
                bV: (+tickerData[market].baseVolume).toFixed(5),
                qV: (+tickerData[market].quoteVolume).toFixed(5),
                '%C': (+tickerData[market].percentChange).toFixed(5),
            };
        });
        if (lastData !== JSON.stringify(refData)) {
            lastData = JSON.stringify(refData);
            write(`\n` + JSON.stringify(outputData), timestamp);
        }
    } catch (e) {
        if (e !== 'Ticker request timed out') {
            log(e);
        }
    }
    setImmediate(ticker);
}

ticker();
ticker();
