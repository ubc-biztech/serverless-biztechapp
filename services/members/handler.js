import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { isEmpty, isValidEmail } from "../../lib/utils";
import {
  USERS_TABLE,
  MEMBERS2026_TABLE,
  PROFILES_TABLE
} from "../../constants/tables";
import {
  createProfile,
  updateProfileFromMembershipData
} from "../profiles/helpers";
import {
  PROFILE_TYPES,
  TYPES
} from "../profiles/constants";
import humanId from "human-id";

const validProfileTypes = new Set(Object.values(PROFILE_TYPES));

const defaultProfileTypeForEmail = (email) =>
  email.endsWith("@ubcbiztech.com")
    ? PROFILE_TYPES.EXEC
    : PROFILE_TYPES.ATTENDEE;

const normalizeProfileType = (profileType, email) =>
  validProfileTypes.has(profileType)
    ? profileType
    : defaultProfileTypeForEmail(email);

const PARTNER_PROFILE_VIEWABLE_MAP = {
  fname: true,
  lname: true,
  pronouns: true,
  major: false,
  year: false,
  profileType: true,
  hobby1: false,
  hobby2: false,
  funQuestion1: false,
  funQuestion2: false,
  linkedIn: true,
  profilePictureURL: false,
  additionalLink: false,
  resumeURL: false,
  description: false,
  company: true,
  position: true
};

const normalizePartner = (partner = {}) => ({
  email: partner.email ? partner.email.trim().toLowerCase() : "",
  firstName: (partner.firstName || partner.fname || "").trim(),
  lastName: (partner.lastName || partner.lname || "").trim(),
  pronouns: (partner.pronouns || "").trim(),
  linkedIn: (partner.linkedIn || partner.linkedin || "").trim(),
  company: (partner.company || "").trim(),
  position: (partner.position || "").trim()
});

const validatePartner = (partner) => {
  if (!isValidEmail(partner.email)) return "Invalid email";
  if (!partner.firstName) return "Missing firstName";
  if (!partner.lastName) return "Missing lastName";
  return null;
};

const summarizePartnerResults = (results) => {
  return results.reduce(
    (summary, result) => {
      summary[result.status] += 1;
      return summary;
    },
    {
      created: 0,
      skipped: 0,
      failed: 0
    }
  );
};

