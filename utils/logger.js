"use strict";
const fs   = require('fs');
const path = require('path');

const format = (args) => {
    return args.map((arg) => {
        if (typeof arg === 'string' || arg instanceof String) {
            return arg;
        }
        try {
            return JSON.stringify(arg);
        } catch (e) {
            return arg;
        }
    }).join(' ');
};

const resolveFilePath = (dir, name) => {
    const d = new Date();
    return `${dir}/${d.getFullYear()}-${`0${d.getMonth()+1}`.slice(-2)}-${`0${d.getDate()}`.slice(-2)}/${name}.txt`;
};

const fileExists = (fileName) => {
    return new Promise((resolve, reject) => {
        fs.stat(fileName, (err) => {
            resolve(!!err);
        });
    });
};

const appendFile = (path, data) => {
    return new Promise((resolve, reject) => {
        fs.appendFile(path, data, (err) => {
            if (err) {
                console.log('Logger error:', err);
            }
            return resolve();
        });
    });
};

async function writeToFile(dir, name, data) {
    const path = resolveFilePath(dir, name);
    if (!await fileExists(path)) {
        const d = new Date();
        await appendFile(path, `${name} file created: ${d.toString()}\n`)
    }
    await appendFile(path, `${data}\n`);
}

module.exports = (name, ledgerDir, infoDir) => {
    const Logger = {

        // Write only to the official record
        ledger: (...args) => {
            const output = format(args);
            return writeToFile(ledgerDir, name, output);
        },

        // Write to console and the info record
        info: (...args) => {
            const output = format(args);
            console.log(output);
            return writeToFile(infoDir, name, output);
        },

        // Write only to the console
        console: (...args) => {
            console.log(...args);
        },
    };

    return Logger;
};
