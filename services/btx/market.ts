import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { SEED_WINDOW_MS, QUOTE_WINDOW_MS } from "./constants";
import {
  BtxError,
  buildProjectId,
  configuredEvent,
  eventEndsAtMs,
  getEventConfig,
  buildMarketPhaseCheck,
  requireMarketOpen,
  requireSafeCents
} from "./helpers";
import { buildEligibilityCheck, currentTeamMember, eligibleRegistration } from "./eligibility";
import { ipoStockPriceCents, tradeQuote, seedStatus, stockPriceCents } from "./pricing";
import { getProject, listProjectsForIpo } from "./repos/projects";
import { buildInitialCompany } from "./projects";
import {
  EVENT_ACCOUNTS_TABLE,
  PRICES_TABLE,
  PROJECTS_TABLE,
  TEAMS_TABLE
} from "./repos/tables";
import { ensureAccount } from "./repos/accounts";
import type { BtxEventConfig, BtxProject } from "./types";
import { publishMarketUpdate } from "./sockets";

function requirePreIpo(config: BtxEventConfig) {
  requireMarketOpen(config);
  if (config.phase !== "PRE_IPO") throw new BtxError(409, "IPO has already started.");
}

export async function initializeMarketListing(input: {
  teamCode: string;
  ticker?: string;
  name?: string;
  description?: string;
  companyName?: string;
  blurb?: string;
  youtubeURL?: string;
}) {
  const eventId = configuredEvent();
  const projectId = buildProjectId(eventId, input.teamCode);
  const { Item: existing } = await docClient.send(
    new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      ConsistentRead: true
    })
  );
  if (existing) return { project: existing as BtxProject, created: false };
  const config = await getEventConfig();
  requirePreIpo(config);
  const now = Date.now();

  const companyName = input.companyName ?? input.name ?? input.ticker ?? input.teamCode;
  const blurb = input.blurb ?? input.description ?? "";
  const [companyWrite, priceWrite] = buildInitialCompany({
    eventId, teamId: input.teamCode, companyName
  }).map(write => write.build());
  const project = {
    ...companyWrite.Put!.Item,
    blurb,
    youtubeURL: input.youtubeURL || "",
    name: companyName,
    description: blurb,
    ticker: input.ticker,
    isActive: true,
    createdAt: now,
    updatedAt: now
  } as BtxProject;
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        buildMarketPhaseCheck(config).build(),
        {
          Put: {
            ...companyWrite.Put!,
            Item: project,
          }
        },
        priceWrite
      ]
    })
  );
  return { project, created: true };
}

function seedResponse(
  project: BtxProject,
  ipoAt: number | null,
  now = Date.now()
) {
  return {
    projectId: project.projectId,
    eventId: project.eventId,
    seedStartedAt: project.seedStartedAt,
    seedEndsAt: project.seedEndsAt,
    seedStatus: seedStatus(project, ipoAt, now),
    serverTime: now,
    ipoAt
  };
}

export async function startSeeding(userId: string, projectId: string) {
  const project = await getProject(projectId);
  const membership = await currentTeamMember(userId, projectId);
  const config = await getEventConfig();
  requireMarketOpen(config);
  if (project.seedStartedAt != null && project.seedEndsAt != null)
    return seedResponse(project, config.ipoAt);
  if (project.isActive === false) throw new BtxError(409, "Inactive listing");
  const now = Date.now();
  requirePreIpo(config);
  if (now >= eventEndsAtMs()) throw new BtxError(409, "Event ended", { code: "EVENT_ENDED" });
  const updated = {
    ...project,
    seedStartedAt: now,
    seedEndsAt: now + SEED_WINDOW_MS
  };
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        buildMarketPhaseCheck(config).build(),
        buildEligibilityCheck(userId, membership.teamCode).build(),
        {
          ConditionCheck: {
            TableName: TEAMS_TABLE,
            Key: membership.key,
            ConditionExpression: "contains(member_ids, :user)",
            ExpressionAttributeValues: { ":user": userId }
          }
        },
        {
          Update: {
            TableName: PROJECTS_TABLE,
            Key: { projectId },
            UpdateExpression:
              "SET seedStartedAt = :s, seedEndsAt = :e, updatedAt = :s ADD version :one",
            ConditionExpression:
              "(attribute_not_exists(seedStartedAt) OR seedStartedAt = :null) AND (attribute_not_exists(seedEndsAt) OR seedEndsAt = :null)",
            ExpressionAttributeValues: {
              ":s": now,
              ":e": updated.seedEndsAt,
              ":null": null,
              ":one": 1
            }
          }
        }
      ]
    })
  );
  await publishMarketUpdate(seedResponse(updated, null, now));
  return seedResponse(updated, null, now);
}

