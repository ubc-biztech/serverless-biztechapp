# BTX

TypeScript service (`handler.ts` entrypoints).

## WebSocket connections

BTX has its own WebSocket API. Its Lambda functions derive the management
endpoint from that API and the deployment stage. Do not use the interactions
or live wall WebSocket URL for BTX.

For the frontend's current `NEXT_PUBLIC_REACT_APP_STAGE=staging` setting, HTTP
requests target `https://api-dev.ubcbiztech.com`, so use the BTX **dev** WebSocket
endpoint too. Read Serverless's existing stack output with AWS credentials that
can describe the stack:

```sh
aws cloudformation describe-stacks \
  --region us-west-2 \
  --stack-name biztechApi-btx-dev \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceEndpointWebsocket'].OutputValue | [0]" \
  --output text
```

Set the returned `wss://` URL as `NEXT_PUBLIC_BTX_WS_URL` in the frontend's
`.env.local` or hosting environment. Restart the local Next.js server or rebuild
the hosted frontend after changing it. For production, read the output from
`biztechApi-btx-prod` and pair it with the frontend's `production` stage.

For fully local BTX development, use the frontend's `local` stage and
`NEXT_PUBLIC_BTX_WS_URL=ws://localhost:3005`, with the backend's local HTTP proxy
and BTX service running.

## Market

Participants with a completed, accepted registration start with $50,000. They
can trade without joining a team and cannot trade their own company.

- A team member opens their company's 30-minute seed window with
  `POST /btx/projects/{projectId}/seed/start`. Seed orders are buys at $100 per share.
- `POST /btx/admin/ipo` returns `202` when queued. Buying and selling go live for
  all companies once IPO completes. The seed timer alone does not start live trading.
- Use `GET /btx/market/snapshot` for the current phase, server time, and event cutoff
  (`eventEndsAt`). Trading closes at the cutoff.

Admin grants take participant email addresses in `targets` and an integer
`amountCents`. Reuse the same
`requestId` for the same batch to avoid double credits. Grants increase available
cash and total funding without counting as trading profit.

## Trading

1. Get a quote from `GET /btx/market/quote`. Use its price, fees, and `expiresAt`
   for the preview. The quote does not reserve cash, shares, or a price.
2. Send `{projectId, tradeId, shares, limitPriceCents}` to `POST /btx/market/buy` or
   `POST /btx/market/sell`. Use a positive whole-share quantity and generate one
   UUIDv7 `tradeId` per order. `limitPriceCents` is the maximum per share on a buy
   or minimum on a sell, excluding the 2% fee. For example, send `10000` for $100.
3. Treat `202 PENDING` as accepted. The trade table stream queues the order. Poll `GET /btx/trades/{projectId}/{tradeId}` for
   `FILLED` or `REJECTED`. If the submission response is lost or returns a duplicate
   ID conflict, look up the original ID before sending another order.

Live orders fill at the average price across their price movement, rounded to
the nearest cent per share. Shares trading at the $0.10 floor pay that price.
Each minute also applies a random ±1% adjustment to the current price.
Rejected orders leave cash and holdings unchanged and include a `rejection.code`.
Seed orders still queued at IPO are rejected with `STALE_QUOTE`.

WebSockets send public `MARKET_UPDATE` messages for prices and seed/IPO changes.
Price updates include `data.priceCents`.
Use `asOf` to ignore older prices for the same company and refresh the market
snapshot after reconnect. Read private trade results and balances over HTTP.
For `GET /btx/account/trades` and `GET /btx/price-history`, pass the returned
`nextPageKey` as `prevPageKey`.

## Development

BTX uses integer cents for calculations, storage, HTTP, and WebSockets.
Monetary fields use a `Cents` suffix. Convert cents to dollars for display.

```sh
./node_modules/.bin/tsc --noEmit
```
