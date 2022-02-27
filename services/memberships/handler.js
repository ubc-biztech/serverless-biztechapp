import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
const stripe = require("stripe")(
  "sk_test_51KOxOlBAxwbCreS7JRQtvZCnCgLmn8tjK7WPHDGjpw0s4vfVHLwbcrZZvQLmd5cY7zKRIsfj3pnEDDHTy3G81Tuf00v9ygIBrC"
);
// development endpoint secret - switch to live secret key in production
const endpointSecret = "whsec_TYSFr29HQ4bIPu649lgkxOrlPjrDOe2l";
const { MEMBERSHIPS_TABLE } = require("../../constants/tables");
export const getAll = async (event, ctx, callback) => {
  try {
    // scan the table
    const memberships = await db.scan(MEMBERSHIPS_TABLE);

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

export const webhook = async (event, ctx, callback) => {
  const sig = event.headers["Stripe-Signature"];
  let eventData;
  console.log(event.body);

  // Stripe returns an error if verification fails
  try {
    eventData = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    return helpers.createResponse(400, {
      message: `Webhook Error: ${err.message}`,
    });
  }

  // Handle the checkout.session.completed event
  if (eventData.type == "checkout.session.completed") {
    console.log(eventData.data);
  }

  let response = helpers.createResponse(200, {});
  callback(null, response);
  return null;
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export const payment = async (event, ctx, callback) => {
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
      // event.body
      order_id: "12345",
      student_number: "1234567",
      first_name: "John",
      last_name: "Cena",
      test_test: "test",
      // education2: event.education.value,
      // education3: event.body.education.value,
      // id: ctx.id,
      // id2: ctx.body.id,
      // education0: ctx.education,
      // education1: ctx.body.education,
      // education3: event.education,
      // email: event.body.email,
    },
    mode: "payment",
    success_url: "https://app.ubcbiztech.com/signup/success",
    cancel_url: "https://facebook.com",
  });
  let response = helpers.createResponse(200, session.url);
  callback(null, response);
  return null;
};
