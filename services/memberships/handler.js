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
  const stripe = require('stripe')('sk_test_51JA6l6IdCDOBxPHdMUdOuzrsVB3myE5yFtiyxJOHalCNtBZXAyshjBtKDV8qwMFPUjFoVGE9PphCSjSnGyZ33xcw00s3zKJr0g');
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
    mode: 'payment',
    success_url: `https://google.ca`,
    cancel_url: `https://facebook.com`,
  });
  let response = helpers.redirectResponse(303, session.url);
  callback(null, response);
  return null;
}
