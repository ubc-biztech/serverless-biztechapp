import registrationHelpers from './helpers';
import helpers from '../../lib/handlerHelpers';
import { isValidEmail } from '../../lib/utils';

/*
  Returns Status Code 403 if a QR scan is not valid for whatever reason
  Returns Status Code 200 when QR code is scanned successfully
*/

// Endpoint: POST /qr
export const post = async (event, ctx, callback) => {

  /* Processes a QR code scan and tries to update the user's points in the Registrations database

  Args:
    event (object): object containing the request body, params, headers, etc. (refer to checkPayloadProps)
    ctx (object): object containing the context of the request
    callback (function): callback function to return the response

  Returns:
      response (object): object containing the response body, params, headers (status code), etc.
   */

  try {

    const data = JSON.parse(event.body);

    if(!isValidEmail(data.email)) throw helpers.inputError('Invalid email', data.email);
    helpers.checkPayloadProps(data, {
      qrCodeID: { required: true, type: 'string' },
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
      email: { required: true , type: 'string' },
      admin: { required: false , type: 'boolean' }, // TODO: Admin possibility if gated actions required in the future
    });

    await registrationHelpers.qrScanPostHelper(data, data.email).then(res => {

      if (res.redeemed_points === -1) {

        const response_fail = helpers.createResponse(403, {
          message: 'QR code already scanned.',
          'response': res
        });

        callback(null, response_fail);
        return response_fail;

      }

      const response_success = helpers.createResponse(200,
        {
          'message': 'Successfully scanned QR code.',
          'response': res
        });

      callback(null, response_success);
      return response_success;

    });

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};
