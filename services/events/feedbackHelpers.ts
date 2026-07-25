import { v4 as uuidv4 } from "uuid";
import type {
  EventRecord,
  FeedbackFormType,
  FeedbackHelpers,
  FeedbackQuestion,
  FeedbackQuestionType,
  QuestionsValidationResult,
  RawFeedbackQuestion,
  ResponsesValidationResult,
  ValidationFail,
} from "./types";

export const isValidationFail = (
  result: { isValid: boolean },
): result is ValidationFail => !result.isValid;

const FEEDBACK_FORM_TYPES = new Set<FeedbackFormType>(["attendee", "partner"]);
const FEEDBACK_QUESTION_TYPES = new Set<FeedbackQuestionType>([
  "SHORT_TEXT",
  "LONG_TEXT",
  "MULTIPLE_CHOICE",
  "CHECKBOXES",
  "LINEAR_SCALE",
]);

const FORM_CONFIG: Record<
  FeedbackFormType,
  {
    enabledField: "attendeeFeedbackEnabled" | "partnerFeedbackEnabled";
    questionsField: "attendeeFeedbackQuestions" | "partnerFeedbackQuestions";
  }
> = {
  attendee: {
    enabledField: "attendeeFeedbackEnabled",
    questionsField: "attendeeFeedbackQuestions"
  },
  partner: {
    enabledField: "partnerFeedbackEnabled",
    questionsField: "partnerFeedbackQuestions"
  }
};

const FEEDBACK_TEXT_LIMITS: Partial<Record<FeedbackQuestionType, number>> = {
  SHORT_TEXT: 280,
  LONG_TEXT: 4000,
};

const MAX_FEEDBACK_QUESTIONS_PER_FORM = 50;
const OVERALL_RATING_QUESTION_ID = "overall-rating";
const DEFAULT_OVERALL_RATING_QUESTION: FeedbackQuestion = {
  questionId: OVERALL_RATING_QUESTION_ID,
  type: "LINEAR_SCALE",
  label: "How would you rate this event overall?",
  required: true,
  scaleMin: 1,
  scaleMax: 10,
  scaleMinLabel: "Poor",
  scaleMaxLabel: "Excellent"
};

const fail = (error: string): ValidationFail => ({
  isValid: false as const,
  error,
});

const succeedQuestions = (
  questions: FeedbackQuestion[],
): QuestionsValidationResult => ({
  isValid: true as const,
  questions,
});

const succeedResponses = (
  responses: Record<string, unknown>,
): ResponsesValidationResult => ({
  isValid: true as const,
  responses,
});

const normalizeText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeChoices = (choicesValue: unknown): string[] => {
  if (Array.isArray(choicesValue)) {
    return choicesValue.map((choice) => normalizeText(choice)).filter(Boolean);
  }

  if (typeof choicesValue !== "string") return [];
  return choicesValue
    .split(",")
    .map((choice) => choice.trim())
    .filter(Boolean);
};

const getFormConfig = (formType: FeedbackFormType) => FORM_CONFIG[formType];

const parseFormType = (raw: string | undefined): FeedbackFormType | null => {
  if (!raw || typeof raw !== "string") return null;
  const normalized = raw.toLowerCase();
  if (!FEEDBACK_FORM_TYPES.has(normalized as FeedbackFormType)) return null;
  return normalized as FeedbackFormType;
};

const ensureDefaultOverallRatingQuestion = (
  questions: RawFeedbackQuestion[] | FeedbackQuestion[] | unknown,
): FeedbackQuestion[] => {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const otherQuestions = safeQuestions.filter((question) => {
    return (
      question &&
      typeof question === "object" &&
      (question as RawFeedbackQuestion).questionId !== OVERALL_RATING_QUESTION_ID
    );
  }) as FeedbackQuestion[];

  return [{ ...DEFAULT_OVERALL_RATING_QUESTION }, ...otherQuestions];
};

const getFeedbackQuestionsForType = (
  eventItem: EventRecord | Record<string, unknown> | null,
  formType: FeedbackFormType,
): FeedbackQuestion[] => {
  const config = getFormConfig(formType);
  if (!eventItem) {
    return ensureDefaultOverallRatingQuestion([]);
  }

  const rawQuestions = eventItem[config.questionsField];
  if (!Array.isArray(rawQuestions)) {
    return ensureDefaultOverallRatingQuestion([]);
  }

  return ensureDefaultOverallRatingQuestion(rawQuestions);
};

