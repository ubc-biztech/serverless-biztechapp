import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import { PROFILES_TABLE, USERS_TABLE } from "../../constants/tables.js";
import { CURRENT_ONBOARDING_YEAR } from "../../constants/onboarding.js";
import {
  MUTABLE_PROFILE_ATTRIBUTES,
  PROFILE_TYPES,
  TYPES
} from "./constants.js";
import {
  buildProfileUpdateParams,
  createProfile,
  filterPublicProfileFields,
  updateProfileFromMembershipData
} from "./helpers.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { protect, Access } from "../../lib/auth";
const S3 = new S3Client({
  region: "us-west-2"
});
const PROFILE_BUCKET = "biztech-profile-pictures";

const validateOnboardingData = (data) => {
  helpers.checkPayloadProps(data, {
    firstName: {
      required: true,
      type: "string"
    },
    lastName: {
      required: true,
      type: "string"
    },
    education: {
      required: true,
      type: "string"
    },
    pronouns: {
      required: true,
      type: "string"
    },
    levelOfStudy: {
      required: true,
      type: "string"
    },
    faculty: {
      required: true,
      type: "string"
    },
    major: {
      required: true,
      type: "string"
    },
    internationalStudent: {
      required: true,
      type: "string"
    },
    previousMember: {
      required: true,
      type: "string"
    },
    dietaryRestrictions: {
      required: true,
      type: "string"
    },
    referral: {
      required: true,
      type: "string"
    }
  });

  if (
    !["Yes", "No"].includes(data.internationalStudent) ||
    !["Yes", "No"].includes(data.previousMember)
  ) {
    throw helpers.inputError("Invalid yes/no onboarding response", data);
  }

  if (
    !Array.isArray(data.topics) ||
    data.topics.some((topic) => typeof topic !== "string")
  ) {
    throw helpers.inputError("topics must be an array of strings", data.topics);
  }

  if (
    data.studentNumber !== undefined &&
    (typeof data.studentNumber !== "string" ||
      !/^\d{0,8}$/.test(data.studentNumber))
  ) {
    throw helpers.inputError(
      "Student number must contain up to 8 digits, or be left empty",
      data.studentNumber
    );
  }

  if (data.linkedIn !== undefined && typeof data.linkedIn !== "string") {
    throw helpers.inputError("linkedIn must be a string", data.linkedIn);
  }
};

export const create = protect(Access.USER, async (event) => {
  try {
    const email = event.auth.email;
    const data = JSON.parse(event.body || "{}");
    if (typeof data.studentNumber === "string") {
      data.studentNumber = data.studentNumber.trim();
    }
    validateOnboardingData(data);

    const updateResult = await db.updateDB(
      email,
      {
        education: data.education,
        ...(data.studentNumber !== undefined
          ? { studentId: data.studentNumber }
          : {}),
        fname: data.firstName,
        lname: data.lastName,
        faculty: data.faculty,
        major: data.major,
        year: data.levelOfStudy,
        gender: data.pronouns,
        diet: data.dietaryRestrictions,
        international: data.internationalStudent === "Yes",
        prevMember: data.previousMember === "Yes",
        referral: data.referral,
        topics: data.topics
      },
      USERS_TABLE,
      "ALL_NEW"
    );
    const user = updateResult.Attributes;

    const profileData = {
      firstName: data.firstName,
      lastName: data.lastName,
      pronouns: data.pronouns,
      major: data.major,
      year: data.levelOfStudy,
      linkedIn: data.linkedIn || ""
    };
    const profileType = email.endsWith("@ubcbiztech.com")
      ? PROFILE_TYPES.EXEC
      : PROFILE_TYPES.ATTENDEE;
    if (user?.profileID) {
      await updateProfileFromMembershipData(
        user.profileID,
        profileData,
        profileType
      );
      await db.updateDB(
        email,
        {
          onboardingYear: CURRENT_ONBOARDING_YEAR
        },
        USERS_TABLE
      );
      return helpers.createResponse(200, {
        message: `Updated profile for ${email}`,
        profileID: user.profileID
      });
    }

    const response = await createProfile(email, profileType, profileData);
    await db.updateDB(
      email,
      {
        onboardingYear: CURRENT_ONBOARDING_YEAR
      },
      USERS_TABLE
    );
    return response;
  } catch (err) {
    console.error(err);
    if (err?.statusCode && err?.body) return err;
    return helpers.createResponse(500, { message: err.message || err });
  }
});

export const updatePublicProfile = protect(Access.USER, async (event) => {
  try {
    const userID = event.auth.email;
    const body = JSON.parse(event.body);
    helpers.checkPayloadProps(body, {
      viewableMap: {
        required: true
      }
    });
    const { viewableMap } = body;

    if (
      !viewableMap ||
      Object.prototype.toString.call(viewableMap) !== "[object Object]"
    ) {
      throw helpers.inputError("Viewable map is not a literal object", body);
    }

    const user = await db.getOne(userID, USERS_TABLE);
    const { profileID = null } = user || {};

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

    if (!result || result.length === 0) {
      throw helpers.createResponse(404, {
        message: `Profile: ${userID} not found`
      });
    }

    const profile = result[0];

    Object.keys(viewableMap).forEach((key) => {
      if (
        Object.hasOwn(MUTABLE_PROFILE_ATTRIBUTES, key) &&
        typeof viewableMap[key] === "boolean"
      ) {
        profile.viewableMap[key] = viewableMap[key];
      }
    });

    delete body["viewableMap"];

    const updateBody = {};
    Object.keys(body).forEach((key) => {
      if (
        Object.hasOwn(MUTABLE_PROFILE_ATTRIBUTES, key) &&
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
    return helpers.createResponse(500, { message: err.message || err });
  }
});

export const getPublicProfile = async (event) => {
  try {
    if (!event.pathParameters || !event.pathParameters.profileID) {
      throw helpers.missingPathParamResponse("profileID");
    }

    const { profileID } = event.pathParameters;

    // Query using the GSI
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

    // Filter to only include public fields
    const publicProfile = filterPublicProfileFields(result);

    return helpers.createResponse(200, publicProfile);
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

export const getUserProfile = protect(Access.USER, async (event) => {
  try {
    const userID = event.auth.email;

    const user = await db.getOne(userID, USERS_TABLE);
    const { profileID = null } = user || {};

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
    return helpers.createResponse(500, { message: err.message || err });
  }
});

export const createProfilePicUploadUrl = protect(Access.USER, async (event) => {
  try {
    const userEmail = event.auth.email;

    // Always resolve the profile from the authenticated caller's own record.
    // Any caller-supplied queryStringParameters.profileId is ignored to prevent
    // uploading to another user's profile prefix (IDOR).
    const user = await db.getOne(userEmail, USERS_TABLE);
    const profileId = user?.profileID;
    if (!profileId) {
      return helpers.createResponse(400, {
        message: "Missing profileId"
      });
    }

    const { fileType, fileName, prefix } = JSON.parse(event.body || "{}");
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
});
