import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { SEED_PRICE, SEED_WINDOW_MS, QUOTE_WINDOW_MS } from "./constants";
import {
  BtxError,
  buildProjectId,
  configuredEvent,
  eventEndsAtMs,
  getEventConfig,
  roundMoney
} from "./helpers";
import { currentTeamMember, eligibleRegistration } from "./eligibility";
import { seedTradeQuote, seedStatus } from "./pricing";
import { getProject } from "./repos/projects";
import {
  EVENT_ACCOUNTS_TABLE,
  PRICES_TABLE,
  PROJECTS_TABLE,
  REGISTRATIONS_TABLE,
  TEAMS_TABLE
} from "./repos/tables";
import { ensureAccount } from "./repos/accounts";
import type { BtxProject } from "./types";

/** IPO creates the config row; missing or null ipoAt means pre-IPO. */
function preIpoCheck(projectId: string) {
  return {
    ConditionCheck: {
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      ConditionExpression: "attribute_not_exists(ipoAt) OR ipoAt = :null",
      ExpressionAttributeValues: { ":null": null }
    }
  };
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
  const now = Date.now();
  const project: BtxProject = {
    projectId,
    eventId,
    companyName:
      input.companyName ?? input.name ?? input.ticker ?? input.teamCode,
    blurb: input.blurb ?? input.description ?? "",
    youtubeURL: input.youtubeURL ?? "",
    name: input.companyName ?? input.name ?? input.ticker ?? input.teamCode,
    description: input.blurb ?? input.description ?? "",
    ticker: input.ticker,
    basePrice: SEED_PRICE,
    currentPrice: SEED_PRICE,
    netShares: 0,
    version: 1,
    seedStartedAt: null,
    seedEndsAt: null,
    seedSharesAtIpo: null,
    lastPriceTs: now,
    isActive: true,
    createdAt: now,
    updatedAt: now
  };
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        preIpoCheck(config.projectId),
        {
          Put: {
            TableName: PROJECTS_TABLE,
            Item: project,
            ConditionExpression: "attribute_not_exists(projectId)"
          }
        },
        {
          Put: {
            TableName: PRICES_TABLE,
            Item: {
              projectId,
              ts: now,
              price: SEED_PRICE,
              source: "INITIAL"
            },
            ConditionExpression: "attribute_not_exists(projectId)"
          }
        }
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
    ipoAt,
    version: project.version
  };
}

export async function startSeeding(userId: string, projectId: string) {
  const project = await getProject(projectId);
  const membership = await currentTeamMember(userId, projectId);
  const config = await getEventConfig();
  if (project.seedStartedAt != null && project.seedEndsAt != null)
    return seedResponse(project, config.ipoAt);
  if (project.isActive === false) throw new BtxError(409, "Inactive listing");
  const now = Date.now();
  const updated = {
    ...project,
    seedStartedAt: now,
    seedEndsAt: now + SEED_WINDOW_MS,
    version: (project.version ?? 0) + 1
  };
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        preIpoCheck(config.projectId),
        {
          ConditionCheck: {
            TableName: REGISTRATIONS_TABLE,
            Key: { "id": userId, "eventID;year": configuredEvent() },
            ConditionExpression:
              "registrationStatus = :status AND teamID = :team",
            ExpressionAttributeValues: {
              ":status": "acceptedComplete",
              ":team": membership.teamCode
            }
          }
        },
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
              "SET seedStartedAt = :s, seedEndsAt = :e, updatedAt = :s, version = :next",
            ConditionExpression:
              "version = :version AND (attribute_not_exists(seedStartedAt) OR seedStartedAt = :null) AND (attribute_not_exists(seedEndsAt) OR seedEndsAt = :null)",
            ExpressionAttributeValues: {
              ":s": now,
              ":e": updated.seedEndsAt,
              ":version": project.version,
              ":next": updated.version,
              ":null": null
            }
          }
        }
      ]
    })
  );
  return seedResponse(updated, null, now);
}