const isFeedbackEnabledForType = (
  eventItem: EventRecord | Record<string, unknown> | null,
  formType: FeedbackFormType,
): boolean => {
  if (!eventItem) return false;
  const config = getFormConfig(formType);
  return Boolean(eventItem[config.enabledField]);
};

const buildQuestionPrefix = (formType: FeedbackFormType, index: number): string => {
  return `${formType}FeedbackQuestions[${index}]`;
};

const normalizeQuestionType = (
  rawQuestion: RawFeedbackQuestion,
  prefix: string,
): ValidationFail | { isValid: true; type: FeedbackQuestionType } => {
  const type = normalizeText(rawQuestion.type).toUpperCase();
  if (!FEEDBACK_QUESTION_TYPES.has(type as FeedbackQuestionType)) {
    return fail(`${prefix} has unsupported type '${rawQuestion.type}'.`);
  }

  return {
    isValid: true,
    type: type as FeedbackQuestionType,
  };
};

const normalizeQuestionLabel = (
  rawQuestion: RawFeedbackQuestion,
  prefix: string,
): ValidationFail | { isValid: true; label: string } => {
  const label = normalizeText(rawQuestion.label || rawQuestion.question);
  if (!label) {
    return fail(`${prefix} is missing a question label.`);
  }

  if (label.length > 500) {
    return fail(`${prefix} exceeds 500 characters.`);
  }

  return {
    isValid: true,
    label
  };
};

const normalizeQuestionId = (
  rawQuestion: RawFeedbackQuestion,
  formType: FeedbackFormType,
  questionIdSet: Set<string>,
): ValidationFail | { isValid: true; questionId: string } => {
  const rawQuestionId = normalizeText(rawQuestion.questionId || rawQuestion.id);
  const questionId = rawQuestionId || uuidv4();

  if (questionIdSet.has(questionId)) {
    return fail(
      `${formType}FeedbackQuestions contains duplicate questionId '${questionId}'.`
    );
  }

  questionIdSet.add(questionId);
  return {
    isValid: true,
    questionId
  };
};

const appendSelectableQuestionFields = (
  question: FeedbackQuestion,
  rawQuestion: RawFeedbackQuestion,
  prefix: string,
): ValidationFail | { isValid: true } => {
  const options = normalizeChoices(rawQuestion.choices || rawQuestion.options);
  const dedupedOptions = [...new Set(options)];

  if (dedupedOptions.length === 0) {
    return fail(`${prefix} must include at least one option.`);
  }

  const invalidOption = dedupedOptions.find((option) => option.length > 200);
  if (invalidOption) {
    return fail(`${prefix} has an option longer than 200 characters.`);
  }

  question.choices = dedupedOptions.join(",");
  return {
    isValid: true
  };
};

const appendScaleQuestionFields = (
  question: FeedbackQuestion,
  rawQuestion: RawFeedbackQuestion,
  prefix: string,
): ValidationFail | { isValid: true } => {
  const parsedMin = Number(rawQuestion.scaleMin);
  const parsedMax = Number(rawQuestion.scaleMax);
  const scaleMin = Number.isFinite(parsedMin) ? parsedMin : 1;
  const scaleMax = Number.isFinite(parsedMax) ? parsedMax : 5;

  if (!Number.isInteger(scaleMin) || !Number.isInteger(scaleMax)) {
    return fail(`${prefix} scale bounds must be integers.`);
  }

  if (scaleMin >= scaleMax) {
    return fail(`${prefix} scaleMin must be less than scaleMax.`);
  }

  if (scaleMin < 0 || scaleMax > 20) {
    return fail(`${prefix} scale bounds must be between 0 and 20.`);
  }

  const scaleMinLabel = normalizeText(rawQuestion.scaleMinLabel);
  const scaleMaxLabel = normalizeText(rawQuestion.scaleMaxLabel);
  if (scaleMinLabel.length > 120 || scaleMaxLabel.length > 120) {
    return fail(`${prefix} scale labels cannot exceed 120 characters.`);
  }

  question.scaleMin = scaleMin;
  question.scaleMax = scaleMax;
  question.scaleMinLabel = scaleMinLabel || "";
  question.scaleMaxLabel = scaleMaxLabel || "";

  return {
    isValid: true
  };
};

