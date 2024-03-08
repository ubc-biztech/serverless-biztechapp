import helpers from "../../lib/handlerHelpers";
import {
  isValidEmail
} from "../../lib/utils";
import {
  updateHelper
} from "../registrations/handler";
import db from "../../lib/db";
import docClient from "../../lib/docClient";
const AWS = require("aws-sdk");
const {
  USERS_TABLE,
  MEMBERS2024_TABLE,
  USER_REGISTRATIONS_TABLE
} = require("../../constants/tables");
const stripe = require("stripe")(
  process.env.ENVIRONMENT === "PROD"
    ? process.env.STRIPE_PROD_KEY
    : process.env.STRIPE_DEV_KEY
);

// endpoint secret - different for each webhook
const endpointSecret =
  process.env.ENVIRONMENT === "PROD"
    ? process.env.STRIPE_PROD_ENDPOINT
    : process.env.STRIPE_DEV_ENDPOINT;
const cancelSecret =
  process.env.ENVIRONMENT === "PROD"
    ? process.env.STRIPE_PROD_CANCEL
    : process.env.STRIPE_DEV_CANCEL;

// Creates the member here
export const webhook = async (event, ctx, callback) => {
  const OAuthMemberSignup = async (data) => {
    const timestamp = new Date().getTime();
    const email = data.email;

    let isBiztechAdmin = false;

    //assume the created user is biztech admin if using biztech email
    if (
      email.substring(email.indexOf("@") + 1, email.length) === "ubcbiztech.com"
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
        admin: isBiztechAdmin
      },
      TableName:
        USERS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ConditionExpression: "attribute_not_exists(id)"
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
        topics: data.topics.split(","),
        diet: data.diet,
        heardFrom: data.heard_from,
        heardFromSpecify: data.heardFromSpecify,
        university: data.university,
        highSchool: data.high_school,
        admin: isBiztechAdmin,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      TableName:
        MEMBERS2024_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ConditionExpression: "attribute_not_exists(id)"
    };

    await docClient
      .put(userParams)
      .promise()
      .catch((error) => {
        let response;
        if (error.code === "ConditionalCheckFailedException") {
          response = helpers.createResponse(
            409,
            "User could not be created because email already exists"
          );
        } else {
          response = helpers.createResponse(
            502,
            "Internal Server Error occurred"
          );
        }
        callback(null, response);
      });
    await docClient
      .put(memberParams)
      .promise()
      .catch((error) => {
        let response;
        if (error.code === "ConditionalCheckFailedException") {
          response = helpers.createResponse(
            409,
            "Member could not be created because email already exists"
          );
        } else {
          response = helpers.createResponse(
            502,
            "Internal Server Error occurred"
          );
        }
        callback(null, response);
      });

    const response = helpers.createResponse(201, {
      message: "Created user and member!"
    });
    callback(null, response);
  };
  const userMemberSignup = async (data) => {
    const cognito = new AWS.CognitoIdentityServiceProvider({
      apiVersion: "2016-04-18"
    });

    const cognitoParams = {
      ClientId: "5tc2jshu03i3bmtl1clsov96dt",
      Username: data.email,
      UserAttributes: [
        {
          Name: "name",
          Value: data.fname + " " + data.lname
        },
        {
          Name: "custom:student_id",
          Value: data.student_number
        }
      ],
      Password: data.password
    };

    await cognito.signUp(cognitoParams).promise();

    await OAuthMemberSignup(data);
  };

  const memberSignup = async (data) => {
    const timestamp = new Date().getTime();

    const email = data.email;

    let isBiztechAdmin = false;

    //assume the created user is biztech admin if using biztech email
    if (
      email.substring(email.indexOf("@") + 1, email.length) === "ubcbiztech.com"
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
      admin: isBiztechAdmin
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
        topics: data.topics.split(","),
        diet: data.diet,
        heardFrom: data.heard_from,
        heardFromSpecify: data.heardFromSpecify,
        university: data.university,
        highSchool: data.high_school,
        admin: isBiztechAdmin,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      TableName:
        MEMBERS2024_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ConditionExpression: "attribute_not_exists(id)"
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
    await docClient
      .put(memberParams)
      .promise()
      .catch((error) => {
        let response;
        if (error.code === "ConditionalCheckFailedException") {
          response = helpers.createResponse(
            409,
            "Member could not be created because email already exists"
          );
        } else {
          response = helpers.createResponse(
            502,
            "Internal Server Error occurred"
          );
        }
        callback(null, response);
      });

    const response = helpers.createResponse(201, {
      message: "Created member and updated user!"
    });
    callback(null, response);
  };

  const eventRegistration = async (data) => {
    try {
      const eventIDAndYear = data.eventID + ";" + data.year;

      const body = {
        eventID: data.eventID,
        year: Number(data.year),
        registrationStatus:
          eventIDAndYear === "produhacks;2023" ? "waitlist" : "registered"
      };
      await updateHelper(body, false, data.email, data.fname);
      const response = helpers.createResponse(200, {
        message: "Registered user after successful payment"
      });
      callback(null, response);
    } catch (err) {
      console.log(err);
      callback(err, null);
    }
  };

  const sig = event.headers["Stripe-Signature"];

  let eventData;

  try {
    eventData = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    return helpers.createResponse(400, {
      message: `Webhook Error: ${err}`
    });
  }

  if (eventData.type === "checkout.session.completed") {
    const data = eventData.data.object.metadata;

    if (!isValidEmail(data.email)) {
      return helpers.inputError("Invalid email", data.email);
    }

    switch (data.paymentType) {
    case "UserMember":
      await userMemberSignup(data);
      break;
    case "OAuthMember":
      await OAuthMemberSignup(data);
      break;
    case "Member":
      await memberSignup(data);
      break;
    case "Event":
      await eventRegistration(data);
      break;
    default:
      return helpers.createResponse(400, {
        message: "Webhook Error: unidentified payment type"
      });
    }
  }
};

