#!/bin/bash

# By default, use "all"
service=${1:-all}
function=${2:-all}

if [ $service == all ]
then # run integration tests for all services
    mocha --require babel-core/register ./services/*/test_integration
elif [ $function == all ]
then # run integration tests for all functions in a service
    mocha --require babel-core/register  ./services/${service}/test_integration
else # run integration tests for a specific function
    mocha --require babel-core/register  ./services/${service}/test_integration/${function}
fi

# Notes:
# "--require babel-core/register is needed to allow mocha to run es6 module files
