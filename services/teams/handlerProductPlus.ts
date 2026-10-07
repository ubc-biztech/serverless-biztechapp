import db from "../../lib/db.js";
import res from "../../lib/responseHelpers";
import helpers from "../../lib/handlerHelpers";
import { Access, protect } from "../../lib/auth";
import type { APIGatewayResponse, LambdaHandler } from "../../lib/types";
import { getEventKey, getVotingConfig, submissionsTable, tableName, isVotingOpen, getPrdViewUrl } from "./helpersProductPlus.temporary";
import type { Submission, Rubric, RankedSubmission } from "./typesProductPlus.temporary";
import { PRODUCT_PLUS_RUBRIC_SCORE_RANGE } from "./constants";
import type { AuthEvent } from "../../lib/auth";

// TODO maybe refactor with one outer try and the  || eg teams/handler.ts
// const errorMessage = (error: unknown): string =>
//   error instanceof Error ? error.message : String(error);

const handle = (handler: LambdaHandler): LambdaHandler => async (event, context, callback) => {
  try {
    return await handler(event, context, callback);
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error)
      return error as APIGatewayResponse;
    console.error(error);
    return res.send(500, { message: "Internal server error" });
  }
};

export const audienceSubmissions = protect(Access.PUBLIC, handle(async (event) => {
  const user_id = (event as AuthEvent).auth?.email;
  const event_key = getEventKey();
  const config = await getVotingConfig(event_key);
  const filters = {
    FilterExpression: "#event = :event AND #team <> :config",
    ProjectionExpression: "#team, team_name, video_url, voter_ids",
    ExpressionAttributeNames: { "#event": "event_key", "#team": "team_code" },
    ExpressionAttributeValues: { ":event": event_key, ":config": "config" }
  }
  const rows = await db.scan(submissionsTable(), filters) as
    (Pick<Submission, "team_code" | "team_name" | "video_url"> & { voter_ids?: Set<string> })[];
  
  const submissions = rows.map(row => ({
  team_code: row.team_code, team_name: row.team_name, video_url: row.video_url,
  has_voted: user_id ? (row.voter_ids?.has(user_id) ?? false) : null
  }));

  for (let i = submissions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [submissions[i], submissions[j]] = [submissions[j], submissions[i]];
  }

  return res.ok({ voting_opens_at: config.submission_deadline,
    voting_deadline: config.voting_deadline, voting_open: isVotingOpen(config), submissions });
}));

// TODO: new voting_enabled field in config, how does affect?
export const audienceVote = protect(Access.USER, handle(async (event) => {
  let data;
  try { 
    data = JSON.parse(event.body || "{}"); 
  }
  catch { 
    return helpers.inputError("Send a JSON object"); 
  }
  helpers.checkPayloadProps(data, {
    team_code: { required: true, type: "string" },
    choice: { required: true, type: "string" }
  });
  if (!/^\d{6}$/.test(data.team_code))
    return helpers.inputError("Send a six-digit team_code");
  if (!["accept", "reject"].includes(data.choice))
    return helpers.inputError("Choice must be accept or reject");
  const event_key = getEventKey();
  const config = await getVotingConfig(event_key);
  if (!isVotingOpen(config)) return res.send(403, { message: "Voting is closed" });
  const user_id = (event as AuthEvent).auth!.email;
  try {
    await db.updateDBCustom({
      // TODO see if tableName() is necessary or only used once
      TableName: tableName(), Key: { event_key, team_code: data.team_code },
      UpdateExpression: "ADD voter_ids :voters, #counter :one",
      ConditionExpression: "attribute_exists(event_key) AND attribute_exists(team_code) AND (attribute_not_exists(voter_ids) OR NOT contains(voter_ids, :uid))",
      ExpressionAttributeNames: { "#counter": data.choice === "accept" ? "upvotes" : "downvotes" },
      ExpressionAttributeValues: { ":voters": new Set([user_id]), ":uid": user_id, ":one": 1 }
    });
  } catch (error) {
    if (error && typeof error === "object" && "type" in error && error.type === "ConditionalCheckFailedException")
      return res.send(409, { message: "Submission does not exist or you have already voted" });
    throw error;
  }
  return res.ok({ has_voted: true });
}));

