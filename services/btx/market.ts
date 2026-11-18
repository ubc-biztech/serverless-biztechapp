import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput
} from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { SEED_PRICE_CENTS, SEED_WINDOW_MS, QUOTE_WINDOW_MS } from "./constants";
import {
  BtxError,
  buildProjectId,
  configuredEvent,
  eventEndsAtMs,
  getEventConfig,
  requireSafeCents
} from "./helpers";
import { currentTeamMember, eligibleRegistration } from "./eligibility";
import { ipoStockPriceCents, tradeQuote, seedStatus } from "./pricing";
import { getProject, listProjectsForEvent } from "./repos/projects";
import {
  EVENT_ACCOUNTS_TABLE,
  PRICES_TABLE,
  PROJECTS_TABLE,
  REGISTRATIONS_TABLE,
  TEAMS_TABLE
} from "./repos/tables";
import { ensureAccount } from "./repos/accounts";
import type { BtxProject } from "./types";
import { publishMarketUpdate } from "./sockets";

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

  let companyName = input.companyName ?? input.name ?? input.ticker ?? input.teamCode;
  let blurb = input.blurb ?? input.description ?? "";

  const project: BtxProject = {
    projectId,
    eventId,
    companyName,
    blurb,
    youtubeURL: input.youtubeURL || "",
    name: companyName,
    description: blurb,
    ticker: input.ticker,
    currentPriceCents: SEED_PRICE_CENTS,
    netShares: 0,
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
              priceCents: SEED_PRICE_CENTS,
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
    ipoAt
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
    seedEndsAt: now + SEED_WINDOW_MS
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
              "SET seedStartedAt = :s, seedEndsAt = :e, updatedAt = :s",
            ConditionExpression:
              "(attribute_not_exists(seedStartedAt) OR seedStartedAt = :null) AND (attribute_not_exists(seedEndsAt) OR seedEndsAt = :null)",
            ExpressionAttributeValues: {
              ":s": now,
              ":e": updated.seedEndsAt,
              ":null": null
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
  const config = await getEventConfig();
  if (config.ipoAt != null) return;

  const listings = await listProjectsForEvent();
  
  // Read the share counts from the base table so the last seed trade is included.
  const projects = await Promise.all(
    listings.map(({ projectId }) => getProject(projectId))
  );
  const now = Date.now();
  const ipoAt = Math.max(
    now,
    ...projects.map((project) => project.lastPriceTs! + 1)
  );
  const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    {
      Update: {
        TableName: PROJECTS_TABLE,
        Key: { projectId: config.projectId },
        UpdateExpression: "SET ipoAt = :ipoAt",
        ConditionExpression: "attribute_not_exists(ipoAt) OR ipoAt = :null",
        ExpressionAttributeValues: { ":ipoAt": ipoAt, ":null": null }
      }
    }
  ];

  for (const { projectId, netShares } of projects) {
    const priceCents = ipoStockPriceCents(netShares!);
    items.push(
      {
        Update: {
          TableName: PROJECTS_TABLE,
          Key: { projectId },
          UpdateExpression:
            "SET seedSharesAtIpo = :shares, currentPriceCents = :price, lastPriceTs = :ipoAt, updatedAt = :now",
          ExpressionAttributeValues: {
            ":shares": netShares,
            ":price": priceCents,
            ":ipoAt": ipoAt,
            ":now": now
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
    );
  }
  await docClient.send(new TransactWriteCommand({ TransactItems: items }));
  await publishMarketUpdate({
    eventId: configuredEvent(),
    ipoAt,
    phase: "LIVE",
    serverTime: now
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
