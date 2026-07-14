import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import {
  isEmpty
} from "../../lib/utils.js";
import {
  humanId
} from "human-id";
import {
  PROFILES_TABLE,
  USERS_TABLE
} from "../../constants/tables.js";
import {
  MUTABLE_PROFILE_ATTRIBUTES,
  PROFILE_TYPES,
  TYPES
} from "./constants.js";
import {
  buildProfileUpdateParams,
  createProfile,
  filterPublicProfileFields
} from "./helpers.js";
import {
  S3Client, PutObjectCommand
} from "@aws-sdk/client-s3";
import {
  getSignedUrl
} from "@aws-sdk/s3-request-presigner";
const REGISTRATIONS_TABLE = "biztechRegistrations";
const QRS_TABLE = "biztechQRs";
const S3 = new S3Client({
  region: "us-west-2"
});
const PROFILE_BUCKET = "biztech-profile-pictures";
import type {
  APIGatewayEvent,
  APIGatewayResponse,
  LambdaCallback,
  LambdaContext
} from "../../lib/types";
import type { Profile } from "./types";


type Handler = (
  event: APIGatewayEvent,
  ctx: LambdaContext,
  callback: LambdaCallback
) => Promise<APIGatewayResponse>;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const create: Handler = async (event, ctx, callback) => {
  try {
    const email = event.requestContext.authorizer?.claims?.email.toLowerCase();
    if (!email) {
      return helpers.createResponse(401, {
        message: "Authenticated user email missing."
      });
    }
    const response = await createProfile(
      email,
      email.endsWith("@ubcbiztech.com")
        ? PROFILE_TYPES.EXEC
        : PROFILE_TYPES.ATTENDEE
    );
    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

// deprecated, will be done in another pr
export const createPartialPartnerProfile: Handler = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body as string);

    // Validate input
    helpers.checkPayloadProps(data, {
      email: {
        required: true,
        type: "string"
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      },
      fname: {
        required: true,
        type: "string"
      },
      lname: {
        required: true,
        type: "string"
      },
      company: {
        required: true,
        type: "string"
      },
      role: {
        required: true,
        type: "string"
      },
      linkedIn: {
        required: false,
        type: "string"
      },
      profilePictureURL: {
        required: false,
        type: "string"
      },
      pronouns: {
        required: false,
        type: "string"
      }
    });

    const {
      email,
      eventID,
      year,
      fname,
      lname,
      company,
      role,
      linkedIn = "",
      profilePictureURL = "",
      pronouns = ""
    } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Check if profile already exists
    const existingProfile = await db.getOne(email, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!isEmpty(existingProfile)) {
      throw helpers.duplicateResponse("Profile", email);
    }

    // Generate profileID
    const profileID = humanId();

    // Create partial partner profile
    const timestamp = new Date().getTime();
    const profile = {
      id: email,
      "eventID;year": eventIDAndYear,
      profileID,
      fname,
      lname,
      pronouns,
      type: "Partner",
      company,
      role,
      linkedIn,
      profilePictureURL,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Create NFC entry
    const nfc = {
      id: profileID,
      "eventID;year": eventIDAndYear,
      type: "NFC_ATTENDEE",
      isUnlimitedScans: true,
      data: {
        email
      }
    };

    await Promise.all([
      db.create(profile, PROFILES_TABLE),
      db.create(nfc, QRS_TABLE)
    ]);

    return helpers.createResponse(201, {
      message: `Created partial partner profile and NFC for ${email} for event ${eventIDAndYear}`,
      profile,
      nfc
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

export const updatePublicProfile: Handler = async (event, ctx, callback) => {
  console.log("THOMAS CHANGES UPDATING HERE")
  try {
    const userID = event.requestContext.authorizer?.claims?.email.toLowerCase();
    const body = JSON.parse(event.body as string);
    helpers.checkPayloadProps(body, {
      viewableMap: {
        required: true
      }
    });
    const {
      viewableMap
    } = body;

    if (
      !viewableMap ||
      Object.prototype.toString.call(viewableMap) !== "[object Object]"
    ) {
      throw helpers.inputError("Viewable map is not a literal object", body);
    }

    const user = await db.getOne(userID, USERS_TABLE);
    const {
      profileID = null
    } = user || {
    };

    if (!profileID) {
      throw helpers.notFoundResponse("Profile", userID);
    }

    const compositeID = `PROFILE#${profileID}`;

    const result = await db.query(PROFILES_TABLE, null, {
      expression: "compositeID = :compositeID AND #type = :profileType",
      expressionValues: {
        ":compositeID": compositeID,
        ":profileType": TYPES.PROFILE
      },
      expressionNames: {
        "#type": "type"
      }
    });

    if (!result || result.length == 0) {
      throw helpers.createResponse(404, {
        message: `Profile: ${userID} not found`
      });
    }

    const profile = result[0];

    Object.keys(viewableMap).forEach((key) => {
      if (
        Object.hasOwnProperty.call(MUTABLE_PROFILE_ATTRIBUTES, key) &&
        typeof viewableMap[key] === "boolean"
      ) {
        profile.viewableMap[key] = viewableMap[key];
      }
    });

    delete body["viewableMap"];

    const updateBody: Record<string, string> = {};
    Object.keys(body).forEach((key) => {
      if (
        Object.hasOwnProperty.call(MUTABLE_PROFILE_ATTRIBUTES, key) &&
        typeof body[key] === "string"
      ) {
        updateBody[key] = body[key];
      }
    });

    const updateProfileParam = buildProfileUpdateParams(
      compositeID,
      updateBody,
      profile.viewableMap,
      PROFILES_TABLE,
      new Date().getTime()
    );

    const data = await db.updateDBCustom(updateProfileParam);
    return helpers.createResponse(200, {
      message: `successfully updated profile: ${userID}`,
      data
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

export const getPublicProfile: Handler = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.profileID) {
      throw helpers.missingPathParamResponse("profile", "profileID");
    }

    const {
      profileID
    } = event.pathParameters;

    // Query using the GSI
    const result = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${profileID}`,
        type: TYPES.PROFILE
      }
    }) as Profile;

    if (!result) {
      throw helpers.notFoundResponse("Profile", profileID);
    }

    // Filter to only include public fields
    const publicProfile = filterPublicProfileFields(result);

    return helpers.createResponse(200, publicProfile);
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

export const getUserProfile: Handler = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer?.claims?.email.toLowerCase();

    const user = await db.getOne(userID, USERS_TABLE);
    const {
      profileID = null
    } = user || {
    };

    if (!profileID) {
      throw helpers.notFoundResponse("Profile", userID);
    }

    const result = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${profileID}`,
        type: TYPES.PROFILE
      }
    });

    if (!result) {
      throw helpers.notFoundResponse("Profile", profileID);
    }

    return helpers.createResponse(200, result);
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

// deprecated, will be done in another pr
export const createCompanyProfile: Handler = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body as string);

    // Validate input
    helpers.checkPayloadProps(data, {
      name: {
        required: true,
        type: "string"
      },
      description: {
        required: true,
        type: "string"
      },
      profilePictureURL: {
        required: true,
        type: "string"
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      }
    });

    // Additional validation for arrays
    if (data.links && !Array.isArray(data.links)) {
      throw helpers.createResponse(400, {
        message: "links must be an array",
        data
      });
    }

    if (data.delegateProfileIDs && !Array.isArray(data.delegateProfileIDs)) {
      throw helpers.createResponse(400, {
        message: "delegateProfileIDs must be an array",
        data
      });
    }

    const {
      name,
      description,
      profilePictureURL,
      eventID,
      year,
      links = [],
      delegateProfileIDs = []
    } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Format company name to create ID (remove spaces and special characters)
    const companyId = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if company profile already exists
    const existingProfile = await db.getOne(companyId, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!isEmpty(existingProfile)) {
      throw helpers.duplicateResponse("Company Profile", name);
    }

    const timestamp = new Date().getTime();

    const companyProfile = {
      id: companyId,
      "eventID;year": eventIDAndYear,
      profileID: companyId,
      type: "Company",
      name,
      description,
      profilePictureURL,
      links,
      delegateProfileIDs,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Create QR entry for company
    const qr = {
      id: companyId,
      "eventID;year": eventIDAndYear,
      type: "NFC_COMPANY",
      isUnlimitedScans: true,
      data: {
        companyId
      }
    };

    await Promise.all([
      db.create(companyProfile, PROFILES_TABLE),
      db.create(qr, QRS_TABLE)
    ]);

    return helpers.createResponse(201, {
      message: `Created company profile and QR for ${name}`,
      profile: companyProfile,
      qr
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

export const createProfilePicUploadUrl: Handler = async (event, ctx, callback) => {
  try {
    const claims = event.requestContext?.authorizer?.claims || {
    };
    const userEmail = claims.email?.toLowerCase();
    if (!userEmail) {
      return helpers.createResponse(401, {
        message: "Unauthorized"
      });
    }

    let profileId = event.queryStringParameters?.profileId;
    if (!profileId) {
      const user = await db.getOne(userEmail, USERS_TABLE);
      profileId = user?.profileID;
    }
    if (!profileId) {
      return helpers.createResponse(400, {
        message: "Missing profileId"
      });
    }

    const {
      fileType, fileName, prefix
    } = JSON.parse(event.body || "{}");
    if (!fileType || !fileName) {
      return helpers.createResponse(400, {
        message: "Missing fileType or fileName"
      });
    }

    if (!fileType.startsWith("image/")) {
      return helpers.createResponse(400, {
        message: "Only image uploads are allowed"
      });
    }

    const safeExt = (fileName.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const folder =
      prefix === "original" || prefix === "optimized" ? prefix : "optimized";

    const key = `profile-pictures/${profileId}/${folder}/${Date.now()}.${
      safeExt || "jpg"
    }`;

    const putCmd = new PutObjectCommand({
      Bucket: PROFILE_BUCKET,
      Key: key,
      ContentType: fileType,
      CacheControl: "public, max-age=31536000, immutable"
    });

    const uploadUrl = await getSignedUrl(S3, putCmd, {
      expiresIn: 60
    });
    const publicUrl = `https://${PROFILE_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    return helpers.createResponse(200, {
      uploadUrl,
      key,
      publicUrl
    });
  } catch (err) {
    console.error("getProfilePicUploadUrl error", err);
    return helpers.createResponse(500, {
      message: "Failed to get upload URL"
    });
  }
};

export const linkPartnerToCompany: Handler = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body as string);

    // Validate input
    helpers.checkPayloadProps(data, {
      partnerProfileID: {
        required: true,
        type: "string"
      },
      companyProfileID: {
        required: true,
        type: "string"
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      }
    });

    const {
      partnerProfileID, companyProfileID, eventID, year
    } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Get company profile
    const companyResults = await db.query(PROFILES_TABLE, "profileID-index", {
      expression: "profileID = :profileID",
      expressionValues: {
        ":profileID": companyProfileID
      }
    });

    if (!companyResults || companyResults.length === 0) {
      throw helpers.notFoundResponse("Company Profile", companyProfileID);
    }

    const companyProfile = companyResults[0];
    if (companyProfile.type !== "Company") {
      throw helpers.createResponse(400, {
        message: "Provided profile ID is not a company profile"
      });
    }

    // Get partner profile
    const partnerResults = await db.query(PROFILES_TABLE, "profileID-index", {
      expression: "profileID = :profileID",
      expressionValues: {
        ":profileID": partnerProfileID
      }
    });

    if (!partnerResults || partnerResults.length === 0) {
      throw helpers.notFoundResponse("Partner Profile", partnerProfileID);
    }

    const partnerProfile = partnerResults[0];
    if (partnerProfile.type !== "Partner") {
      throw helpers.createResponse(400, {
        message: "Provided profile ID is not a partner profile"
      });
    }

    const timestamp = new Date().getTime();

    // Update partner profile with company information
    const partnerUpdateParams = {
      Key: {
        id: partnerProfile.id,
        "eventID;year": eventIDAndYear
      },
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      UpdateExpression:
        "set companyProfileID = :companyProfileID, companyProfilePictureURL = :companyProfilePictureURL, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":companyProfileID": companyProfileID,
        ":companyProfilePictureURL": companyProfile.profilePictureURL,
        ":updatedAt": timestamp
      },
      ReturnValues: "UPDATED_NEW"
    };

    // Update company profile with new delegate
    const companyUpdateParams = {
      Key: {
        id: companyProfile.id,
        "eventID;year": eventIDAndYear
      },
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      UpdateExpression:
        "set delegateProfileIDs = list_append(if_not_exists(delegateProfileIDs, :empty_list), :newDelegate), updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":newDelegate": [partnerProfileID],
        ":empty_list": [],
        ":updatedAt": timestamp
      },
      ReturnValues: "UPDATED_NEW"
    };

    await Promise.all([
      db.updateDBCustom(partnerUpdateParams),
      db.updateDBCustom(companyUpdateParams)
    ]);

    return helpers.createResponse(200, {
      message: `Linked partner ${partnerProfileID} to company ${companyProfileID}`,
      companyProfile,
      partnerProfile
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};

export const syncPartnerData: Handler = async (event, ctx, callback) => {
  try {
    // Get all partner profiles
    const partnerProfiles = await db.scan(PROFILES_TABLE, {
      FilterExpression: "#type = :type",
      ExpressionAttributeNames: {
        "#type": "type"
      },
      ExpressionAttributeValues: {
        ":type": "Partner"
      }
    });

    if (!partnerProfiles || partnerProfiles.length === 0) {
      return helpers.createResponse(200, {
        message: "No partner profiles found to sync"
      });
    }

    const results = await Promise.all(
      partnerProfiles.map(async (profile) => {
        const [eventID, year] = profile["eventID;year"].split(";");

        // Try to find matching registration
        const registration = await db.getOne(profile.id, REGISTRATIONS_TABLE, {
          "eventID;year": profile["eventID;year"]
        });

        if (!registration) {
          // Create registration entry if it doesn't exist
          const timestamp = new Date().getTime();
          const registrationData = {
            id: profile.id,
            "eventID;year": profile["eventID;year"],
            isPartner: true,
            profileID: profile.profileID,
            basicInformation: {
              fname: profile.fname || "",
              lname: profile.lname || "",
              companyName: profile.company || "",
              role: profile.role || "",
              gender: profile.pronouns || ""
            },
            registrationStatus: "registered",
            createdAt: timestamp,
            updatedAt: timestamp,
            dynamicResponses: {
            } // Ensure this exists even if empty
          };

          await db.create(registrationData, REGISTRATIONS_TABLE);
          return {
            profileID: profile.profileID,
            action: "created_registration",
            email: profile.id
          };
        } else {
          // Safely get dynamic responses with fallbacks
          const dynamicResponses = registration.dynamicResponses || {
          };

          // Update profile with registration data
          const updateParams = {
            Key: {
              id: profile.id,
              "eventID;year": profile["eventID;year"]
            },
            TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
            UpdateExpression:
              "set fname = :fname, lname = :lname, pronouns = :pronouns, company = :company, #role = :role, hobby1 = :hobby1, hobby2 = :hobby2, funQuestion1 = :funQuestion1, funQuestion2 = :funQuestion2, linkedIn = :linkedIn, additionalLink = :additionalLink, description = :description, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
              "#role": "role"
            },
            ExpressionAttributeValues: {
              ":fname": registration.basicInformation?.fname || "",
              ":lname": registration.basicInformation?.lname || "",
              ":pronouns": registration.basicInformation?.gender || "",
              ":company": registration.basicInformation?.companyName || "",
              ":role": registration.basicInformation?.role || "",
              ":hobby1":
                dynamicResponses["130fac25-e5d7-4fd1-8fd8-d844bfdaef06"] || "",
              ":hobby2":
                dynamicResponses["52a3e21c-e65f-4248-a38d-db93e410fe2c"] || "",
              ":funQuestion1":
                dynamicResponses["3d130254-8f1c-456e-a325-109717ad2bd4"] || "",
              ":funQuestion2":
                dynamicResponses["f535e62d-96ee-4377-a8ac-c7b523d04583"] || "",
              ":linkedIn":
                dynamicResponses["ffcb7fcf-6a24-46a3-bfca-e3dc96b6309f"] || "",
              ":additionalLink":
                dynamicResponses["e164e119-6d47-453b-b215-91837b70e9b7"] || "",
              ":description":
                dynamicResponses["6849bb7f-b8bd-438c-b03b-e046cede378a"] || "",
              ":updatedAt": new Date().getTime()
            } as Record<string, any>
          };

          // Only update profile picture if it doesn't exist in profile and exists in registration
          if (
            !profile.profilePictureURL &&
            dynamicResponses["1fb1696d-9d90-4e02-9612-3eb9933e6c45"]
          ) {
            updateParams.UpdateExpression +=
              ", profilePictureURL = :profilePictureURL";
            updateParams.ExpressionAttributeValues[":profilePictureURL"] =
              dynamicResponses["1fb1696d-9d90-4e02-9612-3eb9933e6c45"];
          }

          await db.updateDBCustom(updateParams);
          return {
            profileID: profile.profileID,
            action: "synced_from_registration",
            email: profile.id
          };
        }
      })
    );

    return helpers.createResponse(200, {
      message: `Synced ${results.length} partner profiles`,
      results
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
};
