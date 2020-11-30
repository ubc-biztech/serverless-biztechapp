import helpers from '../../lib/helpers';

export const hello = async () => {

  return helpers.createResponse(200, {
    message: 'Yeet!'
  });

};
