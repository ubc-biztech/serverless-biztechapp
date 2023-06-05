#!/usr/bin/env node

import concurrently from 'concurrently';
import { readConfigFile, runProxy, runServices } from './handler.js';

const prefixColors = [
  'blue',
  'green',
  'magenta',
  'cyan',
  'white',
  'gray',
  'yellow',
  'red',
];

const file = readConfigFile();

const services = file.services;
const httpPort = file.port || 3000;
const stage = file.stage || 'dev';

const commands = runServices(services, httpPort, stage, prefixColors);

concurrently(commands, {
  killOthers: ['failure', 'success'],
}).then();

process.on('SIGINT', () => {

  console.log('');
  process.exit(1);

});

runProxy(services, httpPort, stage);
