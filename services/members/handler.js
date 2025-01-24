import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  isEmpty, isValidEmail
} from "../../lib/utils";
import docClient from "../../lib/docClient";
const {
  MEMBERS2025_TABLE
} = require("../../constants/tables");

export const create = async (event, ctx, callback) => {
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
    await db.put(memberParams, MEMBERS2025_TABLE);
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

export const get = async (event, ctx, callback) => {
  try {
    // eslint-disable-next-line
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("email");
    const email = event.pathParameters.email;

    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    const member = await db.getOne(email, MEMBERS2025_TABLE);
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
    // scan the table
    const members = await db.scan(MEMBERS2025_TABLE);

    // re-organize the response
    let response = {
    };
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
    // eslint-disable-next-line
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const email = event.pathParameters.id;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);

    const existingMember = await db.getOne(email, MEMBERS2025_TABLE);
    // eslint-disable-next-line
    if (isEmpty(existingMember))
      throw helpers.notFoundResponse("member", email);

    const data = JSON.parse(event.body);
    const res = await db.updateDB(email, data, MEMBERS2025_TABLE);
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
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const email = event.pathParameters.id;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    // check that the member exists
    const existingMember = await db.getOne(email, MEMBERS2025_TABLE);
    if (isEmpty(existingMember))
      throw helpers.notFoundResponse("Member", email);

    const res = await db.deleteOne(email, MEMBERS2025_TABLE);
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
