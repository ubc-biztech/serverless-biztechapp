// Shared types for the BizTech serverless API.

// ─── API Gateway (REST) ──────────────────────────────────────────────

export interface APIGatewayEvent {
  body: string | null;
  headers: Record<string, string | undefined>;
  pathParameters: Record<string, string | undefined> | null;
  queryStringParameters: Record<string, string | undefined> | null;
  requestContext: {
    authorizer?: {
      claims?: Record<string, string>;
    };
    connectionId?: string;
    domainName?: string;
    stage?: string;
  };
  resource?: string;
  httpMethod?: string;
  isBase64Encoded?: boolean;
}

export interface APIGatewayResponse {
  statusCode: number;
  headers?: Record<string, string | boolean>;
  body: string;
}

// ─── API Gateway (WebSocket) ─────────────────────────────────────────

export interface WebSocketRequestContext {
  connectionId: string;
  domainName: string;
  stage: string;
  routeKey?: string;
}

export interface WebSocketEvent {
  body: string | null;
  requestContext: WebSocketRequestContext;
}

export interface WebSocketMessage {
  status: number;
  action: string;
  message?: string;
  data?: unknown;
}

// ─── Lambda ──────────────────────────────────────────────────────────

export interface LambdaContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  getRemainingTimeInMillis(): number;
}

export type LambdaCallback = (
  error: Error | null | string,
  result?: APIGatewayResponse,
) => void;

export type LambdaHandler = (
  event: APIGatewayEvent,
  context: LambdaContext,
  callback: LambdaCallback,
) => Promise<APIGatewayResponse | void>;

// ─── Helpers (lib/handlerHelpers, lib/responseHelpers) ────────────────────────────

export interface PayloadCheckRule {
  required?: boolean;
  type?: "string" | "number" | "boolean" | "object";
}

export type PayloadCheck = Record<string, PayloadCheckRule>;
export type PayloadSchema = Record<string, { required?: boolean; type?: "string" | "number" | "boolean" | "object" }>;

export type InferredPayload<T extends PayloadSchema> = {
  [K in keyof T]: T[K]["type"] extends "string" ? string
  : T[K]["type"] extends "number" ? number
  : T[K]["type"] extends "boolean" ? boolean
  : T[K]["type"] extends "object" ? object
  : unknown;
}


export interface HandlerHelpers {
  createResponse(statusCode: number, body?: unknown): APIGatewayResponse;
  missingIdQueryResponse(type: string): APIGatewayResponse;
  missingPathParamResponse(type: string, paramName: string): APIGatewayResponse;
  notFoundResponse(type?: string | null, id?: string | null, secondaryKey?: string | number | null): APIGatewayResponse;
  duplicateResponse(prop: string, data: unknown): APIGatewayResponse;
  inputError(message: string, data?: unknown): APIGatewayResponse;
  checkPayloadProps(payload: Record<string, unknown>, check: PayloadCheck): void;
}

export interface ResponseHelpers {
  send(statusCode: number, body?: unknown): APIGatewayResponse;
  ok(data?: unknown): APIGatewayResponse;
  created(data?: unknown): APIGatewayResponse;
  noContent(): APIGatewayResponse;
  badRequest(message: string, data?: unknown): APIGatewayResponse;
  unauthorized(message: string): APIGatewayResponse;
  notAcceptable(message: string, data?: unknown): APIGatewayResponse;
  notFound(type?: string, id?: string, secondaryKey?: string): APIGatewayResponse;
  conflict(prop: string, data?: unknown): APIGatewayResponse;
  error(message: string, error?: unknown): APIGatewayResponse;
}

// ─── DynamoDB Helpers (lib/db) ───────────────────────────────────────

export interface UpdateExpressionResult {
  updateExpression: string;
  expressionAttributeValues: Record<string, unknown>;
  expressionAttributeNames: Record<string, string> | null;
}

export interface KeyCondition {
  expression: string;
  expressionValues: Record<string, unknown>;
  expressionNames?: Record<string, string>;
}

export interface ScanFilters {
  FilterExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
  ExpressionAttributeNames?: Record<string, string>;
}

export interface DynamoErrorResponse {
  statusCode: number;
  headers: Record<string, string | boolean>;
  type: string;
  body: string;
}

export interface DB {
  dynamoErrorResponse(err: unknown): DynamoErrorResponse;
  createUpdateExpression(obj: Record<string, unknown>): UpdateExpressionResult;
  create(item: Record<string, unknown>, table: string): Promise<unknown>;
  getOne(
    id: string,
    table: string,
    extraKeys?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  getOneCustom(params: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  scan(
    table: string,
    filters?: ScanFilters,
    indexName?: string | null,
  ): Promise<Record<string, unknown>[]>;
  batchGet(batch: Record<string, unknown>[], tableName: string): Promise<unknown>;
  batchDelete(items: Record<string, unknown>[], tableName: string): Promise<unknown>;
  deleteOne(
    id: string,
    table: string,
    extraKeys?: Record<string, unknown>,
  ): Promise<unknown>;
  updateDB(
    id: string,
    obj: Record<string, unknown>,
    table: string,
  ): Promise<unknown>;
  updateDBCustom(params: Record<string, unknown>): Promise<unknown>;
  put(
    obj: Record<string, unknown>,
    table: string,
    createNew?: boolean,
  ): Promise<unknown>;
  putMultiple(
    items: Record<string, unknown>[],
    tables: string[],
    createNew?: boolean,
  ): Promise<unknown>;
  writeMultiple(transactItems: Record<string, unknown>[]): Promise<unknown>;
  query(
    table: string,
    indexName: string | null,
    keyCondition: KeyCondition,
    filters?: ScanFilters,
  ): Promise<Record<string, unknown>[]>;
}

// ─── SES / Email ─────────────────────────────────────────────────────

export interface EmailMessage {
  to: string | string[];
  html: string;
  subject: string;
  from?: string;
}

// ─── SNS ─────────────────────────────────────────────────────────────

export interface SNSNotificationPayload {
  type: string;
  [key: string]: unknown;
}

// ─── Common registration status across services ──────────────────────

export type RegistrationStatus =
  | "registered"
  | "checkedIn"
  | "waitlist"
  | "cancelled";

// ─── Event counts (used by registrations + events helpers) ───────────

export interface EventCounts {
  registeredCount: number;
  checkedInCount: number;
  waitlistCount: number;
  dynamicCounts: DynamicQuestionCount[];
}

export interface DynamicQuestionCount {
  questionId: string;
  counts: { label: string; count: number; cap: number }[];
}