const buildPartnerMembershipRecords = (partner, profileID, timestamp) => {
  const user = {
    id: partner.email,
    fname: partner.firstName,
    lname: partner.lastName,
    isMember: true,
    admin: partner.email.endsWith("@ubcbiztech.com"),
    profileID,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const member = {
    id: partner.email,
    cardCount: 0,
    firstName: partner.firstName,
    lastName: partner.lastName,
    pronouns: partner.pronouns,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const profile = {
    compositeID: `PROFILE#${profileID}`,
    type: TYPES.PROFILE,
    profileID,
    fname: partner.firstName,
    lname: partner.lastName,
    pronouns: partner.pronouns,
    linkedIn: partner.linkedIn,
    company: partner.company,
    position: partner.position,
    createdAt: timestamp,
    updatedAt: timestamp,
    profileType: PROFILE_TYPES.PARTNER,
    viewableMap: PARTNER_PROFILE_VIEWABLE_MAP
  };

  return {
    user,
    member,
    profile
  };
};

const buildPartnerMembershipTransaction = (records, existingUser) => {
  const userWrite = isEmpty(existingUser)
    ? {
      Put: {
        TableName: USERS_TABLE,
        Item: records.user,
        ConditionExpression: "attribute_not_exists(id)"
      }
    }
    : {
      Update: {
        TableName: USERS_TABLE,
        Key: {
          id: records.user.id
        },
        UpdateExpression:
          "SET #fname = :fname, #lname = :lname, #isMember = :isMember, #admin = :admin, #profileID = :profileID, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#fname": "fname",
          "#lname": "lname",
          "#isMember": "isMember",
          "#admin": "admin",
          "#profileID": "profileID",
          "#updatedAt": "updatedAt"
        },
        ExpressionAttributeValues: {
          ":fname": records.user.fname,
          ":lname": records.user.lname,
          ":isMember": true,
          ":admin": records.user.admin,
          ":profileID": records.user.profileID,
          ":updatedAt": records.user.updatedAt
        },
        ConditionExpression: "attribute_exists(id)"
      }
    };

  return [
    userWrite,
    {
      Put: {
        TableName: MEMBERS2026_TABLE,
        Item: records.member,
        ConditionExpression: "attribute_not_exists(id)"
      }
    },
    {
      Put: {
        TableName: PROFILES_TABLE,
        Item: records.profile,
        ConditionExpression: "attribute_not_exists(compositeID)"
      }
    }
  ];
};

export const create = async (event, ctx, callback) => {
  const userID = event.requestContext.authorizer.claims.email.toLowerCase();
  if (!userID.endsWith("@ubcbiztech.com"))
    throw helpers.createResponse(403, {
      message: "unauthorized to perform this action"
    });

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  if (!isValidEmail(data.email)) {
    return helpers.inputError("Invalid email", data.email);
  }
  const email = data.email.toLowerCase();

  const memberParams = {
    id: email,
    education: data.education,
    firstName: data.first_name,
    lastName: data.last_name,
    pronouns: data.pronouns,
    studentNumber: data.student_number,
    faculty: data.faculty,
    year: data.year,
    major: data.major,
    prevMember: data.prev_member,
    international: data.international,
    topics: data.topics,
    heardFrom: data.heard_from,
    heardFromSpecify: data.heardFromSpecify,
    diet: data.diet,
    university: data.university,
    highSchool: data.high_school,
    admin: data.admin,
    profileType: normalizeProfileType(data.profileType, email),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  try {
    await db.put(memberParams, MEMBERS2026_TABLE, true);
    const response = helpers.createResponse(201, {
      message: "Created!",
      params: memberParams
    });
    return response;
  } catch (error) {
    let response;
    if (error.type === "ConditionalCheckFailedException") {
      response = helpers.createResponse(
        409,
        "Member could not be created because email already exists"
      );
    } else {
      response = helpers.createResponse(502, "Internal server error");
    }
    return response;
  }
};

export const getEmailFromProfile = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized for this action"
      });

    if (!event.pathParameters || !event.pathParameters.profileID)
      throw helpers.missingIdQueryResponse("profileID");

    const profileID = event.pathParameters.profileID;

    const user = await db.query(USERS_TABLE, "profileID-index", {
      expression: "#profileID = :profileID",
      expressionNames: {
        "#profileID": "profileID"
      },
      expressionValues: {
        ":profileID": `${profileID}`
      }
    });

    if (isEmpty(user[0])) throw helpers.notFoundResponse("user", profileID);
    console.log(user);

    const { id } = user[0];

    const response = helpers.createResponse(200, { email: id });
    return response;
  } catch (err) {
    console.log(err);
    return err;
  }
};

export const get = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized for this action"
      });

    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const email = event.pathParameters.id;

    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    const member = await db.getOne(email, MEMBERS2026_TABLE);
    if (isEmpty(member)) throw helpers.notFoundResponse("member", email);

    const response = helpers.createResponse(200, member);
    return response;
  } catch (err) {
    console.log(err);
    return err;
  }
};

export const getAll = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized for this action"
      });

    const members = await db.scan(MEMBERS2026_TABLE);

    let response = {};
    if (members !== null) response = helpers.createResponse(200, members);

    return response;
  } catch (err) {
    return err;
  }
};

