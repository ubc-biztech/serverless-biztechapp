import { REGISTRATION_STATUS } from "../../constants";

export const getDefaultQRTemplate = (emailParams) => {
  const {
    fname, ename, registrationStatus, logoBase64, currentYear
  } = emailParams;

  return `<div style="font-size: 15px; text-align: left;">
    <div>
        <p>Hello ${fname},</p>
        <p>Your registration status for UBC BizTech's ${ename} event is: <b>${registrationStatus}</b>.</p>
        <p>Please reach out to our Experiences Team Lead at <a href="mailto:jay@ubcbiztech.com">jay@ubcbiztech.com</a> if this is a mistake.</p>
    </div>
    <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
    <br>
    <div style="font-size: 8px;">
        <div>
            <p>UBC BizTech • 445-2053 Main Mall • Vancouver, BC V6T 1Z2</p>
        </div>
        <div>
            <p>Copyright © ${currentYear} UBC BizTech</p>
        </div>
    </div>
    <div>
        <u><a href="https://www.facebook.com/BizTechUBC">Facebook</a></u>
        <u><a href="https://www.instagram.com/ubcbiztech/">Instagram</a></u>
        <u><a href="https://www.linkedin.com/company/ubcbiztech/mycompany/">LinkedIn</a></u>
    </div>
    </div>`;
};

export const getDefaultApplicationTemplate = (emailParams) => {
  const {
    fname, registrationStatus, logoBase64, currentYear
  } = emailParams;
  let content;
  if (registrationStatus === REGISTRATION_STATUS.ACCEPTED_PENDING) {
    content = `<p>You've been accepted to HelloHacks 2026! Please use the link below to confirm your attendance.</p>
          <a href="https://app.ubcbiztech.com/events">Confirm your attendance</a>
          <p>If you have any questions or concerns, please reach out to our Experiences Team Lead at <a href="mailto:jay@ubcbiztech.com">jay@ubcbiztech.com</a>.</p>`;
  } else {
    content = `<p>Thank you for registering for HelloHacks 2026! We’re excited to receive your application and will be reviewing it shortly.</p>
          <p>If you have any questions or concerns about your application, please reach out to our Experiences Team Lead at <a href="mailto:jay@ubcbiztech.com">jay@ubcbiztech.com</a>.</p>
          <p>We’ll be in touch by email once the applicant review process is complete.</p>`;
  }

  return `<div style="font-size: 15px; text-align: left;">
      <div>
          <p>Hello ${fname},</p>
          ${content}
          <p>Best,<br>BizTech Team</p>
      </div>

      <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
      <br>

      <div style="font-size: 8px;">
          <div>
              <p>UBC BizTech • 445-2053 Main Mall • Vancouver, BC V6T 1Z2</p>
          </div>
          <div>
              <p>Copyright © ${currentYear} UBC BizTech</p>
          </div>
      </div>
      <div>
          <u><a href="https://www.facebook.com/BizTechUBC">Facebook</a></u>
          <u><a href="https://www.instagram.com/ubcbiztech/">Instagram</a></u>
          <u><a href="https://www.linkedin.com/company/ubcbiztech/mycompany/">LinkedIn</a></u>
      </div>
      </div>`;
};

export const getRegisteredQRTemplate = (emailParams) => {
  const {
    fname, ename, logoBase64, currentYear
  } = emailParams;

  return `
    <div style="font-size: 15px; text-align: left;">
    <div>
        <p>Hello ${fname},</p>
        <p>You have been registered for UBC BizTech's <b>${ename}</b> event.</p>
        <p>We look forward to hosting you!</p>
    </div>
    <img src="${logoBase64}" width="40" height="40" alt="BizTech Logo">
    <br>
    <div style="font-size: 8px;">
        <div>
            <p>UBC BizTech • 445-2053 Main Mall • Vancouver, BC V6T 1Z2</p>
        </div>
        <div>
            <p>Copyright © ${currentYear} UBC BizTech</p>
        </div>
    </div>
    <div>
        <u><a href="https://www.facebook.com/BizTechUBC">Facebook</a></u>
        <u><a href="https://www.instagram.com/ubcbiztech/">Instagram</a></u>
        <u><a href="https://www.linkedin.com/company/ubcbiztech/mycompany/">LinkedIn</a></u>
    </div>
  </div>
  `;
};