const normalizeSingleQuestion = (
  rawQuestion: unknown,
  index: number,
  formType: FeedbackFormType,
  questionIdSet: Set<string>,
): ValidationFail | { isValid: true; question: FeedbackQuestion } => {
  const prefix = buildQuestionPrefix(formType, index);

  if (
    !rawQuestion ||
    typeof rawQuestion !== "object" ||
    Array.isArray(rawQuestion)
  ) {
    return fail(`${prefix} is invalid.`);
  }

  const questionInput = rawQuestion as RawFeedbackQuestion;
  const typeResult = normalizeQuestionType(questionInput, prefix);
  if (isValidationFail(typeResult)) return typeResult;

  const labelResult = normalizeQuestionLabel(questionInput, prefix);
  if (isValidationFail(labelResult)) return labelResult;

  const idResult = normalizeQuestionId(questionInput, formType, questionIdSet);
  if (isValidationFail(idResult)) return idResult;

  const question: FeedbackQuestion = {
    questionId: idResult.questionId,
    type: typeResult.type,
    label: labelResult.label,
    required: Boolean(questionInput.required),
  };

  if (question.type === "MULTIPLE_CHOICE" || question.type === "CHECKBOXES") {
    const selectableResult = appendSelectableQuestionFields(
      question,
      questionInput,
      prefix,
    );
    if (isValidationFail(selectableResult)) return selectableResult;
  }

  if (question.type === "LINEAR_SCALE") {
    const scaleResult = appendScaleQuestionFields(
      question,
      questionInput,
      prefix,
    );
    if (isValidationFail(scaleResult)) return scaleResult;
  }

  return {
    isValid: true,
    question
  };
};

const normalizeFeedbackQuestions = (
  rawQuestions: unknown,
  formType: FeedbackFormType,
): QuestionsValidationResult => {
  if (!Array.isArray(rawQuestions)) {
    return fail(`${formType}FeedbackQuestions must be an array.`);
  }

  if (rawQuestions.length > MAX_FEEDBACK_QUESTIONS_PER_FORM) {
    return fail(
      `${formType}FeedbackQuestions cannot exceed ${MAX_FEEDBACK_QUESTIONS_PER_FORM} questions.`
    );
  }

  const normalizedQuestions: FeedbackQuestion[] = [];
  const questionIdSet = new Set<string>();

  for (let index = 0; index < rawQuestions.length; index++) {
    const questionResult = normalizeSingleQuestion(
      rawQuestions[index],
      index,
      formType,
      questionIdSet,
    );

    if (isValidationFail(questionResult)) {
      return questionResult;
    }

    normalizedQuestions.push(questionResult.question);
  }

  return succeedQuestions(normalizedQuestions);
};

const validateResponseObjectShape = (
  rawResponses: unknown,
): ValidationFail | { isValid: true } => {
  if (
    !rawResponses ||
    typeof rawResponses !== "object" ||
    Array.isArray(rawResponses)
  ) {
    return fail("Feedback responses must be an object keyed by questionId.");
  }

  return {
    isValid: true
  };
};

const validateNoUnknownQuestionIds = (
  questions: FeedbackQuestion[],
  responses: Record<string, unknown>,
): ValidationFail | { isValid: true } => {
  const allowedIds = new Set(questions.map((q) => q.questionId));
  const responseKeys = Object.keys(responses);

  for (const key of responseKeys) {
    if (!allowedIds.has(key)) {
      return fail(`Unknown questionId '${key}' in responses.`);
    }
  }

  return {
    isValid: true
  };
};

const validateTextResponse = (
  question: FeedbackQuestion,
  answer: unknown,
): ValidationFail | { isValid: true; hasValue: false } | { isValid: true; hasValue: true; value: string } => {
  const maxLength = FEEDBACK_TEXT_LIMITS[question.type];
  const text = normalizeText(answer);

  if (!text && question.required) {
    return fail(`Question '${question.questionId}' is required.`);
  }

  if (!text) {
    return {
      isValid: true,
      hasValue: false
    };
  }

  if (maxLength !== undefined && text.length > maxLength) {
    return fail(
      `Question '${question.questionId}' exceeds max length of ${maxLength}.`
    );
  }

  return {
    isValid: true,
    hasValue: true,
    value: text
  };
};

const validateMultipleChoiceResponse = (
  question: FeedbackQuestion,
  answer: unknown,
): ValidationFail | { isValid: true; hasValue: false } | { isValid: true; hasValue: true; value: string } => {
  const options = normalizeChoices(question.choices);
  const text = normalizeText(answer);

  if (!text && question.required) {
    return fail(`Question '${question.questionId}' is required.`);
  }

  if (!text) {
    return {
      isValid: true,
      hasValue: false
    };
  }

  if (!options.includes(text)) {
    return fail(`Invalid choice for question '${question.questionId}'.`);
  }

  return {
    isValid: true,
    hasValue: true,
    value: text
  };
};

