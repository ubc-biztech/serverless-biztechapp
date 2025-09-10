import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { isEmpty, isValidEmail } from "../../lib/utils";
import docClient from "../../lib/docClient";
import { MEMBERS2026_TABLE } from "../../constants/tables";

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

// table, indexName, keyCondition, filters = {
// }) {
//   try {
//     const params = {
//       TableName: table + (process.env.ENVIRONMENT || ""),
//       KeyConditionExpression: keyCondition.expression,
//       ExpressionAttributeValues: {
//         ...keyCondition.expressionValues,
//         ...(filters.ExpressionAttributeValues || {
//         })
//       }
//     };
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
