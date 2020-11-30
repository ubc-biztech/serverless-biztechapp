import AWS from 'aws-sdk';
const OPTIONS = {
  region: 'us-west-2'
};
const FUNCTION_PREFIX = 'biztechApp-dev-';
const lambda = new AWS.Lambda(OPTIONS);

export default {

  /**
   * Create a promise that invokes specified lambda function for integration testing
   * @param {*} functionName - the lambda function name
   * @param {*} payload - JSON string with function payload. Empty by default
   */
  invokeLambda: function(functionName, payload = '') {

    let params = {
      FunctionName: FUNCTION_PREFIX + functionName,
    };
    if (payload) {

      params.Payload = payload;

    }
    return new Promise((resolve, reject) => {

      lambda.invoke(params, function(err, data) {

        if (err) {

          // something went wrong when invoking function!
          console.error(err);
          reject(err);

        }

        const payload = JSON.parse(data['Payload']);
        if (!payload.hasOwnProperty('statusCode') && !payload.hasOwnProperty('body')) {

          resolve([null, null]);

        }
        resolve([payload.statusCode, JSON.parse(payload.body)]);

      });

    });

  },
};
