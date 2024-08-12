import {
  SESClient,
  CreateTemplateCommand,
  SendEmailCommand
} from "@aws-sdk/client-ses";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  logoBase64
} from "./constants";
import {
  getDefaultCalendarInviteTemplate,
  getPartnerCalendarInviteTemplate,
  getDefaultPaymentProcessedTemplate
} from "./templates/calendarInviteTemplates";
import {
  getDefaultQRTemplate,
  getRegisteredQRTemplate,
  getDefaultApplicationTemplate
} from "./templates/dynamicQRTemplates";
const ics = require("ics");

export default class SESEmailService {
  constructor({
    accessKeyId,
    secretAccessKey,
    region = "us-west-2"
  }) {
    const credentials = {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey
    };
    this.ses = process.env.ENVIRONMENT === "development" ?
      new SESClient({
        region: region,
        credentials: credentials
      }) :
      new SESClient({
        region: region
      });

    this.transporter = nodemailer.createTransport({
      SES: {
        ses: this.ses,
        aws: require("@aws-sdk/client-ses")
      }
    });
  }

  async createEmailTemplate(templateName, subject, htmlBody) {
    try {
      const command = new CreateTemplateCommand({
        Template: {
          TemplateName: templateName,
          SubjectPart: subject,
          HtmlPart: htmlBody
        }
      });
      const data = await this.ses.send(command);
      console.log(data);
    } catch (err) {
      console.error(err, err.stack);
    }
  }

  async sendCalendarInvite(event, user) {
    let {
      ename,
      eventID,
      year,
      description,
      elocation,
      startDate,
      endDate,
      imageUrl
    } = event;
    let {
      fname,
      id,
      isPartner
    } = user;

    const emailParams = {
      fname,
      ename,
      imageUrl,
      logoBase64
    };
    const rawHtml = user.isPartner ?
      getPartnerCalendarInviteTemplate(emailParams) :
      event.isApplicationBased ?
        getDefaultPaymentProcessedTemplate(emailParams) :
        getDefaultCalendarInviteTemplate(emailParams);

    startDate = new Date(startDate);
    endDate = new Date(endDate);

    const duration = {
      hours: endDate.getHours() - startDate.getHours(),
      minutes: endDate.getMinutes() - startDate.getMinutes(),
      seconds: endDate.getSeconds() - startDate.getSeconds()
    };

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
      error,
      value
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
      mailOptions.attachments = [{
        filename: "qr.png",
        content: qr.split("base64,")[1],
        encoding: "base64",
        cid: "qr"
      }];
    }

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.log(error);
    }
  }

  async sendDynamicQR(event, user, registrationStatus, emailType) {
    const {
      id: email,
      fname
    } = user;
    const {
      id,
      ename,
      year,
      isApplicationBased
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
      getRegisteredQRTemplate(emailParams) :
      isApplicationBased ?
        getDefaultApplicationTemplate(emailParams) :
        getDefaultQRTemplate(emailParams);
    const subject = `BizTech ${ename} Event ${emailType === "application" ? "Application" : "Registration"} Status`;

    let mailOptions = {
      from: "dev@ubcbiztech.com",
      to: email,
      subject: subject,
      html: rawHtml,
      attachDataUrls: true,
      attachments: [{
        filename: "qr.png",
        content: qr.split("base64,")[1],
        encoding: "base64",
        cid: "qr"
      }]
    };

    if (registrationStatus !== "registered") {
      delete mailOptions.attachments;
    }
    try {
      await this.transporter.sendMail(mailOptions);
      console.log("Email sent successfully");
    } catch (err) {
      console.error(err);
    }
  }
}
