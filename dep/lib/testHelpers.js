import {
  LambdaClient, InvokeCommand
} from "@aws-sdk/client-lambda";

const OPTIONS = {
  region: "us-west-2"
};
const API_PREFIX = "biztechApi";
const lambdaClient = new LambdaClient(OPTIONS);

export default {
  /**
   * Invokes specified lambda function for integration testing
   * @param {string} service - the service name
   * @param {string} functionName - the lambda function name
   * @param {string} payload - JSON string with function payload. Empty by default
   * @returns {Promise<[number, object]>} Promise resolving to [statusCode, responseBody]
   */
  invokeLambda: async function(service, functionName, payload = "") {
    const serviceName = service === "" ? API_PREFIX : `${API_PREFIX}-${service}`;

    const params = {
      FunctionName: `${serviceName}-dev-${functionName}`,
      Payload: payload ? Buffer.from(payload) : undefined
    };

    try {
      const command = new InvokeCommand(params);
      const response = await lambdaClient.send(command);

      // Convert Uint8Array to string and parse JSON
      const responsePayload = JSON.parse(new TextDecoder().decode(response.Payload));

      if (!responsePayload.hasOwnProperty("statusCode") && !responsePayload.hasOwnProperty("body")) {
        return [null, null];
      }

      return [
        responsePayload.statusCode,
        JSON.parse(responsePayload.body)
      ];
    } catch (error) {
      console.error("Lambda invocation error:", error);
      throw error;
    }
  },
};
