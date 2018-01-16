"use strict";

let money = 1380;
let volume = 0;
let i = 0;

while (volume < 120000 && money > 0.0000000000000001) {
    volume += money;
    money *= 0.9985;
    i++;
}

console.log(`Volume: ${volume}, Remainder: ${money}, Iterations: ${i}`);