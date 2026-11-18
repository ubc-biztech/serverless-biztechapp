import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { configuredEvent, removeSocketConnection } from "./helpers";
import { SOCKETS_TABLE } from "./repos/tables";
import { TradeStatus, type BtxTrade } from "./types";

export async function publishMarketUpdate(data: Record<string, unknown>) {
  await publish({ type: "MARKET_UPDATE", data });
}

export async function publishTrade(trade: BtxTrade) {
  if (trade.status === TradeStatus.FILLED) {
    await publishMarketUpdate({
      projectId: trade.projectId,
      eventId: trade.eventId,
      priceCents: trade.endPriceCents,
      asOf: trade.priceTs
    });
  }
}

async function publish(message: Record<string, unknown>) {
  // A failed notification must never turn a committed trade into a failed trade.
  try {
    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: SOCKETS_TABLE,
        IndexName: "byEvent",
        KeyConditionExpression: "eventId = :value",
        ExpressionAttributeValues: { ":value": configuredEvent() }
      })
    );
    const client = new ApiGatewayManagementApiClient({
      endpoint: process.env.WS_API_ENDPOINT
    });
    await Promise.all(
      Items.filter((socket) => socket.eventId === configuredEvent()).map(
        async (socket) => {
          try {
            await client.send(
              new PostToConnectionCommand({
                ConnectionId: socket.connectionId,
                Data: Buffer.from(JSON.stringify(message))
              })
            );
          } catch (error) {
            if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 410) {
              await removeSocketConnection({
                connectionId: socket.connectionId
              });
            } else {
              console.error("BTX socket delivery failed", error);
            }
          }
        }
      )
    );
  } catch (error) {
    console.error("BTX notification failed", error);
  }
}
