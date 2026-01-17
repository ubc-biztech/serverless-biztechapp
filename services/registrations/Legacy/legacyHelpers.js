export const isLegacyStatus = (status) => {
  const legacyStatuses = [
    "registered", "incomplete", "accepted", "acceptedComplete",
    "acceptedPending", "waitlist", "rejected", "checkedIn"
  ];
  return legacyStatuses.includes(status);
};

export const mapLegacyToNewStatus = (legacyStatus) => {
  const mapping = {
    "registered": {
      applicationStatus: "REGISTERED",
      registrationStatus: "REVIEWING"
    },
    "incomplete": {
      applicationStatus: "INCOMPLETE",
      registrationStatus: "PAYMENTPENDING"
    },
    "accepted": {
      applicationStatus: "ACCEPTED",
      registrationStatus: "PAYMENTPENDING"
    },
    "acceptedComplete": {
      applicationStatus: "REGISTERED",
      registrationStatus: "COMPLETE"
    },
    "acceptedPending": {
      applicationStatus: "ACCEPTED",
      registrationStatus: "PENDING"
    },
    "waitlist": {
      applicationStatus: "WAITLISTED",
      registrationStatus: "REVIEWING"
    },
    "rejected": {
      applicationStatus: "REJECTED",
      registrationStatus: "REVIEWING"
    },
    "checkedIn": {
      applicationStatus: "CHECKED-IN",
      registrationStatus: "COMPLETE"
    }
  };
  return mapping[legacyStatus] || null;
};
