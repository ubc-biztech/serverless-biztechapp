import helpers from "../../lib/handlerHelpers";
import { isEmpty, isValidEmail } from "../../lib/utils";
import { updateHelper } from "../registrations/handler";
import registrationHelpers from "../registrations/helpers";
import db from "../../lib/db";
import { CognitoIdentityProvider } from "@aws-sdk/client-cognito-identity-provider";

import {
  USERS_TABLE,
  MEMBERS2026_TABLE,
  EVENTS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import { createProfile } from "../profiles/helpers";
import { PROFILE_TYPES } from "../profiles/constants";
import { MEMBERSHIP_PRICE } from "./constants";

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
    const email = data.email.toLowerCase();

    let isBiztechAdmin = false;

    //assume the created user is biztech admin if using biztech email
    if (
      email.substring(email.indexOf("@") + 1, email.length) === "ubcbiztech.com"
    ) {
      isBiztechAdmin = true;
    }

    const userParams = {
      id: email,
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
    };

    const memberParams = {
      id: email,
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
    };

    try {
      await db.put(userParams, USERS_TABLE, true);
    } catch (error) {
      let response;
      if (error.type === "ConditionalCheckFailedException") {
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
    }

    try {
      await db.put(memberParams, MEMBERS2026_TABLE, true);
      await createProfile(
        email,
        email.endsWith("@ubcbiztech.com")
          ? PROFILE_TYPES.EXEC
          : PROFILE_TYPES.ATTENDEE
      );
    } catch (error) {
      let response;
      console.log(error);
      if (error.type === "ConditionalCheckFailedException") {
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
    }

    const response = helpers.createResponse(201, {
      message: "Created user and member!"
    });
    callback(null, response);
  };
  const userMemberSignup = async (data) => {
    const cognito = new CognitoIdentityProvider({
      // The key apiVersion is no longer supported in v3, and can be removed.
      // @deprecated The client uses the "latest" apiVersion.
      apiVersion: "2016-04-18"
    });

    const normalizedEmail = data.email.toLowerCase();

    const cognitoParams = {
      ClientId: "5tc2jshu03i3bmtl1clsov96dt",
      Username: normalizedEmail,
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

    await cognito.signUp(cognitoParams);

    await OAuthMemberSignup({
      ...data,
      email: normalizedEmail
    });
  };

  const memberSignup = async (data) => {
    const timestamp = new Date().getTime();

    const email = data.email.toLowerCase();

    let isBiztechAdmin = false;

    //assume the created user is biztech admin if using biztech email
    if (
      email.substring(email.indexOf("@") + 1, email.length) === "ubcbiztech.com"
    ) {
      isBiztechAdmin = true;
    }

    const userParams = {
      email: email,
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
      id: email,
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

    await db.put(memberParams, MEMBERS2026_TABLE, true).catch((error) => {
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
    await createProfile(
      email,
      email.endsWith("@ubcbiztech.com")
        ? PROFILE_TYPES.EXEC
        : PROFILE_TYPES.ATTENDEE
    ).catch((error) => {
      console.error(error);

      let response;

      response = helpers.createResponse(
        207,
        `Profile for ${email} was not created, but member created and updated user!`
      );

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

      const keyCondition = {
        expression: "id = :id AND #eventIDYear = :eventIDYear",
        expressionNames: {
          "#eventIDYear": "eventID;year"
        },
        expressionValues: {
          ":id": data.email,
          ":eventIDYear": eventIDAndYear
        }
      };

      const result = await db.query(
        USER_REGISTRATIONS_TABLE,
        "event-query",
        keyCondition
      );
      console.log(JSON.stringify(result, null, 2));

      const currentReg = result[0];
      let updatedApplicationStatus;
      let updatedRegistrationStatus;

      if (currentReg.registrationStatus === "PAYMENTPENDING") {
        updatedApplicationStatus = "ACCEPTED";
        updatedRegistrationStatus = "COMPLETE";
      }
      // HANDLE LEGACY STATUSES
      else if (currentReg.registrationStatus === "accepted" ||
               currentReg.registrationStatus === "acceptedPending") {
        updatedApplicationStatus = "ACCEPTED";
        updatedRegistrationStatus = "COMPLETE";
      }
      // fallback case
      else {
        updatedApplicationStatus = "ACCEPTED";
        updatedRegistrationStatus = "COMPLETE";
      }

      const body = {
        eventID: data.eventID,
        year: Number(data.year),
        applicationStatus: updatedApplicationStatus,
        registrationStatus: updatedRegistrationStatus
      };
      await updateHelper(body, false, data.email, data.fname, true);
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
    data.email = data.email.toLowerCase();

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
    let data = JSON.parse(event.body);
    if (data.email) {
      data.email = data.email.toLowerCase();
    }

    const isEvent = data.paymentType === "Event";

    let unit_amount;
    if (isEvent) {
      // determine price for event based on Biztech membership status
      const [event, user] = await Promise.all([
        db.getOne(data.eventID, EVENTS_TABLE, { year: Number(data.year) }),
        db.getOne(data.email, USERS_TABLE)
      ]);

      if (isEmpty(event)) {
        throw helpers.notFoundResponse("event", data.eventID);
      }

      // Special tiered pricing for blueprint;2026
      // https://github.com/ubc-biztech/serverless-biztechapp/pull/631
      // Remove from codebase after blueprint 2026 (REVERT PR #631)
      if (data.eventID === "blueprint" && Number(data.year) === 2026) {
        const counts = await registrationHelpers.getEventCounts(
          data.eventID,
          Number(data.year)
        );
        const registered = counts?.registeredCount ?? 0;
        // Early Bird $15 - first 30
        // Regular $25  - next 150 (up to 180)
        // Last Min $35 - next 50  (up to 230)
        if (registered < 30) {
          unit_amount = 1500; // cents
          data.paymentName = `${event.ename} (Early Bird)`;
        } else if (registered < 180) {
          unit_amount = 2500;
          data.paymentName = `${event.ename} (Regular)`;
        } else {
          unit_amount = 3500;
          data.paymentName = `${event.ename} (Last Minute)`;
        }
      } else {
        const isMember = !isEmpty(user) && user.isMember;
        const samePricing = event.pricing.members === event.pricing.nonMembers;
        unit_amount =
          (isMember ? event.pricing.members : event.pricing.nonMembers) * 100;
        data.paymentName = `${event.ename} ${
          isMember || samePricing ? "" : "(Non-member)"
        }`;
      }

      data = {
        ...data,
        paymentImages: [event.imageUrl]
      };
    } else {
      // determine price for membership based on UBC student status
      const isUBCStudent = data.education === "UBC";
      unit_amount = isUBCStudent ? MEMBERSHIP_PRICE - 300 : MEMBERSHIP_PRICE;
    }

    const { paymentImages } = data;
    delete data.paymentImages; // remove from metadata

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
            unit_amount
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

    if (isEvent) {
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
  const email = data.email ? data.email.toLowerCase() : data.email;
  const { eventID, year, paymentType } = data;
  if (paymentType === "Event") {
    try {
      // const eventIDAndYear = eventID + ";" + year;

      // const res = await db.deleteOne(email, USER_REGISTRATIONS_TABLE, {
      //   ["eventID;year"]: eventIDAndYear
      // });

      const response = helpers.createResponse(200, {
        message: "Cancel webhook disabled",
        response: {}
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
