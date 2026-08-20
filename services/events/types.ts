/** Dynamic registration question on an event (attendee or partner). */
export interface RegistrationQuestion {
  questionId?: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  choices?: string;
  participantCap?: string;
  [key: string]: unknown;
}

export type RegistrationQuestionWithId = RegistrationQuestion & {
  questionId: string;
};

export type EventPageModuleId = "registration" | "qa" | "connections";

export type EventPageModuleVisibility =
  | "public"
  | "signedIn"
  | "registered"
  | "checkedIn"
  | "admin";

export interface EventPageModule {
  id: EventPageModuleId;
  order: number;
  visibility: EventPageModuleVisibility;
  config?: Record<string, unknown>;
}

export interface EventPageConfig {
  subtitle?: string;
  targetAudience?: string;
  externalUrl?: string;
  modules?: EventPageModule[];
}

/** POST /events/ request body. */
export interface CreateEventBody {
  id: string;
  year: number;
  capac: number;
  ename?: string;
  description?: string;
  partnerDescription?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  facebookUrl?: string;
  imageUrl?: string;
  elocation?: string;
  longitude?: number;
  latitude?: number;
  pricing?: Record<string, unknown>;
  registrationQuestions?: RegistrationQuestion[];
  partnerRegistrationQuestions?: RegistrationQuestion[];
  attendeeFeedbackQuestions?: RawFeedbackQuestion[] | FeedbackQuestion[];
  partnerFeedbackQuestions?: RawFeedbackQuestion[] | FeedbackQuestion[];
  attendeeFeedbackEnabled?: boolean;
  partnerFeedbackEnabled?: boolean;
  requiredTextFields?: unknown;
  unrequiredTextFields?: unknown;
  requiredSelectFields?: unknown;
  unrequiredSelectFields?: unknown;
  requiredCheckBoxFields?: unknown;
  unrequiredCheckBoxFields?: unknown;
  isPublished?: boolean;
  feedback?: string;
  isApplicationBased?: boolean;
  nonBizTechAllowed?: boolean;
  eventPage?: EventPageConfig;
  [key: string]: unknown;
}

/** PATCH /events/{id}/{year} request body. */
export type UpdateEventBody = Partial<CreateEventBody>;

export interface CreateThumbnailPicUploadUrlBody {
  fileType: string;
  fileName: string;
  prefix: string;
  eventId: string;
  [key: string]: unknown;
}

/** Event item stored in biztechEvents. */
export interface EventRecord {
  id: string;
  year: number;
  capac?: number;
  ename?: string;
  description?: string;
  partnerDescription?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  facebookUrl?: string;
  imageUrl?: string;
  elocation?: string;
  longitude?: number;
  latitude?: number;
  pricing?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  registrationQuestions?: RegistrationQuestionWithId[];
  partnerRegistrationQuestions?: RegistrationQuestionWithId[];
  attendeeFeedbackQuestions?: FeedbackQuestion[];
  partnerFeedbackQuestions?: FeedbackQuestion[];
  attendeeFeedbackEnabled?: boolean;
  partnerFeedbackEnabled?: boolean;
  isPublished?: boolean;
  isCompleted?: boolean;
  feedback?: string;
  isApplicationBased?: boolean;
  nonBizTechAllowed?: boolean;
  eventPage?: EventPageConfig;
  [key: string]: unknown;
}

export type FeedbackFormType = "attendee" | "partner";

export type FeedbackQuestionType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "MULTIPLE_CHOICE"
  | "CHECKBOXES"
  | "LINEAR_SCALE";

/** Incoming feedback question before normalization. */
export interface RawFeedbackQuestion {
  questionId?: string;
  id?: string;
  type?: string;
  label?: string;
  question?: string;
  required?: boolean;
  choices?: string | string[];
  options?: string | string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  [key: string]: unknown;
}

/** Normalized feedback question stored on an event. */
export interface FeedbackQuestion {
  questionId: string;
  type: FeedbackQuestionType;
  label: string;
  required: boolean;
  choices?: string;
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

export type ValidationFail = { 
  isValid: false; 
  error: string 
};

export type QuestionsValidationSuccess = {
  isValid: true;
  questions: FeedbackQuestion[];
};


export type QuestionsValidationResult =
  | ValidationFail
  | QuestionsValidationSuccess;

export type ResponsesValidationSuccess = {
  isValid: true;
  responses: Record<string, unknown>;
};

export type ResponsesValidationResult =
  | ValidationFail
  | ResponsesValidationSuccess;

/** POST /events/{id}/{year}/feedback/{formType} request body. */
export interface SubmitFeedbackBody {
  responses?: Record<string, unknown>;
  respondentName?: string;
  respondentEmail?: string;
}

export interface FeedbackHelpers {
  parseFormType: (raw: string | undefined) => FeedbackFormType | null;
  ensureDefaultOverallRatingQuestion: (
    questions: RawFeedbackQuestion[] | FeedbackQuestion[] | unknown,
  ) => FeedbackQuestion[];
  getFeedbackQuestionsForType: (
    eventItem: EventRecord | Record<string, unknown> | null,
    formType: FeedbackFormType,
  ) => FeedbackQuestion[];
  isFeedbackEnabledForType: (
    eventItem: EventRecord | Record<string, unknown> | null,
    formType: FeedbackFormType,
  ) => boolean;
  normalizeFeedbackQuestions: (
    rawQuestions: unknown,
    formType: FeedbackFormType,
  ) => QuestionsValidationResult;
  validateFeedbackPayload: (
    questions: FeedbackQuestion[],
    rawResponses: unknown,
  ) => ResponsesValidationResult;
  normalizeText: (value: unknown) => string;
}
