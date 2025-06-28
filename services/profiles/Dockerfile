FROM node:20.7.0-alpine

WORKDIR /app

COPY ./package*.json ./
COPY ./package-lock*.json ./

RUN npm install --save-dev serverless@4.4.4 serverless-offline@14.3.2

RUN npm ci --ignore-scripts

COPY ../../serverless.common.yml /serverless.common.yml

COPY . .

ARG stage=dev
ARG httpPort=4001
ARG lambdaPort=5001

ENV STAGE=dev
ENV HTTP_PORT=4015
ENV LAMBDA_PORT=5015

CMD ["sh", "-c", "npx sls offline --stage $STAGE --httpPort $HTTP_PORT --lambdaPort $LAMBDA_PORT"]
