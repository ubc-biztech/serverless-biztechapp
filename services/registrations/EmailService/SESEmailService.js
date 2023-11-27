import AWS from "aws-sdk";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  logoBase64
} from "./constants";
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
      ename, year, description, elocation, startDate, endDate, imageUrl
    } = event;
    let {
      fname, id, isPartner
    } = user;

    const defaultTemplate =
    `
    <div style="margin: auto; font-size: 15px; text-align: left; width: 700px;">
      <div>
        <b><p style="font-size: 25px">Hello ${fname}, thanks for registering for ${ename}</p></b>
        <div style="width: 700px; height: 400px;">
        <img src="${imageUrl}" alt="banner" style="width: 100%"/>
        </div>
        <p>Your QR code is attached to a separate event confirmation email. Please have it ready to scan at the event.</p>
        <p>Further, if you decline your calendar invitation, you will also need to cancel your registration through the link below.</p>
        <a href="https://app.ubcbiztech.com/events">Manage your registration</a>
        <br>
        <p><b>See more upcoming events</b></p>
        <p>You can find the details for this event and other upcoming events on your <a href="https://app.ubcbiztech.com/">home page</a>.
        <br>
        <p>Meanwhile, if you have any questions or concerns about this event, please reach out to us at <a href="https://www.instagram.com/ubcbiztech">@ubcbiztech</a>.
        <br>
        <p>See you at the event, <br><b>The UBC BizTech Team</b></p>
        <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
      </div>
    </div>
    `;

    const partnerTemplate =
    `
    <div style="margin: auto; font-size: 15px; text-align: left; width: 700px;">
      <div>
        <b><p style="font-size: 25px">Hello ${fname},</p></b>
        <div style="width: 700px; height: 400px;">
        <img src="${imageUrl}" alt="banner" style="width: 100%"/>
        </div>
        <p>You have been registered for UBC BizTech's <b>${ename}</b> event.</p>
        <p>Please scan the attached QR code at the sign-in desk at the event.</p>
        <p>We look forward to hosting you!</p>
        <p><b>See more upcoming events</b></p>
        <p>You can find the details for this event and other upcoming events on your <a href="https://app.ubcbiztech.com/">home page</a>.
        <br>
        <p>Meanwhile, if you have any questions or concerns about this event, please reach out to the partnerships lead <a href="mailto:kate@ubcbiztech.com">kate@ubcbiztech.com</a>.
        <br>
        <p>See you at the event, <br><b>The UBC BizTech Team</b></p>
        <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
      </div>
    </div>
    `;

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
      html: user.isPartner ? partnerTemplate : defaultTemplate,
      attachDataUrls: true,
      icalEvent: {
        filename: "invitation.ics",
        method: "request",
        content: value
      }
    };

    if (isPartner) {
      const qr = (await QRCode.toDataURL(`${id};${ename};${year};${fname}`)).toString();
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

  async sendDynamicQR(email, fname, eventName, eventYear, registrationStatus, emailType) {
    const qr = (await QRCode.toDataURL(`${email};${eventName};${eventYear};${fname}`)).toString();

    const defaultTemplate =
    `
    <div style="font-size: 15px; text-align: left;">
      <div>
          <p>Hello ${fname},</p>
          <p>Your registration status for UBC BizTech's ${eventName} event is: <b>${registrationStatus}</b>.</p>
          <p>Please reach out to our Experiences Team Lead at <a href="mailto:karen@ubcbiztech.com">karen@ubcbiztech.com</a> if this is a mistake.</p>
      </div>
      <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
      <br>
      <div style="font-size: 8px;">
          <div>
              <p>UBC BizTech • 445-2053 Main Mall • Vancouver, BC V6T 1Z2</p>
          </div>
          <div>
              <p>Copyright © 2022 UBC BizTech</p>
          </div>
      </div>
      <div>
          <u><a href="https://www.facebook.com/BizTechUBC">Facebook</a></u>
          <u><a href="https://www.instagram.com/ubcbiztech/">Instagram</a></u>
          <u><a href="https://www.linkedin.com/company/ubcbiztech/mycompany/">LinkedIn</a></u>
      </div>
    </div>
    `;

    const registeredTemplate =
    `
    <div style="font-size: 15px; text-align: left;">
      <div>
          <p>Hello ${fname},</p>
          <p>You have been registered for UBC BizTech's <b>${eventName}</b> event.</p>
          <p>Please scan the attached QR code at the sign-in desk at the event.</p>
          <p>We look forward to hosting you!</p>
      </div>
      <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
      <br>
      <div style="font-size: 8px;">
          <div>
              <p>UBC BizTech • 445-2053 Main Mall • Vancouver, BC V6T 1Z2</p>
          </div>
          <div>
              <p>Copyright © 2022 UBC BizTech</p>
          </div>
      </div>
      <div>
          <u><a href="https://www.facebook.com/BizTechUBC">Facebook</a></u>
          <u><a href="https://www.instagram.com/ubcbiztech/">Instagram</a></u>
          <u><a href="https://www.linkedin.com/company/ubcbiztech/mycompany/">LinkedIn</a></u>
      </div>
    </div>
    `;

    // TODO: refactor to pass in template to make this method more reusuable
    let mailOptions = {
      from: "dev@ubcbiztech.com",
      to: "dev@ubcbiztech.com",
      subject: `BizTech ${eventName} Event ${emailType === "application" ? "Application" : "Registration"} Status`,
      html: registrationStatus === "registered" ? registeredTemplate : defaultTemplate,
      attachDataUrls: true,//to accept base64 content in messsage
      attachments: [
        {
          filename: "qr.png",
          content: qr.split("base64,")[1], //to remove base64 prefix (data:image/png;base64,
          encoding: "base64",
          cid: "qr"
        }
      ]
    };

    if (registrationStatus === "registered") {
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
