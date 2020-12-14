import crypto from 'crypto';
import inviteHelpers from './helpers';
import helpers from '../../lib/helpers';
import db from '../../lib/db';
import { USER_INVITE_CODES_TABLE } from '../../constants/tables';

export const invite = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);
    helpers.checkPayloadProps(data, {
      email: { required: true }
    });

    const id = crypto.randomBytes(20).toString('hex');
    const item = { id, email: data.email };

    const res = await db.create(item, USER_INVITE_CODES_TABLE);

    const msg = {
      to: data.email,
      templateId: 'd-198cfc5057914538af105ef469f51217',
      dynamic_template_data: {
        url: 'https://app.ubcbiztech.com/invite/'+id // TODO: Fix url format based on frontend implementation
      }
    };

    inviteHelpers.sendEmail(msg);

    const response = helpers.createResponse(200, {
      message: 'Invite code created & sent to ' + data.email,
      response: res
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};
