const fs = require('fs');

const file = fs.readFileSync('/Users/willclark/Documents/repos/arbitcoiner/data/recon/data_03.txt').toString();

const output = file
    .split('\n').slice(1)
    .map((line) => line.split(' '))
    .map((line) => [line[0], JSON.parse(line[1]), line[2]])
    .map((line) => {
        const relevant = {
            BTC_ETH: {
                lowestAsk: (+line[1].BTC_ETH.lowestAsk).toFixed(5),
                highestBid: (+line[1].BTC_ETH.highestBid).toFixed(5),
            },
            BTC_BCH: {
                lowestAsk: (+line[1].BTC_BCH.lowestAsk).toFixed(5),
                highestBid: (+line[1].BTC_BCH.highestBid).toFixed(5),
            },
            ETH_BCH: {
                lowestAsk: (+line[1].ETH_BCH.lowestAsk).toFixed(5),
                highestBid: (+line[1].ETH_BCH.highestBid).toFixed(5),
            },
        };

        const clockwise = ((1/relevant.BTC_ETH.lowestAsk)/relevant.ETH_BCH.lowestAsk) * relevant.BTC_BCH.highestBid;
        const counterClockwise = ((1/relevant.BTC_BCH.lowestAsk)*relevant.ETH_BCH.highestBid) * relevant.BTC_ETH.highestBid;

        return [line[0], ('     ' + line[2]).slice(-5), clockwise.toFixed(7), counterClockwise.toFixed(7), JSON.stringify(relevant)];
    })
    .filter((row) => {
        return row[2] > 1.0080 || row[3] > 1.0080;
    })
    .map((row) => row.join(', '))
    .join('\n');

fs.writeFileSync('/Users/willclark/Documents/repos/arbitcoiner/data/recon/filter-17-12-17_01.txt', output);