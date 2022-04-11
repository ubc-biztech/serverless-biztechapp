import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { isEmpty, isValidEmail } from '../../lib/utils';
const AWS = require('aws-sdk');
const { MEMBERS2022_TABLE } = require('../../constants/tables');
const stripe = require("stripe")(
  "sk_test_51KOxOlBAxwbCreS7JRQtvZCnCgLmn8tjK7WPHDGjpw0s4vfVHLwbcrZZvQLmd5cY7zKRIsfj3pnEDDHTy3G81Tuf00v9ygIBrC"
);
// development endpoint secret - switch to live secret key in production
const endpointSecret = "whsec_TYSFr29HQ4bIPu649lgkxOrlPjrDOe2l";

// Creates the member here
export const webhook = async(event, ctx, callback) => {

  const sig = event.headers['Stripe-Signature'];
  const docClient = new AWS.DynamoDB.DocumentClient();
  const timestamp = new Date().getTime();

  let eventData;

  // Stripe returns an error if verification fails
  try {

    eventData = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);

  } catch(err) {

    return helpers.createResponse(400, {
      message: `Webhook Error: ${err.message}`
    });

  }

  // Handle the checkout.session.completed event
  if (eventData.type == 'checkout.session.completed') {

    const data = eventData.data.object.metadata; 

    if (!isValidEmail(data.email)) {
      return helpers.inputError('Invalid email', data.email);
    }

    const memberParams = {
      Item: {
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
        university: data.university,
        highSchool: data.high_school,
        admin: data.admin,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      TableName: MEMBERS2022_TABLE + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)',
    };

    await docClient
    .put(memberParams)
    .promise()
    .then(() => {

      const response = helpers.createResponse(201, {
        message: 'Created!',
        params: memberParams,
      });
      callback(null, response);

    })
    .catch((error) => {
      // helpful when you need to find the exact error
      // console.log({errorCode: error.code, message: error.message});

      let response;
      if (error.code === 'ConditionalCheckFailedException') {

        response = helpers.createResponse(
          409,
          'Member could not be created because email already exists'
        );

      } else {
        
        response = helpers.createResponse(
          502,
          'Internal Server Error occurred'
        );

      }
      callback(null, response);
    });
  }
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export const payment = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "CAD",
          product_data: {
            name: "BizTech Membership",
            images: ["https://imgur.com/TRiZYtG.png"],
          },
          unit_amount: 500,
        },
        quantity: 1,
      },
    ],
    metadata: {
      id: data.id,
      email: data.email,
      faculty: data.faculty,
      first_name: data.first_name,
      last_name: data.last_name,
      heard_from: data.heard_from,
      education: data.education,
      high_school: data.high_school,
      major: data.major,
      pronouns: data.pronouns,
      student_number: data.student_number,
      timestamp: data.timestamp,
      topics: data.topics,
      university: data.university,
      year: data.year,
      international: data.international,
      prev_member: data.prev_member,
    },
    mode: "payment",
    success_url: "https://app.ubcbiztech.com/signup/success",
    cancel_url: "https://facebook.com",
  });
  
  let response = helpers.createResponse(200, session.url);
  callback(null, response);
  return null;
};

export const get = async (event, ctx, callback) => {
  try {
    // eslint-disable-next-line
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse('email');
    const email = event.pathParameters.email;

    if (!isValidEmail(email)) throw helpers.inputError('Invalid email', email);
    const member = await db.getOne(email, MEMBERS2022_TABLE);
    if (isEmpty(member)) throw helpers.notFoundResponse('member', email);

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
    const memberships = await db.scan(MEMBERS2022_TABLE);

    // re-organize the response
    let response = {};
    if (memberships !== null)
      response = helpers.createResponse(200, memberships);

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
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse('email');

    const email = event.pathParameters.email;
    if (!isValidEmail(email)) throw helpers.inputError('Invalid email', email);

    const existingMember = await db.getOne(email, MEMBERS2022_TABLE);
    // eslint-disable-next-line
    if (isEmpty(existingMember))
      throw helpers.notFoundResponse('member', email);

    console.log({ body: event.body});
    const data = JSON.parse(event.body);
    const res = await db.updateDB(email, data, MEMBERS2022_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated member with email ${email}!`,
      response: res,
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

    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse('email');

    const email = event.pathParameters.email;
    if (!isValidEmail(email)) throw helpers.inputError('Invalid email', email);
    // check that the member exists
    const existingMember = await db.getOne(email, MEMBERS2022_TABLE);
    if (isEmpty(existingMember)) throw helpers.notFoundResponse('Member', email);

    const res = await db.deleteOne(email, MEMBERS2022_TABLE);
    const response = helpers.createResponse(200, {
      message: 'Member deleted!',
      response: res,
    });

    callback(null, response);
    return null;

  } catch (err) {

    callback(null, err);
    return null;

  }

};