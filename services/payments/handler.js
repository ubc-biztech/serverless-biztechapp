import helpers from '../../lib/handlerHelpers';
import { isValidEmail, isEmpty } from '../../lib/utils';
import { sendEmail } from '../registrations/handler';
import db from '../../lib/db';
const AWS = require('aws-sdk');
const { USERS_TABLE, EVENTS_TABLE, MEMBERS2023_TABLE, USER_REGISTRATIONS_TABLE } = require('../../constants/tables');
const stripe = require('stripe')(
  process.env.ENVIRONMENT === 'PROD' ?
    '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'
    :
    'sk_test_51KOxOlBAxwbCreS7JRQtvZCnCgLmn8tjK7WPHDGjpw0s4vfVHLwbcrZZvQLmd5cY7zKRIsfj3pnEDDHTy3G81Tuf00v9ygIBrC'
);
// endpoint secret - different for each webhook
const endpointSecret = process.env.ENVIRONMENT === 'PROD' ? 'whsec_IOXyPRmf3bsliM3PfWXFhvkmHGeSMekf' : 'whsec_TYSFr29HQ4bIPu649lgkxOrlPjrDOe2l';

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
        heardFromSpecify: data.heardFromSpecify,
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

  const oauthMemberSignup = async (data) => {

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
        heardFromSpecify: data.heardFromSpecify,
        university: data.university,
        highSchool: data.high_school,
        admin: isBiztechAdmin,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      TableName: MEMBERS2023_TABLE + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)',
    };

    // putting into user table 
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

      console.log("put user in usertable")

    });

    // putting into member table 
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

    console.log("put user in usertable and membertable") 

    const response = helpers.createResponse(201, {
      message: 'Created oAuth member and user!',
    });
    callback(null, response);

  } 
  
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
        heardFromSpecify: data.heardFromSpecify,
        university: data.university,
        highSchool: data.high_school,
        admin: isBiztechAdmin,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      TableName: MEMBERS2023_TABLE + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)',
    };

    // for members, we update the user table here 
    // but if we change the bt web payment body for oauth users from usermember to memebr, 
    // we will neesd a check here to see if user is first time oauth
    // if yes, we want a db.post instead of db.update
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

  const eventRegistration = async (data) => {

    const docClient = new AWS.DynamoDB.DocumentClient();
    const { email, registrationStatus, year, eventID } = data;
    const eventIDAndYear = `${data.eventID};${data.year}`;
    const conditionExpression = 'attribute_not_exists(id) and attribute_not_exists(#eventIDYear)';
    const ignoreKeys = ['eventID', 'year', 'email', 'registrationStatus', 'paymentType', 'paymentName', 'paymentPrice', 'success_url', 'cancel_url'];
    const ignoreUserKeys = ['diet', 'heardFrom'];

    Object.keys(data).forEach(function (key) {

      if (ignoreKeys.includes(key)) delete data[key];

    });

    data.basicInformation = JSON.parse(data.basicInformation);
    data.dynamicResponses = JSON.parse(data.dynamicResponses);

    const create = {
      registrationStatus,
      ...data,
    };

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(create);

    const params = {
      Key: { 'id': email, ['eventID;year']: eventIDAndYear },
      TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: { ...expressionAttributeNames, '#eventIDYear': 'eventID;year' },
      UpdateExpression: updateExpression,
      ReturnValues: 'UPDATED_NEW',
      ConditionExpression: conditionExpression
    };

    const res = await docClient.update(params).promise();

    Object.keys(data.basicInformation).forEach(function (key) {

      if (ignoreUserKeys.includes(key)) delete data.basicInformation[key];

    });

    const user = {
      id: email,
      studentId: data.studentId,
      ...data.basicInformation,
    };

    const existingEvent = await db.getOne(eventID, EVENTS_TABLE, { year: Number(year) });
    if(isEmpty(existingEvent)) throw helpers.notFoundResponse('Event', eventID, year);

    const id = `${email};${eventID};${year}`;

    try {

      await sendEmail(user, existingEvent, registrationStatus, id);

    } catch (err) {

      throw helpers.createResponse(500, {
        statusCode: 500,
        code: 'SENDGRID ERROR',
        message: `Sending Email Error!: ${err.message}`
      });

    }

    const response = helpers.createResponse(201, {
      message: `User with email ${email} successfully registered (created) to status '${registrationStatus}'!`,
      response: res,
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
    case 'OAuthMember':
      await oauthMemberSignup(data);
      break;
    case 'Member':
      await memberSignup(data);
      break;
    case 'Event':
      await eventRegistration(data);
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
