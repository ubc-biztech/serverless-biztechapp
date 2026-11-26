import { randomUUID } from "node:crypto";
import SQS from "aws-sdk/clients/sqs";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import {
  accountId,
  assertUuidV7,
  BtxError,
  buildProjectId,
  configuredEvent,
  eventEndsAtMs,
  getEventConfig,
  buildMarketPhaseCheck,
  requireMarketOpen,
  requireSafeCents
} from "./helpers";
import { buildEligibilityCheck, eligibleRegistration } from "./eligibility";
import { getQuote } from "./market";
import { ensureAccount } from "./repos/accounts";
import { getProject } from "./repos/projects";
import {
  EVENT_ACCOUNTS_TABLE,
  HOLDINGS_TABLE,
  PRICES_TABLE,
  PROJECTS_TABLE,
  TRADES_TABLE
} from "./repos/tables";
import { tradeQuote, validateShares } from "./pricing";
import { publishTrade } from "./sockets";
import {
  TradeStatus,
  type BtxHolding,
  type BtxTrade,
  type MarketCommand
} from "./types";

const queue = new SQS();

export async function enqueueMarketCommand(command: MarketCommand) {
  await queue
    .sendMessage({
      QueueUrl: process.env.BTX_TRADE_QUEUE_URL!,
      MessageBody: JSON.stringify(command),
      MessageGroupId: "btx-trades",
      MessageDeduplicationId: randomUUID()
    })
    .promise();
}

export async function getTrade(projectId: string, tradeId: string) {
  if (!projectId.startsWith(`${configuredEvent()}:`))
    throw new BtxError(400, "Project event mismatch");

  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TRADES_TABLE,
      Key: { projectId, tradeId },
      ConsistentRead: true
    })
  );
  return Item as BtxTrade | undefined;
}

export async function submitTrade(
  userId: string,
  side: "BUY" | "SELL",
  input: {
    projectId: string;
    tradeId: string;
    shares: number;
    limitPriceCents: number;
  }
) {
  validateShares(input.shares);
  const limitPriceCents = requireSafeCents(input.limitPriceCents, "limitPriceCents");
  const tradeId = assertUuidV7(input.tradeId);
  const existing = await getTrade(input.projectId, tradeId);

  if (existing) {
    throw new BtxError(409, "tradeId already used");
  }

  const quote = await getQuote({ ...input, userId, side });
  await ensureAccount(userId);

  if (Date.now() >= eventEndsAtMs()) {
    throw new BtxError(409, "Event ended", { code: "EVENT_ENDED" });
  }

  const trade: BtxTrade = {
    projectId: input.projectId,
    tradeId,
    userId,
    eventId: configuredEvent(),
    accountId: accountId(configuredEvent(), userId),
    side,
    shares: input.shares,
    limitPriceCents,
    acceptedIpoAt: quote.ipoAt,
    ...(quote.previousIpoAt !== undefined && { previousIpoAt: quote.previousIpoAt }),
    status: TradeStatus.PENDING,
    createdAt: Date.now()
  };
  
  await docClient.send(
    new PutCommand({
      TableName: TRADES_TABLE,
      Item: trade,
      ConditionExpression: "attribute_not_exists(tradeId)"
    })
  );
  return trade;
}

export async function accountTrades(
  userId: string,
  limit = 50,
  prevPageKey?: string
) {
  const { Items, LastEvaluatedKey } = await docClient.send(
    new QueryCommand({
      TableName: TRADES_TABLE,
      IndexName: "byAccount",
      KeyConditionExpression: "accountId = :account",
      ExpressionAttributeValues: {
        ":account": accountId(configuredEvent(), userId)
      },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: prevPageKey ? JSON.parse(prevPageKey) : undefined
    })
  );

  return {
    items: (Items || []) as BtxTrade[],
    nextPageKey: LastEvaluatedKey ? JSON.stringify(LastEvaluatedKey) : null
  };
}

