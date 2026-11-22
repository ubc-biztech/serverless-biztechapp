export const REGISTRATION_STATUS = Object.freeze({
  INCOMPLETE: "incomplete",
  REGISTERED: "registered",
  WAITLIST: "waitlist",
  CHECKED_IN: "checkedIn",
  CANCELLED: "cancelled",
  ACCEPTED: "accepted",
  ACCEPTED_PENDING: "acceptedPending",
  ACCEPTED_COMPLETE: "acceptedComplete",
  REJECTED: "rejected"
});

export const BTX_REGISTRATION_STATUSES = Object.freeze([
  REGISTRATION_STATUS.ACCEPTED_COMPLETE,
  REGISTRATION_STATUS.CHECKED_IN
]);
