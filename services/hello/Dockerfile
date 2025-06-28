FROM node:20.7.0-alpine

WORKDIR /app

COPY package.json ./
COPY serverless.common.yml ./serverless.common.yml
COPY lib ./lib
COPY constants ./constants


WORKDIR /app/services/hello
COPY ./services/hello ./

COPY ./package*.json ./
COPY ./package-lock*.json ./

RUN npm install --save-dev serverless@4.4.4 serverless-offline@14.3.2

RUN npm install --ignore-scripts --legacy-peer-deps

ARG stage=dev
ARG httpPort=4001
ARG lambdaPort=5001

ENV STAGE=dev
ENV HTTP_PORT=4002
ENV LAMBDA_PORT=5002

CMD ["sh", "-c", "npx sls offline --stage $STAGE --httpPort $HTTP_PORT --lambdaPort $LAMBDA_PORT"]
