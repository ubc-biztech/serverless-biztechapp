import AWS from "../../lib/aws";
import {
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import sgMail from "@sendgrid/mail";
const ics = require("ics");

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
      TableName:
        USER_REGISTRATIONS_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      FilterExpression: "#eventIDYear = :query",
      ExpressionAttributeNames: {
        "#eventIDYear": "eventID;year"
      },
      ExpressionAttributeValues: {
        ":query": eventIDAndYear
      }
    };
    return await docClient
      .scan(params)
      .promise()
      .then((result) => {
        let counts = {
          registeredCount: 0,
          checkedInCount: 0,
          waitlistCount: 0
        };

        result.Items.forEach((item) => {
          if (!item.isPartner) {
            switch (item.registrationStatus) {
            case "registered":
              counts.registeredCount++;
              break;
            case "checkedIn":
              counts.checkedInCount++;
              break;
            case "waitlist":
              counts.waitlistCount++;
              break;
            }
          }
        });

        return counts;
      })
      .catch((error) => {
        console.error(error);
        return null;
      });
  },
  sendDynamicQR: (msg) => {
    if (!msg.from) {
      // default from address
      msg.from = "info@ubcbiztech.com";
    }

    // in the future if you want to restrict to prod, use process.env.ENVIRONMENT === 'PROD'
    return sgMail.send(msg);
  },
  sendCalendarInvite: async (event, user, dynamicCalendarMsg) => {
    let {
      ename, description, elocation, startDate, endDate
    } = event;

    // parse start and end dates into event duration object (hours, minutes, seconds)
    startDate = new Date(startDate);
    endDate = new Date(endDate);

    const duration = {
      hours: endDate.getHours() - startDate.getHours(),
      minutes: endDate.getMinutes() - startDate.getMinutes(),
      seconds: endDate.getSeconds() - startDate.getSeconds()
    };

    // convert startDate from PST/PDT to UTC (to avoid AWS-dependent local time conversion)
    // check if PST or PDT — below implementation not complete

    // const isPDT = startDate.getTimezoneOffset() === 420;
    // const offset = isPDT ? 420 : 480;
    // startDate.setMinutes(startDate.getMinutes() + offset);

    // startDateArray follows format [year, month, day, hour, minute]
    const startDateArray = [
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      startDate.getDate(),
      startDate.getHours(),
      startDate.getMinutes()
    ];

    const eventDetails = {
      title: ename,
      description,
      location: elocation,
      startInputType: "local",
      start: startDateArray,
      // end: [2021, 2, 3],
      duration,
      status: "CONFIRMED",
      busyStatus: "BUSY",
      productId: "BizTech",
      url: "https://www.ubcbiztech.com",
      organizer: {
        name: "UBC BizTech",
        email: "info@ubcbiztech.com"
      },
      attendees: [
        {
          name: user.firstName + " " + user.lastName,
          email: user.id,
          rsvp: true,
          partstat: "NEEDS-ACTION",
          role: "REQ-PARTICIPANT"
        },
        {
          name: "UBC BizTech",
          email: "info@ubcbiztech.com",
          rsvp: true,
          partstat: "ACCEPTED",
          role: "CHAIR"
        }
      ],
      method: "REQUEST"
    };

    const {
      error, value
    } = ics.createEvent(eventDetails);

    if (error) {
      console.log(error);
      return error;
    }

    // convert ics to base64
    const base64 = Buffer.from(value).toString("base64");
    const base64Cal = base64.toString("base64");

    // send the email for the calendar invite
    // for the qr code email, go to handlers.js
    const msg = {
      to: user.id,
      from: {
        email: "info@ubcbiztech.com",
        name: "UBC BizTech"
      },
      attachments: [
        {
          name: "invite.ics",
          filename: "invite.ics",
          type: "text/calendar;method=REQUEST",
          content: base64Cal,
          disposition: "attachment"
        }
      ],
      dynamic_template_data: dynamicCalendarMsg.dynamic_template_data,
      templateId: dynamicCalendarMsg.templateId
    };

    return sgMail.send(msg);
  }
};
