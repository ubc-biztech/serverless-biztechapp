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

const config = readConfigFile();

const allServices = config.services;

let selectedServices = allServices;
const basePort = config.port || 3000;
const stage = config.stage || "dev";

// support running specific services
const serviceArgs = process.argv.slice(2);

if (serviceArgs.length) {
  // validate the services first
  const allServiceNames = new Set(allServices.map(service => service.srvName));
  const invalidServices = serviceArgs.filter(name => !allServiceNames.has(name));
  if (invalidServices.length) {
    console.error(`Invalid service name(s): ${invalidServices.join(", ")}. Please see sls-multi-gateways.yml`);
    process.exit(1);
  }

  const requestedServiceNames = new Set(serviceArgs);
  selectedServices = allServices.filter(service => requestedServiceNames.has(service.srvName));

  if (!selectedServices.length) {
    console.error("No services specified to run");
    process.exit(1);
  }
}

const commands = runServices(selectedServices, basePort, stage, prefixColors);

const result = concurrently(commands, {
  killOthers: ["failure", "success"]
});

result.then();

const proxyServer = runProxy(selectedServices, basePort, stage);

process.on("SIGINT", () => {
  proxyServer.close(() => {
  	console.log("\nReceived SIGINT: Goodbye!");
	process.exit(1)});
});
