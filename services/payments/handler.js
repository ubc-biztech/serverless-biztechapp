import helpers from '../../lib/handlerHelpers';
import { isValidEmail } from '../../lib/utils';
import db from '../../lib/db';
const AWS = require('aws-sdk');
const { USERS_TABLE, MEMBERS2023_TABLE } = require('../../constants/tables');
const stripe = require('stripe')(
  'sk_test_51KOxOlBAxwbCreS7JRQtvZCnCgLmn8tjK7WPHDGjpw0s4vfVHLwbcrZZvQLmd5cY7zKRIsfj3pnEDDHTy3G81Tuf00v9ygIBrC'
);
// endpoint secret - different for each webhook
const endpointSecret = process.env.ENVIRONMENT === 'PROD' ? 'whsec_VQYJBpMby1eq7Q9hrdOV4P134cAXMVbB' : 'whsec_TYSFr29HQ4bIPu649lgkxOrlPjrDOe2l';

// Creates the member here
export const webhook = async(event, ctx, callback) => {

  const userMemberSignup = async (data) => {

    const cognito = new AWS.CognitoIdentityServiceProvider({
      apiVersion: '2016-04-18',
    });
    const docClient = new AWS.DynamoDB.DocumentClient();
    const timestamp = new Date().getTime();

    const cognitoParams = {
      ClientId: '5tc2jshu03i3bmtl1clsov96dt',
      Username: data.email,
      UserAttributes: [{
        Name: 'name',
        Value: data.fname + ' ' + data.lname
      },
      {
        Name: 'custom:student_id',
        Value: data.student_number
      },],
      Password: data.password,
    };

    await cognito.signUp(cognitoParams).promise();

    const email = data.email;

    let isBiztechAdmin = false;

    //assume the created user is biztech admin if using biztech email
    if (
      email.substring(email.indexOf('@') + 1, email.length) === 'ubcbiztech.com'
    ) {

      isBiztechAdmin = true;

    }

    const userParams = {
      Item: {
        id: data.email,
        education: data.education,
        studentId: data.student_number,
        fname: data.fname,
        lname: data.lname,
        faculty: data.faculty,
        major: data.major,
        year: data.year,
        gender: data.pronouns,
        diet: data.diet,
        isMember: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        admin: isBiztechAdmin,
      },
      TableName: USERS_TABLE + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)',
    };

    const memberParams = {
      Item: {
        id: data.email,
        education: data.education,
        firstName: data.fname,
        lastName: data.lname,
        pronouns: data.pronouns,
        studentNumber: data.student_number,
        faculty: data.faculty,
        year: data.year,
        major: data.major,
        prevMember: data.prev_member,
        international: data.international,
        topics: data.topics.split(','),
        diet: data.diet,
        heardFrom: data.heard_from,
        university: data.university,
        highSchool: data.high_school,
        admin: isBiztechAdmin,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      TableName: MEMBERS2023_TABLE + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)',
    };

    await docClient.put(userParams).promise().catch((error) => {

      let response;
      if (error.code === 'ConditionalCheckFailedException') {

        response = helpers.createResponse(
          409,
          'User could not be created because email already exists'
        );

      } else {

        response = helpers.createResponse(
          502,
          'Internal Server Error occurred'
        );

      }
      callback(null, response);

    });
    await docClient.put(memberParams).promise().catch((error) => {

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

    const response = helpers.createResponse(201, {
      message: 'Created user and member!',
    });
    callback(null, response);

  };

  const memberSignup = async (data) => {

    const docClient = new AWS.DynamoDB.DocumentClient();
    const timestamp = new Date().getTime();

    const email = data.email;

    let isBiztechAdmin = false;

    //assume the created user is biztech admin if using biztech email
    if (
      email.substring(email.indexOf('@') + 1, email.length) === 'ubcbiztech.com'
    ) {

      isBiztechAdmin = true;

    }

    const userParams = {
      email: data.email,
      education: data.education,
      studentId: data.student_number,
      fname: data.fname,
      lname: data.lname,
      faculty: data.faculty,
      major: data.major,
      year: data.year,
      gender: data.pronouns,
      diet: data.diet,
      isMember: true,
      admin: isBiztechAdmin,
    };

    const memberParams = {
      Item: {
        id: data.email,
        education: data.education,
        firstName: data.fname,
        lastName: data.lname,
        pronouns: data.pronouns,
        studentNumber: data.student_number,
        faculty: data.faculty,
        year: data.year,
        major: data.major,
        prevMember: data.prev_member,
        international: data.international,
        topics: data.topics.split(','),
        diet: data.diet,
        heardFrom: data.heard_from,
        university: data.university,
        highSchool: data.high_school,
        admin: isBiztechAdmin,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      TableName: MEMBERS2023_TABLE + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)',
    };

    await db.updateDB(email, userParams, USERS_TABLE).catch((error) => {

      let response;

      response = helpers.createResponse(
        400,
        `User could not be updated: ${error}`
      );

      callback(null, response);

    });
    await docClient.put(memberParams).promise().catch((error) => {

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

    const response = helpers.createResponse(201, {
      message: 'Created member and updated user!',
    });
    callback(null, response);

  };

  const sig = event.headers['Stripe-Signature'];

  let eventData;

  try {

    eventData = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);

  } catch(err) {

    return helpers.createResponse(400, {
      message: `Webhook Error: ${err}`
    });

  }

  if (eventData.type == 'checkout.session.completed') {

    const data = eventData.data.object.metadata;

    if (!isValidEmail(data.email)) {

      return helpers.inputError('Invalid email', data.email);

    }

    switch (data.paymentType) {

    case 'UserMember':
      await userMemberSignup(data);
      break;
    case 'Member':
      await memberSignup(data);
      break;
    default:
      return helpers.createResponse(400, {
        message: 'Webhook Error: unidentified payment type'
      });

    }

  }

};

export const payment = async (event, ctx, callback) => {

  const data = JSON.parse(event.body);
  const { paymentImages } = data;
  delete data.paymentImages;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'CAD',
          product_data: {
            name: data.paymentName,
            images: paymentImages,
          },
          unit_amount: data.paymentPrice,
        },
        quantity: 1,
      },
    ],
    metadata: data,
    mode: 'payment',
    success_url: data.success_url,
    cancel_url: data.cancel_url,
  });

  let response = helpers.createResponse(200, session.url);
  callback(null, response);
  return null;

};
