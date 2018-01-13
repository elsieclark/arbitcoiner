"use strict";
process.env.UV_THREADPOOL_SIZE = 128;
const Poloniex = require('poloniex-api-node');
const Queue    = require('superqueue');

const calls = 100;

const poloniex = new Poloniex();
const queue = new Queue({
    rate: 5,
    concurrency: 1,
});

const record = [];
const overallStartTime = Date.now();

const findMean = (arr) => {
    return arr.reduce((acc, val) => acc + val) / arr.length;
};

const findPercentile = (arr, percentile) => {
    const position = (arr.length-1) * (percentile / 100);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return arr[lower] + (arr[upper] - arr[lower]) * (position - lower);
};

const getTicker = async() => {
    const startTime = Date.now();
    return poloniex.returnTicker()
        .then(() => {
            record.push(Date.now() - startTime);
            if (record.length === calls) {
                const sortedRecord = record.sort((a,b) => a-b);
                console.log(`Overall time: ${Date.now() - overallStartTime}\n`,
                    `Mean: ${findMean(record)}\n`,
                    `Fastest: ${Math.min(...record)}\n`,
                    `5%: ${findPercentile(sortedRecord, 5)}\n`,
                    `25%: ${findPercentile(sortedRecord, 25)}\n`,
                    `50% (Median): ${findPercentile(sortedRecord, 50)}\n`,
                    `75%: ${findPercentile(sortedRecord, 75)}\n`,
                    `95%: ${findPercentile(sortedRecord, 95)}\n`,
                    `Slowest: ${Math.max(...record)}`)
            }
        });
};

for (let i = 0; i < calls; i++) {
    queue.push(getTicker);
}
