export const getDefaultQRTemplate = (emailParams) => {
  const {
    fname, ename, registrationStatus, logoBase64
  } = emailParams;

  return `<div style="font-size: 15px; text-align: left;">
    <div>
        <p>Hello ${fname},</p>
        <p>Your registration status for UBC BizTech's ${ename} event is: <b>${registrationStatus}</b>.</p>
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
    </div>`;
};

export const getRegisteredQRTemplate = (emailParams) => {
  const {
    fname, ename, logoBase64
  } = emailParams;

  return `
    <div style="font-size: 15px; text-align: left;">
    <div>
        <p>Hello ${fname},</p>
        <p>You have been registered for UBC BizTech's <b>${ename}</b> event.</p>
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
};


export const getPartnerQRTemplate = (emailParams) => {
  const {
    fname, ename, imageUrl, logoBase64
  } = emailParams;

  return `
      <div style="margin: auto; font-size: 15px; text-align: left; width: 700px;">
      <div>
        <b><p style="font-size: 25px">Hello ${fname},</p></b>
        <div style="width: 700px; height: 400px;">
        <img src="${imageUrl}" alt="banner" style="width: 100%; max-height:100%"/>
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
    </div>`;
};
