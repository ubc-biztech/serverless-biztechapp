"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hello = void 0;
const handlerHelpers_1 = __importDefault(require("../../lib/handlerHelpers"));
const hello = async () => {
    return handlerHelpers_1.default.createResponse(200, {
        message: "test github action deploy 2"
    });
};
exports.hello = hello;
