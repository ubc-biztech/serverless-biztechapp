#!/bin/bash

if [ -z $1 ]
then
    echo "Environment not specified! Pushing to staging..."
    aws lambda update-function-code --function-name biztechApp-staging-updateUserCredits --zip-file fileb://lambda-transactions.zip --profile biztech
elif [ $1 == prod ]
then
    echo "Production environment specified! Pushing to production..."
    aws lambda update-function-code --function-name biztechApp-prod-updateUserCredits --zip-file fileb://lambda-transactions.zip
elif [ $1 == prod ]
then
    echo "Staging environment specified! Pushing to staging..."
    aws lambda update-function-code --function-name biztechApp-staging-updateUserCredits --zip-file fileb://lambda-transactions.zip
else
    echo "[ERR] Specified environment does not exist! Aborting..."
fi
