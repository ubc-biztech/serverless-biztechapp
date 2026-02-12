export const getDefaultQRTemplate = (emailParams) => {
  const {
    fname, ename, registrationStatus, logoBase64, qrCode, currentYear
  } = emailParams;

  return `<div style="font-size: 15px; text-align: left;">
    <div>
        <p>Hello ${fname},</p>
        <p>Your registration status for UBC BizTech's ${ename} event is: <b>${registrationStatus}</b>.</p>
        <p>Please reach out to our Experiences Team Lead at <a href="mailto:grace@ubcbiztech.com">grace@ubcbiztech.com</a> if this is a mistake.</p>
        <p>Here's your QR code (if it doesn't display, please speak to the sign-in desk):</p>
        <img src="cid:qr@biztech.com" alt="Attached QR Code" style="max-width: 200px;" />
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
    fname, ename, registrationStatus, logoBase64, qrCode, currentYear
  } = emailParams;

  // revert this change after techstrat
  return `<div style="font-size: 15px; text-align: left;">
      <div>
          <p>Hello ${fname},</p>
          <p>Thank you for registering for TechStrat 2026 – Preliminary Round! We are excited for you to join us at UBC BizTech’s flagship case competition. Be sure to look out for our preliminary case, which will be released on February 16, 2026. We will send an additional email to confirm your team registration soon after the case releases.</p>
          <p>All TechStrat participants are encouraged to join our <a href="https://join.slack.com/t/techstrat2026/shared_invite/zt-3p2tnx513-2qFEqNGz64925b404USpJA">TechStrat Slack Community Channel</a> to stay updated on event announcements, participant questions, and information about team formation.</p>
          <p>Please reach out to our Event Director at TechStrat@ubcbiztech.com if this was a mistake!</p>
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
    fname, ename, logoBase64, qrCode, currentYear
  } = emailParams;

  return `
    <div style="font-size: 15px; text-align: left;">
    <div>
        <p>Hello ${fname},</p>
        <p>You have been registered for UBC BizTech's <b>${ename}</b> event.</p>
        <p>Please scan the QR code below at the sign-in desk at the event. If the QR code doesn't display, please speak to the sign-in desk.</p>
        <img src="cid:qr@biztech.com" alt="Attached QR Code" style="max-width: 200px;" />
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

