# Lambda Transactions
Lambda to keep all Biztech Users Credits up-to-date based on the transaction tables.

This lambda is used to automatically update the `biztechUsers`/`biztechUsersPROD` table when new rows are **inserted** into the `biztechTransactions`/`biztechTransactionsPROD` table. (As of now, updates to the transaction tables are completely ignored).

The diagram below draws a better picture of where the lambda plays a part.

![Image of Yaktocat](./lambda-transactions.png)

### Installation

1. Clone the repo:

    ```
    $ git clone https://github.com/ubc-biztech/lambda-transactions
    ```

2. Install the packages:

    ```
    $ cd lambda-transactions
    ```

    and

    ```
    $ npm install
    ```

### Scripts

`$ npm test` - Runs local tests using Jest

`$ npm run build` - Builds the lambda into a `.zip` file (lambda-transactions.zip)

`$ npm run deploy [ENV]` - Builds and deploys the lambda to the cloud. Use `[ENV]` to specify the environment you want to deploy to (accepts `stage` or `prod`)


### Environmental Files

A few dotenv (`.env`) environmental files are provided at `root`

They correspond to the environmental variables that need to be provided for each lambda


### Testing

In addition to Apiary, the endpoints can be tested using API testing framework [dredd](https://dredd.org/en/latest/). To add extra tests, first make sure you have docker installed. Then, make changes to the blueprints located in `api-blueprints/` by adding requests and responses (or adding the necessary endpoints). Test the new endpoints and requests by running the following script:
```
npm run test
```

Using the current API-B documentation, this script will spin up separate Docker containers for the API and database to tests the different endpoints for structure and return values. The logs can be viewed on the console, and will also be logged on the Apiary web application. Contact one of the lead developers for access to the account.

### Deployment

To update new versions of the lambda function, run the following:
```
npm run deploy [ENV]
```
to build the lambda function and push it to the AWS cloud. Make sure that you have the appropriate AWS credentials. In order to do this, you need to obtain the **AWS ACCESS KEY & SECRET**, place them in the AWS `config` and `credential` files (located in `~/.aws`),

### Built With

* [Node](https://nodejs.org/) - Javascript Runtime Environment
* [AWS SDK](https://aws.amazon.com/sdk-for-browser/) - Software Development Kit for using AWS Services
* [Jest](https://jestjs.io/) - Javascript Testing Framework
