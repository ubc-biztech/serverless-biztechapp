import helpers from "../../lib/handlerHelpers.js";

export const upload = async (event, ctx, callback) => {
  return helpers.createResponse(200, {
    message: "Upload successful"
  });
};

export const report = async (event, ctx, callback) => {
  return helpers.createResponse(200, {
    message: "Report generated"
  });
};
