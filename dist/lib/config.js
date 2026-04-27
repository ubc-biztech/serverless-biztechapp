"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const awsConfig = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: "us-west-2",
};
exports.default = awsConfig;
