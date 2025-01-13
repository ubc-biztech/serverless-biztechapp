import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import { isEmpty } from "../../lib/utils.js";

const PROFILES_TABLE = "biztechProfiles";
const REGISTRATIONS_TABLE = "biztechRegistrations";

export const createProfile = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    
    // Validate input
    helpers.checkPayloadProps(data, {
      email: { required: true, type: "string" },
      eventID: { required: true, type: "string" },
      year: { required: true, type: "number" }
    });

    const { email, eventID, year } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Check if profile already exists
    const existingProfile = await db.getOne(email, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!isEmpty(existingProfile)) {
      throw helpers.duplicateResponse("Profile", email);
    }

    // Get registration data
    const registration = await db.getOne(email, REGISTRATIONS_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (isEmpty(registration)) {
      throw helpers.notFoundResponse("Registration", email);
    }

    // Map registration data to profile schema
    const timestamp = new Date().getTime();
    const profile = {
      id: email,
      "eventID;year": eventIDAndYear,
      fname: registration.basicInformation.fname,
      lname: registration.basicInformation.lname,
      pronouns: registration.basicInformation.gender && registration.basicInformation.gender.length ? registration.basicInformation.gender[0] : "",
      type: "Attendee",
      major: registration.basicInformation.major,
      year: registration.basicInformation.year,
      hobby1: registration.dynamicResponses["130fac25-e5d7-4fd1-8fd8-d844bfdaef06"] || "",
      hobby2: registration.dynamicResponses["52a3e21c-e65f-4248-a38d-db93e410fe2c"] || "",
      funQuestion1: registration.dynamicResponses["3d130254-8f1c-456e-a325-109717ad2bd4"] || "",
      funQuestion2: registration.dynamicResponses["f535e62d-96ee-4377-a8ac-c7b523d04583"] || "",
      linkedIn: registration.dynamicResponses["ffcb7fcf-6a24-46a3-bfca-e3dc96b6309f"] || "",
      profilePictureURL: registration.dynamicResponses["1fb1696d-9d90-4e02-9612-3eb9933e6c45"] || "",
      additionalLink: registration.dynamicResponses["e164e119-6d47-453b-b215-91837b70e9b7"] || "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Create profile in DynamoDB
    const res = await db.create(profile, PROFILES_TABLE);

    const response = helpers.createResponse(201, {
      message: `Created profile for ${email} for event ${eventIDAndYear}`,
      response: res,
      profile
    });

    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getProfile = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.email || !event.pathParameters.eventID || !event.pathParameters.year) {
      throw helpers.missingPathParamResponse("email", "eventID", "year");
    }

    const { email, eventID, year } = event.pathParameters;
    const eventIDAndYear = `${eventID};${year}`;

    const profile = await db.getOne(email, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (isEmpty(profile)) {
      throw helpers.notFoundResponse("Profile", email);
    }

    const response = helpers.createResponse(200, profile);
    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
}; 