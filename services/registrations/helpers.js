import docClient from "../../lib/docClient";
import {
  EVENTS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import sgMail from "@sendgrid/mail";
import db from "../../lib/db";
const ics = require("ics");

sgMail.setApiKey(process.env.SENDGRID_KEY);

export default {
  /**
	 * Takes a semicolon separated event ID and year and returns an object containing
	 * registeredCount, checkedInCount and waitlistCount for that event
	 * @param {String} eventIDAndYear
	 * @return {registeredCount checkedInCount waitlistCount}
	 */
  getEventCounts: async function(eventID, year) {
    try {
      const event = await db.getOne(eventID, EVENTS_TABLE, {
        year: year
      });

      if (!event) {
        console.error("Event not found:", eventID, year);
        return {
          registeredCount: 0,
          checkedInCount: 0,
          waitlistCount: 0,
          dynamicCounts: []
        };
      }

      const cappedQuestions = [];
      console.log("Event:", event);

      if (event.registrationQuestions && Array.isArray(event.registrationQuestions)) {
        event.registrationQuestions.forEach(question => {
          console.log("Question:", question);
          if (question.participantCap) {
            const choices = question.choices.split(",");
            const caps = question.participantCap.split(",");
            const cappedQuestionObject = {
              questionId: question.questionId,
              caps: choices.map((choice, i) => {
                return {
                  label: choice,
                  cap: parseInt(caps[i])
                };
              })
            };
            cappedQuestions.push(cappedQuestionObject);
          }
        });
      }

      const eventIDYear = eventID + ";" + year;
      const keyCondition = {
        expression: "#eventIDYear = :query",
        expressionNames: {
          "#eventIDYear": "eventID;year"
        },
        expressionValues: {
          ":query": eventIDYear
        }
      };

      const result = await db.query(USER_REGISTRATIONS_TABLE, "event-query", keyCondition);

      let counts = {
        registeredCount: 0,
        checkedInCount: 0,
        waitlistCount: 0,
        dynamicCounts: cappedQuestions.map(question => {
          return {
            questionId: question.questionId,
            counts: question.caps.map(cap => {
              return {
                label: cap.label,
                count: 0,
                cap: cap.cap
              };
            })
          };
        })
      };

      if (Array.isArray(result)) {
        result.forEach((item) => {
          if (item.isPartner === undefined || !item.isPartner) {
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

          if (cappedQuestions.length > 0 && item.dynamicResponses) {
            cappedQuestions.forEach(question => {
              const response = item.dynamicResponses[`${question.questionId}`];
              if (response) {
                const dynamicCount = counts.dynamicCounts.find(count => count.questionId === question.questionId);
                if (dynamicCount) {
                  const workshopCount = dynamicCount.counts.find(q => q.label === response);
                  if (workshopCount) {
                    workshopCount.count += 1;
                  }
                }
              }
            });
          }
        });
      }

      return counts;
    } catch (error) {
      console.error("Error in getEventCounts:", error);
      return {
        registeredCount: 0,
        checkedInCount: 0,
        waitlistCount: 0,
        dynamicCounts: []
      };
    }
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
    // parse start and end dates into event duration object (hours, minutes, seconds)
    startDate = new Date(startDate);
    endDate = new Date(endDate);

    // startDateArray follows format [year, month, day, hour, minute]
    const startDateArray = [
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      startDate.getDate(),
      startDate.getHours(),
      startDate.getMinutes()
    ];
    // startDateArray follows format [year, month, day, hour, minute]
    const startDateArray = [
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      startDate.getDate(),
      startDate.getHours(),
      startDate.getMinutes()
    ];

    const endDateArray = [
      endDate.getFullYear(),
      endDate.getMonth() + 1,
      endDate.getDate(),
      endDate.getHours(),
      endDate.getMinutes()
    ];

    const eventDetails = {
      title: ename,
      description,
      location: elocation,
      startInputType: "local",
      start: startDateArray,
      end: endDateArray,
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
    if (error) {
      console.log(error);
      return error;
    }

    // convert ics to base64
    const base64 = Buffer.from(value).toString("base64");
    const base64Cal = base64.toString("base64");

    const attachments = user.isPartner !== undefined || user.isPartner ? [] : [
      {
        name: "invite.ics",
        filename: "invite.ics",
        type: "text/calendar;method=REQUEST",
        content: base64Cal,
        disposition: "attachment"
      }
    ];

    // send the email for the calendar invite
    // for the qr code email, go to handlers.js
    const msg = {
      to: user.id,
      from: {
        email: "info@ubcbiztech.com",
        name: "UBC BizTech"
      },
      attachments,
      dynamic_template_data: dynamicCalendarMsg.dynamic_template_data,
      templateId: dynamicCalendarMsg.templateId
    };
    // send the email for the calendar invite
    // for the qr code email, go to handlers.js
    const msg = {
      to: user.id,
      from: {
        email: "info@ubcbiztech.com",
        name: "UBC BizTech"
      },
      attachments,
      dynamic_template_data: dynamicCalendarMsg.dynamic_template_data,
      templateId: dynamicCalendarMsg.templateId
    };

    return sgMail.send(msg);
  }
};
