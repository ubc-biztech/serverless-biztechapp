# Quests API

This page documents the quests endpoints for retrieving user quest progress, handling quest events, and managing gamification features. The service tracks user progress across various quest types including connections and company interactions.

All endpoints return JSON and support CORS. Authentication is required for all endpoints using JWT tokens.

## Supported Quest Types

### Quest Types
- **COUNTER**: Incremental counting quests that track progress toward a numeric target
- **UNIQUE_SET**: Quests that track unique items (e.g., companies) without a numeric target

### Event Types
- **NEW_CONNECTION**: Triggered when a user makes a new connection
- **RECOMMENDED_CONNECTION**: Triggered when a user connects with a recommended person
- **COMPANY_TALK**: Triggered when a user interacts with a company representative

### Active Quests
- **new_connections_5**: Make 5 new connections (COUNTER type, target: 5)
- **new_connections_10**: Make 10 new connections (COUNTER type, target: 10)
- **new_connections_20**: Make 20 new connections (COUNTER type, target: 20)
- **recommended_connections**: Connect with 3 recommended people (COUNTER type, target: 3)
- **unique_companies_talked_to**: Talk to unique companies (UNIQUE_SET type, unlimited target)

## Get all quests

    Method: GET
    Path: /quests
    Purpose: Retrieve all quests and their progress for the authenticated user

Authentication
    Required: JWT token with email claim

Successful response
{
  "message": "Quests retrieved successfully",
  "data": [
    {
      "quest": {
        "id": "new_connections_5",
        "type": "COUNTER",
        "target": 5,
        "description": "Make 5 new connections",
        "eventTypes": ["NEW_CONNECTION"]
      },
      "progress": {
        "progress": 3,
        "target": 5,
        "startedAt": 1736880000000,
        "completedAt": null,
        "description": "Make 5 new connections"
      }
    },
    {
      "quest": {
        "id": "unique_companies_talked_to",
        "type": "UNIQUE_SET",
        "target": null,
        "description": "Talk to unique companies",
        "eventTypes": ["COMPANY_TALK"]
      },
      "progress": {
        "progress": 2,
        "target": null,
        "startedAt": 1736880000000,
        "completedAt": null,
        "description": "Talk to unique companies",
        "items": ["Microsoft", "Google"]
      }
    }
  ]
}

Error responses
    401 with { "message": "Unauthorized" } when JWT token is missing or invalid
    500 with { "message": "Internal Server Error" } on unexpected failures

## Handle quest events

    Method: POST
    Path: /quests
    Purpose: Process quest progress events and update user quest status based on event type and parameters

Authentication
    Required: JWT token with email claim

Request body
{
  "type": "connection" | "company",
  "argument": {
    // For "connection" type:
    "recommended": true | false,
    "profileId": "string"
    
    // For "company" type:
    "company": "Microsoft"
  }
}

    type: string, required - Event type ("connection" or "company")
    argument: object, required - Event-specific parameters

Connection event argument:
    recommended: boolean, optional - Whether the connection was recommended
    profileId: string, optional - Profile ID of the connected user

Company event argument:
    company: string, required - Company name for unique tracking

Successful response
{
  "message": "Quest events processed successfully",
  "quests": {
    "new_connections_5": {
      "progress": 4,
      "target": 5,
      "startedAt": 1736880000000,
      "completedAt": null,
      "description": "Make 5 new connections"
    },
    "unique_companies_talked_to": {
      "progress": 3,
      "target": null,
      "startedAt": 1736880000000,
      "completedAt": null,
      "description": "Talk to unique companies",
      "items": ["Microsoft", "Google", "Apple"]
    }
  }
}

Error responses
    400 with { "message": "Invalid input" } when request body is malformed
    401 with { "message": "Unauthorized" } when JWT token is missing or invalid
    500 with { "message": "Internal Server Error" } on database or processing failures

## Get specific quest

    Method: GET
    Path: /quests/{id}
    Purpose: Retrieve a specific quest by ID for the authenticated user

Authentication
    Required: JWT token with email claim

Path parameters
    id: string, required - Quest ID (e.g., "new_connections_5", "unique_companies_talked_to")

Successful response
{
  "message": "Quest retrieved successfully",
  "data": {
    "quest": {
      "id": "new_connections_5",
      "type": "COUNTER",
      "target": 5,
      "description": "Make 5 new connections",
      "eventTypes": ["NEW_CONNECTION"]
    },
    "progress": {
      "progress": 3,
      "target": 5,
      "startedAt": 1736880000000,
      "completedAt": null,
      "description": "Make 5 new connections"
    }
  }
}

Error responses
    400 with { "message": "Invalid quest ID" } when quest ID is not provided
    401 with { "message": "Unauthorized" } when JWT token is missing or invalid
    404 with { "message": "Quest not found" } when quest ID doesn't exist
    500 with { "message": "Internal Server Error" } on unexpected failures

## Quest Progress Data Model

### Progress Object Structure
{
  "progress": number,           // Current progress count
  "target": number | null,      // Target count (null for unlimited quests)
  "startedAt": timestamp,      // Unix timestamp when quest started
  "completedAt": timestamp,     // Unix timestamp when completed (null if not completed)
  "description": string,        // Human-readable quest description
  "items": string[]            // Array of unique items (UNIQUE_SET quests only)
}

### Database Storage
{
  "id": "user@example.com",     // User email (partition key)
  "quests": {
    "quest_id": {
      "progress": number,
      "target": number | null,
      "startedAt": timestamp,
      "completedAt": timestamp,
      "description": string,
      "items": string[]         // UNIQUE_SET quests only
    }
  }
}

## Notes

    All endpoints require authentication via JWT token. User email is extracted from token claims.
    Quest progress is automatically updated when events are processed via POST /quests.
    COUNTER quests increment progress and cap at the target value.
    UNIQUE_SET quests track unique items in an array to prevent duplicates.
    Quest completion is automatically detected and marked with completedAt timestamp.
    The service uses DynamoDB with user email as partition key for data persistence.

On this page

    Get all quests
        Authentication
        Successful response
        Error responses
    Handle quest events
        Authentication
        Request body
        Successful response
        Error responses
    Get specific quest
        Authentication
        Path parameters
        Successful response
        Error responses
    Quest Progress Data Model
        Progress Object Structure
        Database Storage
    Notes