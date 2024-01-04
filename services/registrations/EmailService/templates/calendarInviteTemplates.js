export const getDefaultCalendarInviteTemplate = (emailParams) => {
  const {
    fname, ename, imageUrl, logoBase64
  } = emailParams;
  return `
        <div style="margin: auto; font-size: 15px; text-align: left; width: 700px;">
        <div>
        <b><p style="font-size: 25px">Hello ${fname}, thanks for registering for ${ename}</p></b>
        <div style="width: 700px; height: 400px;">
        <img src="${imageUrl}" alt="banner" style="width: 100%; max-height: 100%"/>
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
        </div>`;
};

export const getPartnerCalendarInviteTemplate = (emailParams) => {
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
