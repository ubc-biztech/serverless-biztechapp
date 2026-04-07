import { v4 as uuidv4 } from "uuid";

const FEEDBACK_FORM_TYPES = new Set(["attendee", "partner"]);
const FEEDBACK_QUESTION_TYPES = new Set([
  "SHORT_TEXT",
  "LONG_TEXT",
  "MULTIPLE_CHOICE",
  "CHECKBOXES",
  "LINEAR_SCALE"
]);

const FORM_CONFIG = {
  attendee: {
    enabledField: "attendeeFeedbackEnabled",
    questionsField: "attendeeFeedbackQuestions"
  },
  partner: {
    enabledField: "partnerFeedbackEnabled",
    questionsField: "partnerFeedbackQuestions"
  }
};

const FEEDBACK_TEXT_LIMITS = {
  SHORT_TEXT: 280,
  LONG_TEXT: 4000
};

const MAX_FEEDBACK_QUESTIONS_PER_FORM = 50;
const OVERALL_RATING_QUESTION_ID = "overall-rating";
const DEFAULT_OVERALL_RATING_QUESTION = {
  questionId: OVERALL_RATING_QUESTION_ID,
  type: "LINEAR_SCALE",
  label: "How would you rate this event overall?",
  required: true,
  scaleMin: 1,
  scaleMax: 10,
  scaleMinLabel: "Poor",
  scaleMaxLabel: "Excellent"
};

const fail = (error) => ({
  isValid: false,
  error
});

const succeedQuestions = (questions) => ({
  isValid: true,
  questions
});

const succeedResponses = (responses) => ({
  isValid: true,
  responses
});

const normalizeText = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeChoices = (choicesValue) => {
  if (Array.isArray(choicesValue)) {
    return choicesValue.map((choice) => normalizeText(choice)).filter(Boolean);
  }

  if (typeof choicesValue !== "string") return [];
  return choicesValue
    .split(",")
    .map((choice) => choice.trim())
    .filter(Boolean);
};

const getFormConfig = (formType) => FORM_CONFIG[formType] || null;

const parseFormType = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const normalized = raw.toLowerCase();
  if (!FEEDBACK_FORM_TYPES.has(normalized)) return null;
  return normalized;
};

const ensureDefaultOverallRatingQuestion = (questions) => {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const otherQuestions = safeQuestions.filter((question) => {
    return question && question.questionId !== OVERALL_RATING_QUESTION_ID;
  });

  return [{ ...DEFAULT_OVERALL_RATING_QUESTION }].concat(otherQuestions);
};

const getFeedbackQuestionsForType = (eventItem, formType) => {
  const config = getFormConfig(formType);
  if (!config || !eventItem) {
    return ensureDefaultOverallRatingQuestion([]);
  }

  const rawQuestions = eventItem[config.questionsField];
  if (!Array.isArray(rawQuestions)) {
    return ensureDefaultOverallRatingQuestion([]);
  }

  return ensureDefaultOverallRatingQuestion(rawQuestions);
};

const isFeedbackEnabledForType = (eventItem, formType) => {
  const config = getFormConfig(formType);
  if (!config || !eventItem) return false;
  return Boolean(eventItem[config.enabledField]);
};

const buildQuestionPrefix = (formType, index) => {
  return `${formType}FeedbackQuestions[${index}]`;
};

const normalizeQuestionType = (rawQuestion, prefix) => {
  const type = normalizeText(rawQuestion.type).toUpperCase();
  if (!FEEDBACK_QUESTION_TYPES.has(type)) {
    return fail(`${prefix} has unsupported type '${rawQuestion.type}'.`);
  }

  return {
    isValid: true,
    type
  };
};