const normalizeCheckboxValues = (
  answer: unknown,
): ValidationFail | { isValid: true; values: string[] } => {
  if (Array.isArray(answer)) {
    return {
      isValid: true,
      values: answer.map((item) => normalizeText(item)).filter(Boolean)
    };
  }

  if (typeof answer === "string") {
    return {
      isValid: true,
      values: answer
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    };
  }

  if (answer == null) {
    return {
      isValid: true,
      values: []
    };
  }

  return fail("INVALID_CHECKBOX_SHAPE");
};

const validateCheckboxResponse = (
  question: FeedbackQuestion,
  answer: unknown,
): ValidationFail | { isValid: true; hasValue: false } | { isValid: true; hasValue: true; value: string[] } => {
  const options = normalizeChoices(question.choices);
  const normalizedValueResult = normalizeCheckboxValues(answer);

  if (isValidationFail(normalizedValueResult)) {
    return fail(
      `Invalid checkbox response for question '${question.questionId}'.`
    );
  }

  const deduped = [...new Set(normalizedValueResult.values)];

  if (question.required && deduped.length === 0) {
    return fail(`Question '${question.questionId}' is required.`);
  }

  if (deduped.length === 0) {
    return {
      isValid: true,
      hasValue: false
    };
  }

  const hasInvalidChoice = deduped.some((item) => !options.includes(item));
  if (hasInvalidChoice) {
    return fail(
      `Invalid checkbox selection for question '${question.questionId}'.`
    );
  }

  return {
    isValid: true,
    hasValue: true,
    value: deduped
  };
};

const validateScaleResponse = (
  question: FeedbackQuestion,
  answer: unknown,
): ValidationFail | { isValid: true; hasValue: false } | { isValid: true; hasValue: true; value: number } => {
  const min = Number.isFinite(Number(question.scaleMin))
    ? Number(question.scaleMin)
    : 1;
  const max = Number.isFinite(Number(question.scaleMax))
    ? Number(question.scaleMax)
    : 5;

  const isEmpty = answer === "" || answer == null;
  if (isEmpty && question.required) {
    return fail(`Question '${question.questionId}' is required.`);
  }

  if (isEmpty) {
    return {
      isValid: true,
      hasValue: false
    };
  }

  const numericValue = Number(answer);
  if (
    !Number.isFinite(numericValue) ||
    !Number.isInteger(numericValue) ||
    numericValue < min ||
    numericValue > max
  ) {
    return fail(
      `Scale response for question '${question.questionId}' must be a whole number between ${min} and ${max}.`
    );
  }

  return {
    isValid: true,
    hasValue: true,
    value: numericValue
  };
};

const validateAnswerForQuestion = (
  question: FeedbackQuestion,
  answer: unknown,
) => {
  if (!FEEDBACK_QUESTION_TYPES.has(question.type)) {
    return fail(
      `Unsupported feedback question type '${question.type}' for question '${question.questionId}'.`
    );
  }

  if (question.type === "SHORT_TEXT" || question.type === "LONG_TEXT") {
    return validateTextResponse(question, answer);
  }

  if (question.type === "MULTIPLE_CHOICE") {
    return validateMultipleChoiceResponse(question, answer);
  }

  if (question.type === "CHECKBOXES") {
    return validateCheckboxResponse(question, answer);
  }

  return validateScaleResponse(question, answer);
};

const validateFeedbackPayload = (
  questions: FeedbackQuestion[],
  rawResponses: unknown,
): ResponsesValidationResult => {
  const shapeResult = validateResponseObjectShape(rawResponses);
  if (isValidationFail(shapeResult)) return shapeResult;

  const responses = (rawResponses as Record<string, unknown>) || {};
  const unknownIdResult = validateNoUnknownQuestionIds(questions, responses);
  if (isValidationFail(unknownIdResult)) return unknownIdResult;

  const normalized: Record<string, unknown> = {};

  for (const question of questions) {
    const answer = responses[question.questionId];
    const answerResult = validateAnswerForQuestion(question, answer);

    if (isValidationFail(answerResult)) {
      return answerResult;
    }

    if (answerResult.hasValue) {
      normalized[question.questionId] = answerResult.value;
    }
  }

  return succeedResponses(normalized);
};

const feedbackHelpers: FeedbackHelpers = {
  parseFormType,
  ensureDefaultOverallRatingQuestion,
  getFeedbackQuestionsForType,
  isFeedbackEnabledForType,
  normalizeFeedbackQuestions,
  validateFeedbackPayload,
  normalizeText,
};

export default feedbackHelpers;
