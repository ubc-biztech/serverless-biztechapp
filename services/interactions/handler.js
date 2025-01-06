import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";
import {
  handleBooth, handleConnection, handleWorkshop
} from "./helpers";

const CONNECTION = "CONNECTION";
const WORK = "WORKSHOP";
const BOOTH = "BOOTH";

export const postInteraction = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const userID = event.pathParameters.id;
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      interactionType: {
        required: true
      },
      eventParam: {
        required: true
      }
    });

    const timestamp = new Date().getTime();
    const {
      interactionType, eventParam
    } = data;

    let response;

    switch (interactionType) {
    case CONNECTION:
      response = await handleConnection(userID, eventParam, timestamp);
      break;

    case WORK:
      response = await handleWorkshop(userID, eventParam, timestamp);
      break;

    case BOOTH:
      response = await handleBooth(userID, eventParam, timestamp);
      break;

    default:
      throw handlerHelpers.createResponse(400, {
        message: "interactionType argument does not match known case"
      });
    }

    callback(null, response);
  } catch (err) {
    console.error(err);
    callback(null, err);
  }

  return null;
};

export const getAllConnections = (event, ctx, callback) => {};

export const getAllQuests = (event, ctx, callback) => {};