const normalizeQuestionLabel = (rawQuestion, prefix) => {
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

const normalizeQuestionId = (rawQuestion, formType, questionIdSet) => {
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

const appendSelectableQuestionFields = (question, rawQuestion, prefix) => {
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

const appendScaleQuestionFields = (question, rawQuestion, prefix) => {
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
  rawQuestion,
  index,
  formType,
  questionIdSet
) => {
  const prefix = buildQuestionPrefix(formType, index);

  if (
    !rawQuestion ||
    typeof rawQuestion !== "object" ||
    Array.isArray(rawQuestion)
  ) {
    return fail(`${prefix} is invalid.`);
  }

  const typeResult = normalizeQuestionType(rawQuestion, prefix);
  if (!typeResult.isValid) return typeResult;

  const labelResult = normalizeQuestionLabel(rawQuestion, prefix);
  if (!labelResult.isValid) return labelResult;

  const idResult = normalizeQuestionId(rawQuestion, formType, questionIdSet);
  if (!idResult.isValid) return idResult;

  const question = {
    questionId: idResult.questionId,
    type: typeResult.type,
    label: labelResult.label,
    required: Boolean(rawQuestion.required)
  };

  if (question.type === "MULTIPLE_CHOICE" || question.type === "CHECKBOXES") {
    const selectableResult = appendSelectableQuestionFields(
      question,
      rawQuestion,
      prefix
    );
    if (!selectableResult.isValid) return selectableResult;
  }

  if (question.type === "LINEAR_SCALE") {
    const scaleResult = appendScaleQuestionFields(
      question,
      rawQuestion,
      prefix
    );
    if (!scaleResult.isValid) return scaleResult;
  }

  return {
    isValid: true,
    question
  };
};

const normalizeFeedbackQuestions = (rawQuestions, formType) => {
  if (!Array.isArray(rawQuestions)) {
    return fail(`${formType}FeedbackQuestions must be an array.`);
  }

  if (rawQuestions.length > MAX_FEEDBACK_QUESTIONS_PER_FORM) {
    return fail(
      `${formType}FeedbackQuestions cannot exceed ${MAX_FEEDBACK_QUESTIONS_PER_FORM} questions.`
    );
  }

  const normalizedQuestions = [];
  const questionIdSet = new Set();

  for (let index = 0; index < rawQuestions.length; index++) {
    const questionResult = normalizeSingleQuestion(
      rawQuestions[index],
      index,
      formType,
      questionIdSet
    );

    if (!questionResult.isValid) {
      return questionResult;
    }

    normalizedQuestions.push(questionResult.question);
  }

  return succeedQuestions(normalizedQuestions);
};

const validateResponseObjectShape = (rawResponses) => {
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

const validateNoUnknownQuestionIds = (questions, responses) => {
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

const validateTextResponse = (question, answer) => {
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

  if (text.length > maxLength) {
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

const validateMultipleChoiceResponse = (question, answer) => {
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

const normalizeCheckboxValues = (answer) => {
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

const validateCheckboxResponse = (question, answer) => {
  const options = normalizeChoices(question.choices);
  const normalizedValueResult = normalizeCheckboxValues(answer);

  if (!normalizedValueResult.isValid) {
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

const validateScaleResponse = (question, answer) => {
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

const validateAnswerForQuestion = (question, answer) => {
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

const validateFeedbackPayload = (questions, rawResponses) => {
  const shapeResult = validateResponseObjectShape(rawResponses);
  if (!shapeResult.isValid) return shapeResult;

  const responses = rawResponses || {};
  const unknownIdResult = validateNoUnknownQuestionIds(questions, responses);
  if (!unknownIdResult.isValid) return unknownIdResult;

  const normalized = {};

  for (const question of questions) {
    const answer = responses[question.questionId];
    const answerResult = validateAnswerForQuestion(question, answer);

    if (!answerResult.isValid) {
      return answerResult;
    }

    if (answerResult.hasValue) {
      normalized[question.questionId] = answerResult.value;
    }
  }

  return succeedResponses(normalized);
};

export default {
  parseFormType,
  ensureDefaultOverallRatingQuestion,
  getFeedbackQuestionsForType,
  isFeedbackEnabledForType,
  normalizeFeedbackQuestions,
  validateFeedbackPayload,
  normalizeText
};
