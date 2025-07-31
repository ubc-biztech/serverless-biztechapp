#!/bin/bash

# Deployment script for Support Ticket System
# This script helps deploy the support ticket service and configure Discord

echo "🚀 Deploying Support Ticket System for BizTech Discord Bot"

# Check if required environment variables are set
echo "📋 Checking environment variables..."

required_vars=(
  "DISCORD_TOKEN"
  "DISCORD_GUILD_ID"
  "DISCORD_PUBLIC_KEY"
  "SUPPORT_TICKETS_CHANNEL_ID"
  "SUPPORT_TICKETS_EXEC_CHANNEL_ID"
)

missing_vars=()

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    missing_vars+=("$var")
  fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
  echo "❌ Missing required environment variables:"
  for var in "${missing_vars[@]}"; do
    echo "   - $var"
  done
  echo ""
  echo "Please set these environment variables before deploying."
  exit 1
fi

echo "✅ All required environment variables are set"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Deploy the support tickets service
echo "🚀 Deploying support tickets service..."
serverless deploy

if [ $? -eq 0 ]; then
  echo "✅ Support tickets service deployed successfully"
else
  echo "❌ Failed to deploy support tickets service"
  exit 1
fi

# Get the webhook URL from the deployment
echo "🔗 Getting webhook URL..."
WEBHOOK_URL=$(serverless info --verbose | grep "webhook" | grep -o 'https://[^[:space:]]*')

if [ -z "$WEBHOOK_URL" ]; then
  echo "⚠️  Could not automatically find webhook URL"
  echo "Please manually configure the Discord webhook for #support-tickets channel"
  echo "The webhook endpoint should be: /support-tickets/webhook"
else
  echo "✅ Webhook URL: $WEBHOOK_URL"
  echo ""
  echo "📝 Next steps:"
  echo "1. Configure Discord webhook for #support-tickets channel to point to:"
  echo "   $WEBHOOK_URL"
  echo ""
  echo "2. Deploy the updated Discord bot service:"
  echo "   cd ../bots && serverless deploy"
  echo ""
  echo "3. Register the new slash commands with Discord:"
  echo "   - /support"
  echo "   - /reply"
  echo "   - /resolve"
fi

echo ""
echo "🎉 Support Ticket System deployment complete!"
echo ""
echo "📚 For more information, see README.md" 