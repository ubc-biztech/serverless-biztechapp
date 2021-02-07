#!/bin/bash

# By default, use "all"
service=${1:-all}
function=${2:-all}
SERVICES_PATH=./services

cd $SERVICES_PATH
if [ $service == all ]
then # run unit tests for all services
    for DIR in *
    do
        cd $DIR
        sls invoke test --compilers js:babel-core/register
        cd ..
    done
elif [ $function == all ]
then # run unit tests for all functions in a service
    cd ${service}
    sls invoke test --compilers js:babel-core/register 
else # run unit tests for a specific function
    cd ${service} 
    sls invoke test --compilers js:babel-core/register --function ${function}
fi

# Notes:
# "--compilers js:babel-core/register" is needed to allow serverless mocha to run es6 module files
# "-root" is needed to set the run directory for the "sls invoke test" command
    # this is because serverless will try to find the "serverless.yml" file in the respective run directory
