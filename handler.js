import {
  readFileSync
} from "fs";
import path from "path";
import YAML from "yaml";
import express from "express";
import {
  createProxyMiddleware
} from "http-proxy-middleware";

// reads and parses config file
const readConfigFile = () => {
  const file = readFileSync(
    path.join(process.cwd(), "sls-multi-gateways.yml"),
    "utf8"
  );
  return YAML.parse(file);
};

// runs each services
const runServices = (services, httpPort, stage, prefixColors) => {
  const commands = [];

  for (let i = 0; i < services.length; i++) {
    const execCommand = `
            cd  ${process.cwd()}/${services[i].srvSource};
            sls offline --stage ${stage} --httpPort ${
  httpPort + i
} --lambdaPort ${httpPort + i + 1000}
        `;

    commands.push({
      command: execCommand,
      name: services[i].srvName,
      prefixColor: i < prefixColors.length ? prefixColors[i] : "gray",
    });
  }

  return commands;
};

// proxy each service
const runProxy = (services, httpPort, stage) => {
  const app = express();

  for (let i = 0; i < services.length; i++) {
    const proxyPath = `/${services[i].srvPath}`;
    const stripBasePath = services[i].stripBasePath;

    app.use(
      proxyPath,
      createProxyMiddleware({
        pathRewrite: (path) => {
          return stripBasePath ? path.replace(proxyPath, "/") : path;
        },
        target: `http://localhost:${httpPort + i}/${stage}/`,
        changeOrigin: true,
      })
    );
  }

  app.listen(4000);
};

export {
  readConfigFile, runServices, runProxy
};
