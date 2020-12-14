import AWS from 'aws-sdk';
import helpers from '../../lib/helpers';

export const create = async (event, ctx, callback) => {

  const cognito = new AWS.CognitoIdentityServiceProvider();

  try {

    console.log(event.requestContext.authorizer);

    const identity = event.requestContext.authorizer.claims;
    const { email } = identity;

    // verify this was called by an email with @ubcbiztech.com
    if(!(email.substring(email.indexOf('@') + 1, email.length) === 'ubcbiztech.com')) {

      const response = helpers.createResponse(403, 'Could not assign user as an admin');
      callback(null, response);

    } else {

      const params = {
        GroupName: 'admin',
        UserPoolId: 'us-west-2_w0R176hhp',
        Username: identity['cognito:username']
      };

      await cognito.adminAddUserToGroup(params).promise();
      const response = helpers.createResponse(200, 'Success');
      callback(null, response);

    }

  }
  catch(err) {

    console.error(err);
    const response = helpers.createResponse(502, { message: 'Error setting user as admin', error: err });
    callback(null, response);

  }

};
