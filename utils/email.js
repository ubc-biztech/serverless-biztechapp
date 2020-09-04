const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_KEY);

// Returns a promise
module.exports.send = (msg) => {

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

};
