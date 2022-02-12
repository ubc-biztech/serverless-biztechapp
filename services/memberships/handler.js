import helpers from '../../lib/handlerHelpers';
import db from '../../lib/db';
const { MEMBERSHIPS_TABLE } = require('../../constants/tables');
export const getAll = async(event, ctx, callback) => {

  try {

    // scan the table
    const memberships = await db.scan(MEMBERSHIPS_TABLE);

    // re-organize the response
    let response = {};
    if (memberships !== null) response = helpers.createResponse(200, memberships);

    // return the response object
    callback(null, response);
    return null;

  } catch (err) {

    callback(null, err);
    return null;

  }

};

export const payment = async(event, ctx, callback) => {
  const stripe = require('stripe')('sk_test_51KOxOlBAxwbCreS7JRQtvZCnCgLmn8tjK7WPHDGjpw0s4vfVHLwbcrZZvQLmd5cY7zKRIsfj3pnEDDHTy3G81Tuf00v9ygIBrC');
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'CAD',
          product_data: {
            name: 'BizTech Membership',
            images: ['https://imgur.com/TRiZYtG.png'],
          },
          unit_amount: 500,
        },
        quantity: 1,
      },
    ],
    // metadata: event.body,
    mode: 'payment',
    success_url: `https://app.ubcbiztech.com/signup/success`,
    cancel_url: `https://facebook.com`,
  });
  let response = helpers.createResponse(200, session.url);
  callback(null, response);
  return null;
}