export const update = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized for this action"
      });

    // eslint-disable-next-line
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const email = event.pathParameters.id;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);

    const existingMember = await db.getOne(email, MEMBERS2026_TABLE);
    // eslint-disable-next-line
    if (isEmpty(existingMember))
      throw helpers.notFoundResponse("member", email);

    const data = JSON.parse(event.body);
    const res = await db.updateDB(email, data, MEMBERS2026_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated member with email ${email}!`,
      response: res
    });

    return response;
  } catch (err) {
    console.error(err);
    return err;
  }
};

export const del = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized for this action"
      });

    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const email = event.pathParameters.id;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    const existingMember = await db.getOne(email, MEMBERS2026_TABLE);
    if (isEmpty(existingMember))
      throw helpers.notFoundResponse("Member", email);

    const res = await db.deleteOne(email, MEMBERS2026_TABLE);
    const response = helpers.createResponse(200, {
      message: "Member deleted!",
      response: res
    });

    return response;
  } catch (err) {
    return err;
  }
};

export const createPartnerMemberships = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com")) {
      return helpers.createResponse(403, {
        message: "unauthorized"
      });
    }

    const data = JSON.parse(event.body || "{}");
    if (!Array.isArray(data.partners)) {
      return helpers.inputError("partners must be an array", data);
    }

    const partners = data.partners.map(normalizePartner);
    const results = [];

    for (const partner of partners) {
      const validationError = validatePartner(partner);
      if (validationError) {
        results.push({
          email: partner.email,
          status: "failed",
          reason: validationError
        });
        continue;
      }

      const existingMember = await db.getOne(partner.email, MEMBERS2026_TABLE);
      if (!isEmpty(existingMember)) {
        results.push({
          email: partner.email,
          status: "skipped",
          reason: "membership already exists"
        });
        continue;
      }

      const profileID = humanId();
      const timestamp = new Date().getTime();
      const records = buildPartnerMembershipRecords(
        partner,
        profileID,
        timestamp
      );
      const existingUser = await db.getOne(partner.email, USERS_TABLE);
      const transactionItems = buildPartnerMembershipTransaction(
        records,
        existingUser
      );

      try {
        await db.writeMultiple(transactionItems);

        results.push({
          email: partner.email,
          status: "created",
          profileID
        });
      } catch (err) {
        const body = err && err.body ? JSON.parse(err.body) : {};
        results.push({
          email: partner.email,
          status: "failed",
          reason:
            body.code ||
            (err && err.message) ||
            "Failed to create partner membership"
        });
      }
    }

    return helpers.createResponse(200, {
      ...summarizePartnerResults(results),
      results
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, {
      message: err.message || "Internal server error"
    });
  }
};

// type CreateMemberRequest = {
//   email: string,
//   firstName: string,
//   lastName: string,
//   studentNumber?: string,
//   education: string,
//   pronouns: "He/Him/His" | "She/Her/Hers" | "They/Them/Theirs",
//   levelOfStudy: string,
//   faculty: string,
//   major: string,
//   internationalStudent: boolean,
//   previousMember: boolean,
//   dietaryRestrictions: string,
//   referral: string,
//   topics: string[],
//   isMember: true,
//   adminCreated: true,
// };

export const grantMembership = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com")) {
      callback(null, helpers.createResponse(403, {
        message: "unauthorized"
      }));
      return null;
    }

    const data = JSON.parse(event.body);

    const email = data && data.email ? data.email.toLowerCase() : undefined;
    if (!isValidEmail(email)) {
      callback(null, helpers.inputError("Invalid email", email));
      return null;
    }

    const timestamp = new Date().getTime();
    const userYear = data.levelOfStudy || data.year || "";
    const isBiztechAdmin = email.endsWith("@ubcbiztech.com");

    const user = await db.getOne(email, USERS_TABLE);
    const userParams = {
      id: email,
      education: data.education,
      studentId: data.studentNumber || "",
      fname: data.firstName,
      lname: data.lastName,
      faculty: data.faculty,
      major: data.major,
      year: userYear,
      gender: data.pronouns,
      diet: data.dietaryRestrictions,
      isMember: true,
      admin: isBiztechAdmin,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    if (isEmpty(user)) {
      await db.put(userParams,USERS_TABLE,true);
    } else {
      await db.updateDB(email, userParams, USERS_TABLE);
    }

    const member = await db.getOne(email, MEMBERS2026_TABLE);
    let memberDataForProfile = member;

    if (isEmpty(member)) {
      const memberParams = {
        id: email,
        cardCount: 0,
        education: data.education,
        firstName: data.firstName,
        lastName: data.lastName,
        pronouns: data.pronouns,
        studentNumber: data.studentNumber || "",
        faculty: data.faculty,
        year: userYear,
        major: data.major,
        prevMember: Boolean(data.previousMember),
        international: Boolean(data.internationalStudent),
        topics: data.topics,
        diet: data.dietaryRestrictions,
        heardFrom: data.referral,
        university: data.education,
        admin: isBiztechAdmin,
        profileType: isBiztechAdmin
          ? PROFILE_TYPES.EXEC
          : PROFILE_TYPES.ATTENDEE,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await db.put(memberParams, MEMBERS2026_TABLE, true);
      memberDataForProfile = memberParams;
    }

    const userWithProfile = await db.getOne(email, USERS_TABLE);
    if (userWithProfile && userWithProfile.profileID) {
      await updateProfileFromMembershipData(
        userWithProfile.profileID,
        memberDataForProfile
      );
    } else {
      await createProfile(
        email,
        isBiztechAdmin ? PROFILE_TYPES.EXEC : PROFILE_TYPES.ATTENDEE
      );
    }

    const response = helpers.createResponse(200, {
      message: "Membership granted",
    });
    return response;
  } catch (err) {
    console.error(err);
    return err;
  }
};