export async function launchIpo() {
  let config = await getEventConfig();
  if (config.phase === "LIVE") return;
  if (config.phase === "PRE_IPO") {
    // Close team formation and trading before listing companies
    await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE, Key: { projectId: config.projectId },
      UpdateExpression: "SET phase = :preparing",
      ConditionExpression: "phase = :pre AND ipoAt = :null",
      ExpressionAttributeValues: { ":preparing": "IPO_PREPARING", ":pre": "PRE_IPO", ":null": null }
    }));
    config = { ...config, phase: "IPO_PREPARING" };
  }
  const projects = await listProjectsForIpo();
  if (config.ipoPriceTs === undefined) {
    const priceTs = projects.reduce((ts, project) => Math.max(ts, project.lastPriceTs + 1), Date.now());
    await docClient.send(new UpdateCommand({
      TableName: PROJECTS_TABLE, Key: { projectId: config.projectId },
      UpdateExpression: "SET ipoPriceTs = if_not_exists(ipoPriceTs, :ts)",
      ConditionExpression: "phase = :preparing AND ipoAt = :null",
      ExpressionAttributeValues: { ":ts": priceTs, ":preparing": "IPO_PREPARING", ":null": null }
    }));
    config = await getEventConfig();
  }
  const ipoAt = config.ipoPriceTs;
  if (config.phase !== "IPO_PREPARING" || ipoAt === undefined) {
    throw new BtxError(503, "IPO preparation state changed.", { code: "TRANSITION_UNAVAILABLE" });
  }
  for (const project of projects) {
    const { projectId, netShares } = project;
    if (project.seedSharesAtIpo != null) {
      if (project.lastPriceTs !== ipoAt) throw new BtxError(503, "IPO snapshot needs reconciliation.");
      continue; // A previous invocation committed this company and its history together.
    }
    const priceCents = ipoStockPriceCents(netShares);
    await docClient.send(new TransactWriteCommand({ TransactItems: [
      buildMarketPhaseCheck(config).build(),
      {
        Update: {
          TableName: PROJECTS_TABLE,
          Key: { projectId },
          UpdateExpression:
            "SET seedSharesAtIpo = :shares, currentPriceCents = :price, lastPriceTs = :ipoAt, updatedAt = :now ADD version :one",
          ConditionExpression: "attribute_exists(projectId) AND netShares = :shares AND lastPriceTs = :before AND (attribute_not_exists(seedSharesAtIpo) OR seedSharesAtIpo = :null)",
          ExpressionAttributeValues: {
            ":shares": netShares,
            ":price": priceCents,
            ":ipoAt": ipoAt,
            ":now": Date.now(),
            ":before": project.lastPriceTs,
            ":null": null,
            ":one": 1
          }
        }
      },
      {
        Put: {
          TableName: PRICES_TABLE,
          Item: { projectId, ts: ipoAt, priceCents, source: "IPO" },
          ConditionExpression: "attribute_not_exists(projectId)"
        }
      }
    ] }));
  }
  await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE, Key: { projectId: config.projectId },
    UpdateExpression: "SET phase = :live, ipoAt = :ipoAt",
    ConditionExpression: "phase = :preparing AND ipoAt = :null AND ipoPriceTs = :ipoAt",
    ExpressionAttributeValues: { ":live": "LIVE", ":ipoAt": ipoAt, ":preparing": "IPO_PREPARING", ":null": null }
  }));
  await publishMarketUpdate({
    eventId: configuredEvent(),
    ipoAt,
    phase: "LIVE",
    serverTime: Date.now()
  });
}

