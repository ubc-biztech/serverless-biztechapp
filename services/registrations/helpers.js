import AWS from 'aws-sdk';
import { USER_REGISTRATIONS_TABLE } from '../../constants/tables';
import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_KEY);

export default {
  /**
   * Takes a semicolon separated event ID and year and returns an object containing
   * registeredCount, checkedInCount and waitlistCount for that event
   * @param {String} eventIDAndYear
   * @return {registeredCount checkedInCount waitlistCount}
   */
  getEventCounts: async function (eventIDAndYear) {

    const docClient = new AWS.DynamoDB.DocumentClient();
    const params = {
      TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
      FilterExpression: '#eventIDYear = :query',
      ExpressionAttributeNames: {
        '#eventIDYear': 'eventID;year'
      },
      ExpressionAttributeValues: {
        ':query': eventIDAndYear
      }
    };
    return await docClient
      .scan(params)
      .promise()
      .then(result => {

        let counts = {
          registeredCount: 0,
          checkedInCount: 0,
          waitlistCount: 0
        };

        result.Items.forEach(item => {

          switch (item.registrationStatus) {

          case 'registered':
            counts.registeredCount++;
            break;
          case 'checkedIn':
            counts.checkedInCount++;
            break;
          case 'waitlist':
            counts.waitlistCount++;
            break;

          }

        });

        return counts;

      })
      .catch(error => {

        console.error(error);
        return null;

      });

  },
  sendEmail: (msg) => {

    if (!msg.from) {

      // default from address
      msg.from = 'info@ubcbiztech.com';

    }

    if (process.env.ENVIRONMENT === 'PROD') {

      // Production emails are okay to send
      return sgMail.send(msg);

    } else {

      // Dev/staging emails should only be sent to ubcbiztech emails
      // This is to reduce accidental test emails being sent to random addresses
      // and prevent us from being marked as spam. Redirect to dev@ubcbiztech.com
      if (msg.to.includes('@ubcbiztech.com')) {

        return sgMail.send(msg);

      } else {

        msg.to = 'dev@ubcbiztech.com';
        return sgMail.send(msg);

      }

    }

  }
};
