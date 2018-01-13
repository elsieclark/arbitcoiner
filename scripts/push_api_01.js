const Poloniex = require('poloniex-api-node');
let poloniex = new Poloniex();

process.on('unhandledRejection', (reason, p) => {
    Log.info('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

poloniex.subscribe('ticker');
poloniex.subscribe('BTC_ETC');

poloniex.on('message', (channelName, data, seq) => {
    if (channelName === 'ticker') {
        console.log(`Ticker:`, data);
    }

    if (channelName === 'BTC_ETC') {
        console.log(`order book and trade updates received for currency pair ${channelName}`);
        console.log(`data sequence number is ${seq}`);
    }
});

poloniex.on('open', () => {
    console.log(`Poloniex WebSocket connection open`);
});

poloniex.on('close', (reason, details) => {
    console.log(`Poloniex WebSocket connection disconnected`);
});

poloniex.on('error', (error) => {
    console.log(`An error has occured`);
});

poloniex.openWebSocket({ version: 2 });