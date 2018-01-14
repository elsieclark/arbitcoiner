"use strict";
const fs   = require('fs');
const path = require('path');

const format = (...args) => {
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

const mkdir = (path) => {
    return new Promise((resolve, reject) => {
        fs.mkdir(path, () => {
            resolve();
        });
    });
};

const resolveFilePath = async(dir, name) => {
    const d = new Date();
    const folder = `${dir}/${d.getFullYear()}-${`0${d.getMonth()+1}`.slice(-2)}-${`0${d.getDate()}`.slice(-2)}/`;
    if (!await fileExists(folder)) {
        await mkdir(folder);
    }
    return `${folder}${name}.txt`;
};

const fileExists = (fileName) => {
    return new Promise((resolve, reject) => {
        fs.stat(fileName, (err, data) => {
            resolve(!err);
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
    const path = await resolveFilePath(dir, name);
    if (!await fileExists(path)) {
        const d = new Date();
        await appendFile(path, `${name} file created: ${d.toString()}\n`)
    }
    return appendFile(path, `${data}\n`);
}

module.exports = (name, ledgerDir, infoDir) => {
    const Logger = {

        // Write only to the official record
        ledger: async(...args) => {
            const output = format(...args);
            console.log(output);
            return writeToFile(infoDir, name, output)
                .then(() => {
                    writeToFile(ledgerDir, name, output);
                });
        },

        // Write to console and the info record
        info: (...args) => {
            const output = format(...args);
            console.log('Iota', output);
            return writeToFile(infoDir, name, output);
        },

        // Write only to the console
        console: (...args) => {
            console.log(...args);
        },
    };

    return Logger;
};
