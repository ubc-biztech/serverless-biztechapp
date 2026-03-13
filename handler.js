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
export const readConfigFile = () => {
  const config = readFileSync(
    path.join(process.cwd(), "sls-multi-gateways.yml"),
    "utf8"
  );
  return YAML.parse(config);
};

// builds concurrently commands for each service
export const runServices = (serviceConfigs, basePort, stage, prefixColors) => {
  const commands = [];

  for (let i = 0; i < serviceConfigs.length; i++) {
    const command = `
            cd  ${process.cwd()}/${serviceConfigs[i].srvSource};
            sls offline --stage ${stage} --httpPort ${
  basePort + i
} --lambdaPort ${basePort + i + 1000}
        `;

    commands.push({
      command,
      name: serviceConfigs[i].srvName,
      prefixColor: i < prefixColors.length ? prefixColors[i] : "gray",
    });
  }

  return commands;
};

// proxy each service
export const runProxy = (serviceConfigs, basePort, stage) => {
  const app = express();

  for (let i = 0; i < serviceConfigs.length; i++) {
    const proxyPath = `/${serviceConfigs[i].srvPath}`;
    const stripBasePath = serviceConfigs[i].stripBasePath;

    app.use(
      proxyPath,
      createProxyMiddleware({
        pathRewrite: (path) => {
          return stripBasePath ? path.replace(proxyPath, "/") : path;
        },
        target: `http://localhost:${basePort + i}/${stage}/`,
        changeOrigin: true,
      })
    );
  }

  return app.listen(4000);
};
