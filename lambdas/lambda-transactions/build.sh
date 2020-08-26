#!/bin/bash

echo "Building lambda-transactions.zip"

rm lambda-transactions.zip

zip -r                        \
lambda-transactions.zip       \
index.js                      \
node_modules/*

echo "Done lambda-transactions.zip"
