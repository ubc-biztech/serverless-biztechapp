import helpers from "../../lib/handlerHelpers";

export const hello = async () => {
  return helpers.createResponse(200, {
    message: "Yeet!"
  });
};