/** Lazy IPO: company snapshots/history belong to first live mutation and PR3's worker. */
export async function launchIpo() {
  const config = await getEventConfig();
  if (config.ipoAt != null)
    return {
      ipoAt: config.ipoAt,
      live: true,
      repeated: true,
      serverTime: Date.now()
    };
  const now = Date.now();
  await docClient.send(
    new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId: config.projectId },
      UpdateExpression: "SET ipoAt = :now",
      ConditionExpression: "attribute_not_exists(ipoAt) OR ipoAt = :null",
      ExpressionAttributeValues: { ":now": now, ":null": null }
    })
  );
  return { ipoAt: now, live: true, repeated: false, serverTime: now };
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
  if (project.isActive === false) throw new BtxError(409, "Inactive listing");
  if (
    registration.teamID &&
    project.projectId === buildProjectId(configuredEvent(), registration.teamID)
  )
    throw new BtxError(403, "Cannot trade your own company", {
      code: "FORBIDDEN"
    });
  const quote = seedTradeQuote(
    project,
    config.ipoAt,
    now,
    params.side,
    params.shares
  );
  const live = config.ipoAt != null;
  return {
    ...quote,
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
    version: project.version,
    totalCost: params.side === "BUY" ? -quote.cashDelta : null,
    proceeds: params.side === "SELL" ? quote.cashDelta : null,
    seedStartedAt: project.seedStartedAt ?? null,
    seedEndsAt: project.seedEndsAt ?? null,
    seedStatus: seedStatus(project, config.ipoAt, now),
    allowedSides: live ? ["BUY", "SELL"] : ["BUY"]
  };
}

/** One receipt per target: a partial batch is safely resumed with the same requestId. */
export async function applyGrant(params: {
  requestId: string;
  amount: number;
  targetEmails: string[];
}) {
  if (
    !params.requestId ||
    params.amount <= 0 ||
    params.amount !== roundMoney(params.amount)
  ) {
    throw new BtxError(
      400,
      "requestId and a positive two-decimal amount required",
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
  const amount = params.amount;
  // A manifest binds the complete batch, including targets, to requestId.
  const manifestId = `grant:${eventId}:${params.requestId}`;
  const manifest = { projectId: manifestId, amount, targets };
  const { Item: existingGrant } = await docClient.send(
    new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId: manifestId },
      ConsistentRead: true
    })
  );
  if (existingGrant) {
    if (
      existingGrant.amount !== amount ||
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
        cashBalance: receipt.Item.cashBalance,
        repeated: true
      });
      continue;
    }
    try {
      const account = await ensureAccount(userId);
      const balance = roundMoney(account.cashBalance + amount);
      const allocated = roundMoney(account.totalAllocated + amount);
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: REGISTRATIONS_TABLE,
                Key: { "id": userId, "eventID;year": eventId },
                ConditionExpression: "registrationStatus = :status",
                ExpressionAttributeValues: { ":status": "acceptedComplete" }
              }
            },
            {
              Put: {
                TableName: PROJECTS_TABLE,
                Item: {
                  projectId: receiptId,
                  amount,
                  cashBalance: balance
                },
                ConditionExpression: "attribute_not_exists(projectId)"
              }
            },
            {
              Update: {
                TableName: EVENT_ACCOUNTS_TABLE,
                Key: { userId, eventId },
                UpdateExpression:
                  "SET cashBalance = :cash, totalAllocated = :allocated, version = :next, updatedAt = :now",
                ConditionExpression: "version = :version",
                ExpressionAttributeValues: {
                  ":cash": balance,
                  ":allocated": allocated,
                  ":version": account.version,
                  ":next": account.version + 1,
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
        cashBalance: balance,
        repeated: false
      });
    } catch (error) {
      if (!(error instanceof BtxError)) throw error;
      outcomes.push({ userId, status: "REJECTED", message: error.message });
    }
  }
  return { requestId: params.requestId, amount, outcomes };
}
