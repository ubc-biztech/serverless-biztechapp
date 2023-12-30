import AWS from "aws-sdk";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  logoBase64
} from "./constants";
import {
  getDefaultCalendarInviteTemplate, getPartnerCalendarInviteTemplate
} from "./templates/calendarInviteTemplates";
import {
  getDefaultQRTemplate, getRegisteredQRTemplate
} from "./templates/dynamicQRTemplates";
const ics = require("ics");

export default class SESEmailService {
  constructor({
    accessKeyId, secretAccessKey, region = "us-west-2"
  }) {
    this.ses = new AWS.SES({
      apiVersion: "2010-12-01",
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      region: region
    });
    this.transporter = nodemailer.createTransport({
      SES: this.ses
    });
  }

  // TODO: Enable clients to build their own email template and send it (html formatter FE feature)
  createEmailTemplate(templateName, subject, htmlBody) {
    this.ses.createTemplate({
      Template: {
        TemplateName: templateName,
        SubjectPart: subject,
        HtmlPart: htmlBody
      }
    }, (err, data) => {
      if (err) {
        console.log(err, err.stack);
      } else {
        console.log(data);
      }
    });
  }

  async sendCalendarInvite(event, user) {
    let {
      ename, eventID, year, description, elocation, startDate, endDate, imageUrl
    } = event;
    let {
      fname, id, isPartner
    } = user;

    const emailParams = {
      fname,
      ename,
      imageUrl,
      logoBase64
    };
    const rawHtml = user.isPartner ?
      getPartnerCalendarInviteTemplate(emailParams)
      : getDefaultCalendarInviteTemplate(emailParams);

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
      method: "REQUEST"
    };

    const {
      error, value
    } = ics.createEvent(eventDetails);

    if (error) {
      console.log(error);
      return error;
    }
    // Email details
    // TODO: refactor to pass in template to make this method more reusuable
    let mailOptions = {
      from: "dev@ubcbiztech.com",
      to: id,
      subject: `[BizTech Confirmation] ${ename} on ${startDate}`,
      html: rawHtml,
      attachDataUrls: true,
      icalEvent: {
        filename: "invitation.ics",
        method: "request",
        content: value
      }
    };

    if (isPartner) {
      const qr = (await QRCode.toDataURL(`${id};${eventID};${year};${fname}`)).toString();
      mailOptions.attachments = [
        {
          filename: "qr.png",
          content: qr.split("base64,")[1], //to remove base64 prefix (data:image/png;base64,
          encoding: "base64",
          cid: "qr"
        }
      ];
    }

    try {
      // Send email with calendar invite attachment
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.log(error);
    }
  }

  async sendDynamicQR(event, user, registrationStatus, emailType) {
    const {
      id: email, fname
    } = user;
    const {
      id, ename, year
    } = event;

    const qr = (await QRCode.toDataURL(`${email};${id};${year};${fname}`)).toString();

    const emailParams = registrationStatus === "registered" ? {
      fname,
      ename,
      logoBase64
    } : {
      fname,
      ename,
      registrationStatus,
      logoBase64
    };
    const rawHtml = registrationStatus === "registered" ?
      getRegisteredQRTemplate(emailParams)
      : getDefaultQRTemplate(emailParams);
    const subject = `BizTech ${ename} Event ${emailType === "application"  ? "Application" : "Registration"} Status`;

    let mailOptions = {
      from: "dev@ubcbiztech.com",
      to: email,
      subject: subject,
      html: rawHtml,
      attachDataUrls: true,
      attachments: [
        {
          filename: "qr.png",
          content: qr.split("base64,")[1],
          encoding: "base64",
          cid: "qr"
        }
      ]
    };

    if (registrationStatus !== "registered") {
      delete mailOptions.attachments;
    }

    this.transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.log(err);
      } else {
        console.log("Email sent: " + info.response);
      }
    });
  }
}
