import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { isEmpty, isValidEmail } from "../../lib/utils";
import docClient from "../../lib/docClient";
import {
  USERS_TABLE,
  MEMBERS2026_TABLE,
  PROFILES_TABLE
} from "../../constants/tables";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { createProfile } from "../profiles/helpers";
import { PROFILE_TYPES, TYPES } from "../profiles/constants";

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

  const memberParams = {
    id: data.email,
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
    createdAt: timestamp,
    updatedAt: timestamp
  };

  try {
    await db.put(memberParams, MEMBERS2026_TABLE, true);
    const response = helpers.createResponse(201, {
      message: "Created!",
      params: memberParams
    });
    callback(null, response);
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
    callback(null, response);
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

    const member = await db.query(MEMBERS2026_TABLE, "profile-query", {
      expression: "#profileID = :profileID",
      expressionNames: {
        "#profileID": "profileID"
      },
      expressionValues: {
        ":profileID": `${profileID}`
      }
    });

    if (isEmpty(member[0])) throw helpers.notFoundResponse("member", profileID);
    console.log(member);

    const { id } = member[0];

    const response = helpers.createResponse(200, { email: id });
    callback(null, response);
    return null;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
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
    callback(null, response);
    return null;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

export const getAll = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized for this action"
      });

    // scan the table
    const members = await db.scan(MEMBERS2026_TABLE);

    // re-organize the response
    let response = {};
    if (members !== null) response = helpers.createResponse(200, members);

    // return the response object
    callback(null, response);
    return null;
  } catch (err) {
    callback(null, err);
    return null;
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

    callback(null, response);
    return null;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
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
    // check that the member exists
    const existingMember = await db.getOne(email, MEMBERS2026_TABLE);
    if (isEmpty(existingMember))
      throw helpers.notFoundResponse("Member", email);

    const res = await db.deleteOne(email, MEMBERS2026_TABLE);
    const response = helpers.createResponse(200, {
      message: "Member deleted!",
      response: res
    });

    callback(null, response);
    return null;
  } catch (err) {
    callback(null, err);
    return null;
  }
};

/**
 * Grants Membership. Writes to User, Members, and Profile tables.
 *
 * event.body passed:
 * 
 * type CreateMemberRequest = {
 * 
 * email: string,
 * 
 * firstName: string,
 * 
 * lastName: string,
 * 
 * studentNumber?: string,
 * 
 * education: string,
 * 
 * pronouns: string,
 * 
 * levelOfStudy: string,
 * 
 * faculty: string,
 * 
 * major: string,
 * 
 * internationalStudent: boolean,
 * 
 * previousMember: boolean,
 * 
 * dietaryRestrictions: string,
 * 
 * referral: string,
 * 
 * topics: string[],
 * 
 * isMember: true,
 * 
 * adminCreated: true,
};
 */
export const grantMembership = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com"))
      throw helpers.createResponse(403, {
        message: "unauthorized"
      });

    const data = JSON.parse(event.body);

    const email = data.email.toLowerCase();
    if (!isValidEmail(email)) {
      throw helpers.inputError("Invalid email", email);
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

    if (isEmpty(member)) {
      const memberParams = {
        id: email,
        admin: isBiztechAdmin,
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
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await db.put(memberParams, MEMBERS2026_TABLE, true);
    }

    const memberWithProfile = await db.getOne(email, MEMBERS2026_TABLE);
    if (!memberWithProfile || !memberWithProfile.profileID) {
      await createProfile(
        email,
        isBiztechAdmin
          ? PROFILE_TYPES.EXEC
          : PROFILE_TYPES.ATTENDEE
      );
    }

    const response = helpers.createResponse(200, {
      message: "Membership granted",
    });
    callback(null, response);
    return null;

  } catch (err) {
    callback(null, err);
    return null;
  }

};
