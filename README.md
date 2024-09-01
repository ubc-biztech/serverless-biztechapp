# serverless-biztech-app
Biztech's backend API developed using serverless.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. See [deployment](#deployment) for notes on how to deploy the project to a live system.

### Installation and Running

1. Clone the repo:

    ```
    $ git clone https://github.com/ubc-biztech/serverless-biztechapp
    ```

2. Install the packages:

    ```
    $ npm install
    $ npm run install
    ```
    The second command will install the dependencies for each handler

3. Install the serverless cli globally:

    ```
    $ npm install -g serverless@1.67.2
    ```

4. Log into the serverless dashboard

    ```
    $ serverless login
    ```
    
    > Use our Google Account, dev@ubcbiztech.com

5. Set the directory's AWS keys for serverless:

   ```
   $ serverless config credentials --provider aws --key <AWS_ACCESS_KEY_ID> --secret <AWS_SECRET_ACCESS_KEY>
   ```
   
   > Obtain the AWS_SERVERLESS_KEY and AWS_SERVERLESS_SECRET from Notion, or from one of the other devs
   
6. Set AWS keys for AWS SDK to run things like integration tests:

    ```
    $ export AWS_ACCESS_KEY_ID= <AWS_ACCESS_KEY_ID>
    $ export AWS_SECRET_ACCESS_KEY = <AWS_SECRET_ACCESS_KEY>
    ```

7. Develop Locally:
    Ensure that you have DynamoDB local setup (check notion)

    ```
        npm run init:db
        npm run dev
    ```

8. Deploying 
    Use this to test the branch on the staging branch
    ```
        sls deploy
    ```


## Development

### Files and Services

* `services/` - Our main services.
* `libs/` - Abstracted functions to be used by our handlers in each service. Most functions that directly connect to databases are located here.
* `constants/` - Abstracted constants

* `services/*/test/` - Unit tests for the respective service.
* `services/*/test_integration/` - Integration tests for the respective service.

See [testing](#testing) for information on how to run them.

### Postman

A shared Postman workplace is available to help test the different endpoints. Contact one of our developers to receive an invite into the workspace.

Because of the need to authenticate the source of the API calls, you will need to obtain an `Authorization` bearer token to be used by postman. Further steps to do this can be found on [Notion](https://www.notion.so/ubcbiztech/How-to-CURL-Postman-2e4a7517a7d546c8aacee8d018fd2d3c)

### Linting

Linters are put into place to exercise good and consistent coding style, regardless of developer. Editing lint rules can be done by changing the `.eslintrc.json` file.


## Documentation

Our serverless API are documented using the [Postman API Documentation Tool](https://www.postman.com/api-documentation-tool/)


## Testing

During development, be sure to write unit/integration tests to ensure that the handlers are free from error and covers all the required use cases.

See our [notion doc](https://www.notion.so/ubcbiztech/Unit-Testing-Notes-a7016cc431744dc0b98b57277e572572) for more information on writing unit tests.

**Unit tests** can be run using the following command:

```
npm run utest <service_name> <function_name>
```
This command runs a shell script that indirectly runs the serverless command: `sls invoke test -f <function>`

Not specifying a `service_name` will run all the tests in the repo.

Specifying a `service_name`, but not specifying a `function_name` will run all the tests in a service.

**Integration tests** can be run using the following command:

```
npm run itest <function_name>
```
This command runs a shell script that indirectly runs the mocha command: `mocha <path_to_function>`

Not specifying a `function_name` will run all the tests instead.

In order to run integration tests, however, you need to [deploy](#development-dev) the API to dev environment first.

[Travis CI](https://travis-ci.org) is used to automatically run all our tests for our Pull Requests and when releasing.


Both integration and unit tests can be run at the same time by:
```
npm run test
```

### Running tests from inside each service file

The test functions can also be run from inside each of the service files.

When you do so, the nested `package.json` files are set up so that the `service_name` argument is no longer needed, and the first argument of the command is replaced with the `function_name` instead.

For example, from inside `service/hello`, you will be able to run:

`npm run utest <function_name>` and
`npm run itest <function_name>`

## Deployment (CHANGE README AFTER MICROSERVICE CHANGES COMPLETE)

Our serverless API is deployed into different environments:

### Development (dev)
- Used for active **backend development**
- Uses databases `biztechUsers`, `biztechegistrations`, etc.
To deploy to this environment, run the following in each service file:

```
npm run dev
```

### Staging
- Used for active **frontend development**
- Uses the same databases as development environment
Merges to our **master** branch are automatically deployed to stage using Travis CI.

### Production (prod)
- Used by active users
- Production endpoints should only be called by `bt-web`
- Database names are appended with `PROD`
Deploying to our **production** environment can be done through a Github release. Github actions are set up to automatically trigger a deploy during a release. For more information on creating a release, take a look at our [notion doc](https://www.notion.so/ubcbiztech/Production-Releases-76b97d59214d4d29b4db6b9e5c4692e1).

Generally, deployments to each environment can be done by adding the "-stage" argument like the following:

```
sls deploy -stage staging
```

However, it is not recommended to deploy to our **staging** or **production** environments this way.


## Contributing
Contributions are accepted from members of the biztech team. General instructions to start contributing are as follows:

1. Clone the remote repo into a local environment
2. Setup the repo (instructions [here](#getting-started))
3. Make the appropriate edits and additions in your own new branch (use a unique branch name!)
4. Write or make changes to any tests, if required
5. Submit pull requests with a detailed description of the modifications
--> Pull requests will be accepted after being reviewed and after the appropriate tests are conducted
6. Merging to master will deploy the API to **staging** environment
7. Only deploy to our **production** environment after fully testing on staging

### Built With

* [Serverless](https://www.serverless.com) - Cloud Application Framework
* [SendGrid](https://sendgrid.com) - Email Delivery Service - DEPRECATED
* [AWS SDK Mock](https://www.npmjs.com/package/aws-sdk-mock) - Mock functions for AWS-SDK services