export async function getQuote(params: {
  projectId: string;
  side: "BUY" | "SELL";
  shares: number;
  userId: string;
}) {
  const registration = await eligibleRegistration(params.userId);
  const [project, config] = await Promise.all([
    getProject(params.projectId),
    getEventConfig()
  ]);
  const now = Date.now();
  requireMarketOpen(config);
  if (project.isActive === false) throw new BtxError(409, "Inactive listing");
  if (
    registration.teamID &&
    project.projectId === buildProjectId(configuredEvent(), registration.teamID)
  )
    throw new BtxError(403, "Cannot trade your own company", {
      code: "FORBIDDEN"
    });
  if (now >= eventEndsAtMs())
    throw new BtxError(409, "Event ended", { code: "EVENT_ENDED" });
  const quote = tradeQuote(
    project,
    config.ipoAt,
    now,
    params.side,
    params.shares
  );
  const live = config.phase === "LIVE";
  return {
    ...quote,
    startPriceCents: stockPriceCents(project, config.ipoAt),
    projectId: project.projectId,
    eventId: project.eventId,
    phase: live ? "LIVE" : "SEED",
    live,
    ipoAt: config.ipoAt,
    serverTime: now,
    expiresAt: Math.min(
      now + QUOTE_WINDOW_MS,
      eventEndsAtMs(),
      live ? Infinity : project.seedEndsAt!
    ),
    side: params.side,
    shares: params.shares,
    totalCostCents: params.side === "BUY" ? -quote.cashDeltaCents : null,
    proceedsCents: params.side === "SELL" ? quote.cashDeltaCents : null,
    seedStartedAt: project.seedStartedAt ?? null,
    seedEndsAt: project.seedEndsAt ?? null,
    seedStatus: seedStatus(project, config.ipoAt, now),
    allowedSides: live ? ["BUY", "SELL"] : ["BUY"]
  };
}

/** One receipt per target: a partial batch is safely resumed with the same requestId. */
export async function applyGrant(params: {
  requestId: string;
  amountCents: number;
  targetEmails: string[];
}) {
  const amountCents = requireSafeCents(params.amountCents, "amountCents");
  if (!params.requestId || amountCents <= 0) {
    throw new BtxError(
      400,
      "requestId and a positive amount required",
      { code: "VALIDATION_ERROR" }
    );
  }
  const targets = [
    ...new Set(params.targetEmails.map((email) => email.trim().toLowerCase()))
  ].sort();
  if (targets.some((email) => !email.includes("@"))) {
    throw new BtxError(400, "targets must contain participant email addresses");
  }
  if (!targets.length || targets.length > 100) {
    throw new BtxError(400, "Provide 1–100 participant email addresses", {
      code: "VALIDATION_ERROR"
    });
  }
  const eventId = configuredEvent();
  // A manifest binds the complete batch, including targets, to requestId.
  const manifestId = `grant:${eventId}:${params.requestId}`;
  const manifest = { projectId: manifestId, amountCents, targets };
  const { Item: existingGrant } = await docClient.send(
    new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId: manifestId },
      ConsistentRead: true
    })
  );
  if (existingGrant) {
    if (
      existingGrant.amountCents !== amountCents ||
      JSON.stringify(existingGrant.targets) !== JSON.stringify(targets)
    ) {
      throw new BtxError(409, "requestId reused with different grant details");
    }
  } else {
    await docClient.send(
      new PutCommand({
        TableName: PROJECTS_TABLE,
        Item: manifest,
        ConditionExpression: "attribute_not_exists(projectId)"
      })
    );
  }
  const outcomes: Record<string, unknown>[] = [];
  for (const userId of targets) {
    const receiptId = `${manifestId}:${userId}`;
    const receipt = await docClient.send(
      new GetCommand({
        TableName: PROJECTS_TABLE,
        Key: { projectId: receiptId },
        ConsistentRead: true
      })
    );
    if (receipt.Item) {
      outcomes.push({
        userId,
        status: "APPLIED",
        cashBalanceCents: receipt.Item.cashBalanceCents,
        repeated: true
      });
      continue;
    }
    try {
      const account = await ensureAccount(userId);
      const balanceCents = account.cashBalanceCents + amountCents;
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            buildEligibilityCheck(userId).build(),
            {
              Put: {
                TableName: PROJECTS_TABLE,
                Item: {
                  projectId: receiptId,
                  amountCents,
                  cashBalanceCents: balanceCents
                },
                ConditionExpression: "attribute_not_exists(projectId)"
              }
            },
            {
              Update: {
                TableName: EVENT_ACCOUNTS_TABLE,
                Key: { userId, eventId },
                UpdateExpression:
                  "SET updatedAt = :now ADD cashBalanceCents :amount, totalAllocatedCents :amount",
                ExpressionAttributeValues: {
                  ":amount": amountCents,
                  ":now": Date.now()
                }
              }
            }
          ]
        })
      );
      outcomes.push({
        userId,
        status: "APPLIED",
        cashBalanceCents: balanceCents,
        repeated: false
      });
    } catch (error) {
      if (!(error instanceof BtxError)) throw error;
      outcomes.push({ userId, status: "REJECTED", message: error.message });
    }
  }
  return { requestId: params.requestId, amountCents, outcomes };
}
