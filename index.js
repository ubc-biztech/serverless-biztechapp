#!/usr/bin/env node

import concurrently from "concurrently";
import {
  readConfigFile, runProxy, runServices
} from "./handler.js";

const prefixColors = [
  "blue",
  "green",
  "magenta",
  "cyan",
  "white",
  "gray",
  "yellow",
  "red"
];

const file = readConfigFile();

const availableServices = file.services;

let servicesToRun = availableServices;
const httpPort = file.port || 3000;
const stage = file.stage || "dev";

// support running specific services
const serviceArg = process.argv.slice(2);

if (serviceArg.length) {
  // validate the services first
  const availableServicesSet = new Set(availableServices.map(availableService => availableService.srvName));
  const invalidServices = serviceArg.filter(serv => !availableServicesSet.has(serv));
  if (invalidServices.length) {
    console.error(`Invalid service name(s): ${invalidServices.join(", ")}. Please see sls-multi-gateways.yml`);
    process.exit(1);
  }

  const specificServices = new Set(serviceArg);
  servicesToRun = servicesToRun.filter(serviceToRun => specificServices.has(serviceToRun.srvName));

  if (!servicesToRun.length) {
    console.error(`No services specified to run`);
    process.exit(1);
  }
}

const commands = runServices(servicesToRun, httpPort, stage, prefixColors);

const result = concurrently(commands, {
  killOthers: ["failure", "success"]
});

result.then();

process.on("SIGINT", () => {
  console.log("");
  process.exit(1);
});

runProxy(servicesToRun, httpPort, stage);
