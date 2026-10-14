import { APIGatewayResponse } from "../../lib/types";
import response from "../../lib/responseHelpers";

export const hello = async (): Promise<APIGatewayResponse> => {
  return response.ok({
    message: "test typescript deploy 2"
  });
};