export const saveRubric = protect(Access.ADMIN, handle(async (event) => {
  const team_code = event.pathParameters?.team_code;
  if (!team_code || !/^\d{6}$/.test(team_code))
    return helpers.inputError("Send a six-digit team_code in the path");
  let data;
  try { 
    data = JSON.parse(event.body || "{}"); 
  }
  catch { 
    return helpers.inputError("Send a JSON object"); 
  }
  
  if (!data || !Array.isArray(data.scores) || data.scores.length !== 5)
  return helpers.inputError("Send exactly five scores");

if (typeof data.comments !== "string")
  return helpers.inputError("Comments must be a string");

  const { min, max } = PRODUCT_PLUS_RUBRIC_SCORE_RANGE;
  const validScores = data.scores.every((score: unknown) =>
    typeof score === "number" && score >= min && score <= max);
  if (!validScores)
    return helpers.inputError(`Scores must be numbers between ${min} and ${max}`);

  const rubric: Rubric = {
    judge_user_id: (event as AuthEvent).auth!.email,
    scores: data.scores, 
    comments: data.comments
  };
  const Key = { event_key: getEventKey(), team_code };
  //  Read it with its updated_at, replace this judge's entry, and write with a condition that updated_at hasn't changed. Retry on failure.
  for (let attempt = 0; attempt < 5; attempt++) {
    const submission = await db.getOneCustom({ TableName: tableName(), Key, ConsistentRead: true }) as
      (Pick<Submission, "updated_at"> & { graded_submissions?: Rubric[] }) | null;
    if (!submission) return res.notFound("submission", team_code);
    const rubrics = [...(submission.graded_submissions || [])];
    const index = rubrics.findIndex(saved => saved.judge_user_id === rubric.judge_user_id);
    if (index === -1) {
      rubrics.push(rubric);
    } 
    else {
      rubrics[index] = rubric;
    } 
    const updated_at = new Date(Math.max(Date.now(),
      (Date.parse(submission.updated_at) || 0) + 1)).toISOString();
    const hasVersion = submission.updated_at !== undefined;
    try {
      await db.updateDBCustom({
        TableName: tableName(), Key,
        UpdateExpression: "SET graded_submissions = :rubrics, updated_at = :updated",
        ConditionExpression: "attribute_exists(event_key) AND attribute_exists(team_code) AND " +
          (hasVersion ? "updated_at = :previous" : "attribute_not_exists(updated_at)"),
        ExpressionAttributeValues: {
          ":rubrics": rubrics, ":updated": updated_at,
          ...(hasVersion ? { ":previous": submission.updated_at } : {})
        }
      });
      return res.ok(rubric);
    } catch (error) {
      if (!error || typeof error !== "object" || !("type" in error) ||
        error.type !== "ConditionalCheckFailedException") throw error;
    }
  }
  return res.send(409, { message: "Submission changed during saving; please retry" });
}));



export const adminSubmissions = protect(Access.ADMIN, handle(async () => {
  const event_key = getEventKey();
  const filters = {
    FilterExpression: "#event = :event AND #team <> :config",
    ProjectionExpression: "#team, team_name, graded_submissions, upvotes, downvotes",
    ExpressionAttributeNames: { "#event": "event_key", "#team": "team_code" },
    ExpressionAttributeValues: { ":event": event_key, ":config": "config" }
  };
  const rows = await db.scan(submissionsTable(), filters) as
    (Pick<Submission, "team_code" | "team_name"> & {
      graded_submissions?: Rubric[];
      upvotes?: number;
      downvotes?: number;
    })[];

  const submissions: RankedSubmission[] = rows.map(row => {
    const rubrics = row.graded_submissions ?? [];
    const rubric_total = rubrics.reduce((total, rubric) =>
      total + rubric.scores.reduce((sum, score) => sum + score, 0), 0);
    const upvotes = row.upvotes ?? 0;
    const downvotes = row.downvotes ?? 0;
    return {
      team_code: row.team_code,
      team_name: row.team_name,
      rubric_average: rubrics.length ? rubric_total / rubrics.length : null,
      rubric_count: rubrics.length,
      upvotes,
      downvotes,
      audience_score: upvotes - downvotes
    };
  });

  return res.ok(submissions);
}));

export const adminSubmission = protect(Access.ADMIN, handle(async (event) => {
  const team_code = event.pathParameters?.team_code;
  if (!team_code || !/^\d{6}$/.test(team_code))
    return helpers.inputError("Send a six-digit team_code in the path");
  const submission = await db.getOneCustom({
    TableName: tableName(), Key: { event_key: getEventKey(), team_code }, ConsistentRead: true
  }) as (Omit<Submission, "prd_view_url"> & {
    graded_submissions?: Rubric[];
    upvotes?: number;
    downvotes?: number;
  }) | null;
  if (!submission) return res.notFound("submission", team_code);

  const prd_view_url = await getPrdViewUrl(submission.prd_path);
  return res.ok({
    team_code: submission.team_code,
    team_name: submission.team_name,
    member_names: submission.member_names,
    video_url: submission.video_url,
    prd_path: submission.prd_path,
    prd_view_url,
    submitted_at: submission.submitted_at,
    updated_at: submission.updated_at,
    graded_submissions: submission.graded_submissions ?? [],
    upvotes: submission.upvotes ?? 0,
    downvotes: submission.downvotes ?? 0
  });
}));
