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
  roundMoney
} from "./helpers";
import { eligibleRegistration } from "./eligibility";
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
import { tradeQuote } from "./pricing";
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
    limitPrice: number;
  }
) {
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
    limitPrice: input.limitPrice,
    acceptedIpoAt: quote.ipoAt,
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
  await enqueueMarketCommand({
    type: "TRADE",
    projectId: trade.projectId,
    tradeId
  });
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
    items: Items || [],
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

    const [project, config, account, holdingResponse] = await Promise.all([
      getProject(projectId),
      getEventConfig(),
      ensureAccount(trade.userId),
      docClient.send(
        new GetCommand({
          TableName: HOLDINGS_TABLE,
          Key: { userId: trade.userId, projectId },
          ConsistentRead: true
        })
      )
    ]);

    if (config.ipoAt !== trade.acceptedIpoAt) {
      throw new BtxError(409, "Market phase changed; request a new quote", {
        code: "STALE_QUOTE"
      });
    }

    const holding = holdingResponse.Item as BtxHolding | undefined;
    let ownedShares = 0;
    let previousCostBasis = 0;

    if (holding) {
      ownedShares = holding.shares;
      previousCostBasis = holding.costBasis!;
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

    if (trade.side === "BUY" && quote.price > trade.limitPrice) {
      throw new BtxError(409, "Execution price exceeds buy limit", {
        code: "LIMIT_PRICE_EXCEEDED"
      });
    }

    if (trade.side === "SELL" && quote.price < trade.limitPrice) {
      throw new BtxError(409, "Execution price is below sell limit", {
        code: "LIMIT_PRICE_EXCEEDED"
      });
    }
    
    const cashBalance = roundMoney(account.cashBalance + quote.cashDelta);

    if (cashBalance < 0) {
      throw new BtxError(409, "Insufficient funds", { code: "INSUFFICIENT_FUNDS" });
    }

    let shares = ownedShares + trade.shares;
    let costBasis = roundMoney(previousCostBasis - quote.cashDelta);
    let netShares = project.netShares! + trade.shares;
    let realizedPnl = 0;

    if (trade.side === "SELL") {
      shares = ownedShares - trade.shares;
      netShares = project.netShares! - trade.shares;
      let removedCost = previousCostBasis;
      if (shares > 0)
        removedCost = roundMoney(
          (previousCostBasis * trade.shares) / ownedShares
        );
      costBasis = roundMoney(previousCostBasis - removedCost);
      realizedPnl = roundMoney(quote.cashDelta - removedCost);
    }

    if (netShares < 0) throw new Error("Company shares do not match holdings");
    const priceTs = Math.max(now, project.lastPriceTs! + 1);

    const filled: BtxTrade = {
      ...trade,
      status: TradeStatus.FILLED,
      price: quote.price,
      endPrice: quote.endPrice,
      fee: quote.fee,
      cashDelta: quote.cashDelta,
      realizedPnl,
      completedAt: now,
      priceTs,
      result: {
        cashBalance,
        shares,
        costBasis
      }
    };

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: EVENT_ACCOUNTS_TABLE,
              Key: { userId: trade.userId, eventId: configuredEvent() },
              UpdateExpression:
                "SET updatedAt = :now ADD cashBalance :cashDelta",
              ExpressionAttributeValues: {
                ":cashDelta": quote.cashDelta,
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
                  Item: { userId: trade.userId, projectId, shares, costBasis }
                }
              },
          {
            Update: {
              TableName: PROJECTS_TABLE,
              Key: { projectId },
              UpdateExpression:
                "SET netShares = :shares, currentPrice = :price, lastPriceTs = :ts, updatedAt = :now",
              ExpressionAttributeValues: {
                ":shares": netShares,
                ":price": quote.endPrice,
                ":ts": priceTs,
                ":now": now
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
                price: quote.endPrice,
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
