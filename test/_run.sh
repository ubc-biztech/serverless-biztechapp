#!/bin/bash

# By default, use "all"
file=${1:-all}

if [ $file == all ]
then # if run all
    sls invoke test
else # run a specific unit test
    sls invoke test -f ${file}
fi