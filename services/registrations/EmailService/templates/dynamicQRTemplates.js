export const getDefaultQRTemplate = (emailParams) => {
  const {
    fname, ename, applicationStatus, registrationStatus, logoBase64, qrCode, currentYear
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
    fname, ename, applicationStatus, registrationStatus, logoBase64, qrCode, currentYear
  } = emailParams;

  if (registrationStatus === "PENDING" || registrationStatus === "PAYMENTPENDING") {
    return( `<div style="font-size: 15px; text-align: left;">
        <div>
            <p>Hello ${fname},</p>
            <p>Your application status for UBC BizTech's ${ename} event is: <b>${applicationStatus}</b></p>
            <p> Make sure to confirm your attendence! your current status is: <b>${registrationStatus}</b>. You can check your application status and confirm
            attendence in personal <a href="https://app.ubcbiztech.com/companion">companion</a>. </p>
            <p>Please reach out to our Experiences Team Lead at <a href="mailto:grace@ubcbiztech.com">grace@ubcbiztech.com</a> if you wish to cancel.</p>
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
        </div>`);
  } else {
    return( `<div style="font-size: 15px; text-align: left;">
        <div>
            <p>Hello ${fname},</p>
            <p>Your application status for UBC BizTech's ${ename} event is: <b>${applicationStatus}</b>. You can check your application status in your
            personal <a href="https://app.ubcbiztech.com/companion">companion</a>.</p>
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
        </div>`);
  }
  
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

