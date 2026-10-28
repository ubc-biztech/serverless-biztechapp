# BTX connections

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