export const payment = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    const {
      paymentImages
    } = data;
    delete data.paymentImages;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "CAD",
            product_data: {
              name: data.paymentName,
              images: paymentImages
            },
            unit_amount: data.paymentPrice
          },
          quantity: 1
        }
      ],
      metadata: data,
      mode: "payment",
      success_url: data.success_url,
      cancel_url: data.cancel_url,
      expires_at: Math.round(new Date().getTime() / 1000) + 1800,
      allow_promotion_codes: true
    });

    if (data.paymentType === "Event") {
      const body = {
        eventID: data.eventID,
        year: Number(data.year),
        checkoutLink: session.url
      };
      await updateHelper(body, false, data.email, data.fname);
    }

    let response = helpers.createResponse(200, session.url);
    callback(null, response);
    return null;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

export const cancel = async (event, ctx, callback) => {
  // NOTE: cancel webhook currently only operates correctly for events i.e. payment incomplete
  const sig = event.headers["Stripe-Signature"];
  const eventData = stripe.webhooks.constructEvent(
    event.body,
    sig,
    cancelSecret
  );
  const data = eventData.data.object.metadata;
  const {
    email, eventID, year, paymentType
  } = data;
  if (paymentType === "Event") {
    try {
      // const eventIDAndYear = eventID + ";" + year;

      // const res = await db.deleteOne(email, USER_REGISTRATIONS_TABLE, {
      //   ["eventID;year"]: eventIDAndYear
      // });

      const response = helpers.createResponse(200, {
        message: "Cancel webhook disabled",
        response: {
        }
      });

      callback(null, response);
      return null;
    } catch (err) {
      callback(null, err);
      return null;
    }
  } else {
    return helpers.createResponse(400, {
      message: "Webhook Error: unidentified payment type"
    });
  }
};
