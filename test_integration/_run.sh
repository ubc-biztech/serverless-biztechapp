#!/bin/bash

# By default, use "all"
file=${1:-all}

if [ $file == all ]
then # if run all
    mocha ./test_integration
else # run a specific integration test
    mocha ./test_integration/${file}
fi