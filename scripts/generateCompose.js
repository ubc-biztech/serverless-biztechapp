import fs from "fs";
import yaml from "js-yaml";

const gatewayConfig = yaml.load(fs.readFileSync("./sls-multi-gateways.yml", "utf8"));

const stage = "dev";
const basePort = 4001;

const baseEnv = [
  "NODE_ENV=development",
  "SERVERLESS_ARN=${SERVERLESS_ARN}",
  "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}",
  "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}",
  "SERVERLESS_ACCESS_KEY=${SERVERLESS_ACCESS_KEY}",
  "STRIPE_DEV_CANCEL=${STRIPE_DEV_CANCEL}",
  "STRIPE_DEV_ENDPOINT=${STRIPE_DEV_ENDPOINT}",
  "STRIPE_DEV_KEY=${STRIPE_DEV_KEY}",
  "SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}",
  "SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}",
  "SLACK_APP_TOKEN=${SLACK_APP_TOKEN}",
  "OPENAI_API_KEY=${OPENAI_API_KEY}",
];

let port = 4001;
const services = {
  proxy: {
    environment: baseEnv,
    build: {
      context: ".",
      dockerfile: "./Dockerfile",
      target: "dev",
      cache_from: [
        "users-service:latest",
        "users-service:cache",
      ],
    },
    volumes: ["./:/app"],
    ports: [],
  },
};

for (const { srvName } of gatewayConfig.services) {
  if (!services.proxy.ports.includes(`"${port}:${port}"`)) {
    services.proxy.ports.push(`${port}:${port}`);
  }
  port++;
}

const compose = {
  services,
};

fs.writeFileSync("docker-compose.yml", yaml.dump(compose), "utf8");

console.log("Generated docker-compose.yml");

const dockerfileTemplate = (httpPort, lambdaPort, service) => `\
FROM node:20.7.0-alpine

WORKDIR /app

COPY package.json ./
COPY serverless.common.yml ./serverless.common.yml
COPY lib ./lib
COPY constants ./constants


WORKDIR /app/services/${service}
COPY ./services/${service} ./

COPY ./package*.json ./
COPY ./package-lock*.json ./

RUN npm install --save-dev serverless@4.4.4 serverless-offline@14.3.2

RUN npm install --ignore-scripts --legacy-peer-deps

ARG stage=${stage}
ARG httpPort=4001
ARG lambdaPort=5001

ENV STAGE=${stage}
ENV HTTP_PORT=${httpPort}
ENV LAMBDA_PORT=${lambdaPort}

CMD sh -c "npx sls offline --stage $STAGE --httpPort $HTTP_PORT --lamb
`;

gatewayConfig.services.forEach((svc, i) => {
  const servicePath = svc.srvSource;
  const httpPort = basePort + i;
  const lambdaPort = httpPort + 1000;

  const dockerfileContent = dockerfileTemplate(httpPort, lambdaPort);
  const targetPath = `${servicePath}/Dockerfile`;

  fs.writeFileSync(targetPath, dockerfileContent);
  console.log(`Dockerfile written for ${svc.srvName} at ${targetPath}`);
});

const dockerIgnoreContent = `\
.webpack
node_modules
test
test_integration
npm-debug.log
.DS_Store
.git
.gitignore
.env
*.log
*.md
`;

gatewayConfig.services.forEach((svc, i) => {
  const servicePath = svc.srvSource;

  const targetPath = `${servicePath}/.dockerignore`;

  fs.writeFileSync(targetPath, dockerIgnoreContent);
  console.log(`.dockerignore written for ${svc.srvName} at ${targetPath}`);
});