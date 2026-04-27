"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidEmail = exports.isEmpty = exports.dateComparer = exports.alphabeticalComparer = void 0;
// Alphabetical comparer, a -z
const alphabeticalComparer = (property) => (a, b) => {
    let top, bot;
    if (property) {
        top = a[property] ? a[property].toLowerCase() : "";
        bot = b[property] ? b[property].toLowerCase() : "";
    }
    else {
        top = a ? a.toLowerCase : "";
        bot = b ? b.toLowerCase : "";
    }
    return top !== bot ? (top > bot ? 1 : -1) : 0;
};
exports.alphabeticalComparer = alphabeticalComparer;
// Date comparer, putting the most 'recent' at the start
const dateComparer = (property) => (a, b) => {
    let top, bot;
    if (property) {
        top = a[property] ? new Date(a[property]) : 0;
        bot = b[property] ? new Date(b[property]) : 0;
    }
    else {
        top = a ? new Date(a) : 0;
        bot = b ? new Date(b) : 0;
    }
    return bot - top;
};
exports.dateComparer = dateComparer;
const isEmpty = (obj) => {
    if (obj === null || obj === undefined)
        return true;
    if (Array.isArray(obj) || typeof obj === "string")
        return obj.length === 0;
    return Object.keys(obj).length === 0;
};
exports.isEmpty = isEmpty;
// Checks if an email is valid
const isValidEmail = (email) => {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
};
exports.isValidEmail = isValidEmail;
