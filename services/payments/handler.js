import helpers from "../../lib/handlerHelpers";
import { isEmpty, isValidEmail } from "../../lib/utils";
import { updateHelper } from "../registrations/handler";
import db from "../../lib/db";

import {
  MEMBERS_TABLE,
  EVENTS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
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

const parseTopics = (topics) =>
  (Array.isArray(topics) ? topics : (topics || "").split(","))
    .map((topic) => topic.trim())
    .filter(Boolean);

const parseBoolean = (value) =>
  value === true || ["true", "yes", "1"].includes(String(value).toLowerCase());

const publicProfileType = (email) =>
  email.endsWith("@ubcbiztech.com") ? PROFILE_TYPES.EXEC : PROFILE_TYPES.ATTENDEE;

const putIfMissing = async (item, table) => {
  const existing = await db.getOne(item.id, table);
  if (!isEmpty(existing)) return existing;

  try {
    await db.put(item, table, true);
    return item;
  } catch (error) {
    // A concurrent/retried Stripe webhook may have created it after the read.
    if (error.type === "ConditionalCheckFailedException") {
      return db.getOne(item.id, table);
    }
    throw error;
  }
};

// Creates the member here
export const webhook = async (event) => {
  const membershipSignup = async (data) => {
    const timestamp = Date.now();
    const email = data.email.toLowerCase();
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
      prevMember: parseBoolean(data.prev_member),
      international: parseBoolean(data.international),
      topics: parseTopics(data.topics),
      diet: data.diet,
      heardFrom: data.heard_from || data.referral,
      heardFromSpecify: data.heardFromSpecify,
      university: data.university || data.education,
      highSchool: data.high_school,
      admin: email.endsWith("@ubcbiztech.com"),
      cardCount: 0,
      profileType: publicProfileType(email),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    try {
      await putIfMissing(memberParams, MEMBERS_TABLE);
      return helpers.createResponse(201, { message: "Created membership!" });
    } catch (error) {
      console.log(error);
      return helpers.createResponse(502, "Internal Server Error occurred");
    }
  };

  const eventRegistration = async (data) => {
    try {
      let updatedRegistrationStatus = "registered";

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

      if (
        result[0].registrationStatus === "accepted" ||
        result[0].registrationStatus === "acceptedPending"
      ) {
        updatedRegistrationStatus = "acceptedComplete"; // ad hoc case for application based events
      }

      const body = {
        eventID: data.eventID,
        year: Number(data.year),
        registrationStatus: updatedRegistrationStatus
      };
      await updateHelper(body, false, data.email, data.fname, true);
      const response = helpers.createResponse(200, {
        message: "Registered user after successful payment"
      });
      return response;
    } catch (err) {
      console.log(err);
      return helpers.createResponse(500, { message: err.message || err });
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
    case "Member":
      return membershipSignup(data);
    case "Event":
      return eventRegistration(data);
    default:
      return helpers.createResponse(400, {
        message: "Webhook Error: unidentified payment type"
      });
    }
  }

  return helpers.createResponse(200, {
    message: `Ignored Stripe event type ${eventData.type}`
  });
};

export const payment = async (event) => {
  try {
    let data = JSON.parse(event.body);
    if (data.email) {
      data.email = data.email.toLowerCase();
    }

    const isEvent = data.paymentType === "Event";

    let unit_amount;
    if (isEvent) {
      // determine price for event based on Biztech membership status
      const [event, member] = await Promise.all([
        db.getOne(data.eventID, EVENTS_TABLE, { year: Number(data.year) }),
        db.getOne(data.email, MEMBERS_TABLE)
      ]);

      if (isEmpty(event)) {
        throw helpers.notFoundResponse("event", data.eventID);
      }

      const isMember = !isEmpty(member);
      const samePricing = event.pricing.members === event.pricing.nonMembers;
      unit_amount =
          (isMember ? event.pricing.members : event.pricing.nonMembers) * 100;
      data.paymentName = `${event.ename} ${
        isMember || samePricing ? "" : "(Non-member)"
      }`;

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
    return response;
  } catch (err) {
    console.log(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

export const cancel = async (event) => {
  // NOTE: cancel webhook currently only operates correctly for events i.e. payment incomplete
  const sig = event.headers["Stripe-Signature"];
  const eventData = stripe.webhooks.constructEvent(
    event.body,
    sig,
    cancelSecret
  );
  const data = eventData.data.object.metadata;
  const { paymentType } = data;
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

      return response;
    } catch (err) {
      return helpers.createResponse(500, { message: err.message || err });
    }
  } else {
    return helpers.createResponse(400, {
      message: "Webhook Error: unidentified payment type"
    });
  }
};