export async function processTrade(projectId: string, tradeId: string) {
  let trade = await getTrade(projectId, tradeId);
  if (!trade) throw new Error(`Missing trade ${tradeId}`);
  if (trade.status !== TradeStatus.PENDING) {
    await publishTrade(trade);
    return trade;
  }

  try {
    const registration = await eligibleRegistration(trade.userId);
    if (
      registration.teamID &&
      projectId === buildProjectId(configuredEvent(), registration.teamID)
    ) {
      throw new BtxError(403, "Cannot trade your own company", {
        code: "FORBIDDEN"
      });
    }

    const config = await getEventConfig();
    // Let the queue retry after the admin reset commits or restores LIVE.
    if (config.phase === "IPO_RESETTING") throw new Error("IPO reset in progress");
    requireMarketOpen(config);
    const [project, account, holdingResponse] = await Promise.all([
      getProject(projectId),
      ensureAccount(trade.userId),
      docClient.send(
        new GetCommand({
          TableName: HOLDINGS_TABLE,
          Key: { userId: trade.userId, projectId },
          ConsistentRead: true
        })
      )
    ]);

    if (config.ipoAt !== trade.acceptedIpoAt || config.previousIpoAt !== trade.previousIpoAt) {
      throw new BtxError(409, "Market phase changed; request a new quote", {
        code: "STALE_QUOTE"
      });
    }
    if (project.isActive === false) throw new BtxError(409, "Inactive listing");

    const holding = holdingResponse.Item as BtxHolding | undefined;
    let ownedShares = 0;
    let previousCostBasisCents = 0;

    if (holding) {
      ownedShares = holding.shares;
      previousCostBasisCents = holding.costBasisCents;
    }

    if (trade.side === "SELL" && ownedShares < trade.shares) {
      throw new BtxError(409, "Insufficient shares", { code: "INSUFFICIENT_SHARES" });
    }

    const now = Date.now();
    if (now >= eventEndsAtMs()) {
      throw new BtxError(409, "Event ended", { code: "EVENT_ENDED" });
    }

    const quote = tradeQuote(
      project,
      config.ipoAt,
      now,
      trade.side,
      trade.shares
    );

    if (trade.side === "BUY" && quote.priceCents > trade.limitPriceCents) {
      throw new BtxError(409, "Execution price exceeds buy limit", {
        code: "LIMIT_PRICE_EXCEEDED"
      });
    }

    if (trade.side === "SELL" && quote.priceCents < trade.limitPriceCents) {
      throw new BtxError(409, "Execution price is below sell limit", {
        code: "LIMIT_PRICE_EXCEEDED"
      });
    }
    
    const cashBalanceCents = account.cashBalanceCents + quote.cashDeltaCents;

    if (cashBalanceCents < 0) {
      throw new BtxError(409, "Insufficient funds", { code: "INSUFFICIENT_FUNDS" });
    }

    let shares = ownedShares + trade.shares;
    let costBasisCents = previousCostBasisCents - quote.cashDeltaCents;
    let netShares = project.netShares + trade.shares;
    let realizedPnlCents = 0;

    if (trade.side === "SELL") {
      shares = ownedShares - trade.shares;
      netShares = project.netShares - trade.shares;
      let removedCostCents = previousCostBasisCents;
      if (shares > 0) {
        removedCostCents = Math.round(
          (previousCostBasisCents * trade.shares) / ownedShares
        );
      }
      costBasisCents = previousCostBasisCents - removedCostCents;
      realizedPnlCents = quote.cashDeltaCents - removedCostCents;
    }

    if (netShares < 0) throw new Error("Company shares do not match holdings");
    const priceTs = Math.max(now, project.lastPriceTs + 1);

    const filled: BtxTrade = {
      ...trade,
      status: TradeStatus.FILLED,
      priceCents: quote.priceCents,
      endPriceCents: quote.endPriceCents,
      feeCents: quote.feeCents,
      cashDeltaCents: quote.cashDeltaCents,
      realizedPnlCents,
      completedAt: now,
      priceTs,
      result: {
        cashBalanceCents,
        shares,
        costBasisCents
      }
    };

    const eligibility = buildEligibilityCheck(trade.userId);
    if (registration.teamID === undefined) eligibility.if("teamID").notExists();
    else eligibility.if("teamID").equals(registration.teamID);
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          buildMarketPhaseCheck(config).build(),
          eligibility.build(),
          {
            Update: {
              TableName: EVENT_ACCOUNTS_TABLE,
              Key: { userId: trade.userId, eventId: configuredEvent() },
              UpdateExpression:
                "SET updatedAt = :now ADD cashBalanceCents :cashDelta",
              ExpressionAttributeValues: {
                ":cashDelta": quote.cashDeltaCents,
                ":now": now
              }
            }
          },
          shares === 0
            ? {
                Delete: {
                  TableName: HOLDINGS_TABLE,
                  Key: { userId: trade.userId, projectId }
                }
              }
            : {
                Put: {
                  TableName: HOLDINGS_TABLE,
                  Item: { userId: trade.userId, projectId, shares, costBasisCents }
                }
              },
          {
            Update: {
              TableName: PROJECTS_TABLE,
              Key: { projectId },
              UpdateExpression:
                "SET netShares = :shares, currentPriceCents = :price, lastPriceTs = :ts, updatedAt = :now ADD version :one",
              ConditionExpression: "attribute_exists(projectId) AND (attribute_not_exists(isActive) OR isActive <> :inactive)",
              ExpressionAttributeValues: {
                ":shares": netShares,
                ":price": quote.endPriceCents,
                ":ts": priceTs,
                ":now": now,
                ":one": 1,
                ":inactive": false
              }
            }
          },
          {
            Put: {
              TableName: TRADES_TABLE,
              Item: filled
            }
          },
          {
            Put: {
              TableName: PRICES_TABLE,
              Item: {
                projectId,
                ts: priceTs,
                priceCents: quote.endPriceCents,
                source: "TRADE"
              }
            }
          }
        ]
      })
    );
    trade = filled;
  } catch (error) {
    if (!(error instanceof BtxError)) throw error;
    trade = {
      ...trade,
      status: TradeStatus.REJECTED,
      completedAt: Date.now(),
      rejection: {
        code: error.data?.code || "TRADE_REJECTED",
        message: error.message
      }
    };
    await docClient.send(
      new UpdateCommand({
        TableName: TRADES_TABLE,
        Key: { projectId, tradeId },
        UpdateExpression:
          "SET #status = :rejected, rejection = :reason, completedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":rejected": TradeStatus.REJECTED,
          ":reason": trade.rejection,
          ":now": trade.completedAt
        }
      })
    );
  }
  await publishTrade(trade);
  return trade;
}
