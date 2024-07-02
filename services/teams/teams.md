---

title: Teams API
nextjs:
  metadata:
    title: Teams API Documentation
    description: Detailed documentation for the Teams API.
---

The `Teams` API endpoint allows you to manage teams for events. This endpoint provides functionalities to create, update, and retrieve team information, check QR scans, and manage team points and names.

---

## Endpoint

The `Teams` API endpoint is used to manage teams for events.

```
POST /teams
```

## HTTP Method

The API uses the `POST` method to create a new team for an event.

## Request Parameters

The request body must contain the following parameters:

- `team_name` (string, required): The name of the team.
- `eventID` (string, required): The ID of the event.
- `year` (number, required): The year of the event.
- `memberIDs` (string[], required): The IDs of the team members.

## Validation

The API performs the following validation on the input data:

- **Team Name Validation**: The team name must be a non-empty string.
- **Event ID and Year Validation**: The event ID must be a valid string, and the year must be a valid number.
- **Member Registration Validation**: All members must be registered for the event.

## Request Example

Here is an example of a valid request to the `Teams` API:

```json
{
  "team_name": "Team Alpha",
  "eventID": "event123",
  "year": 2024,
  "memberIDs": ["user1", "user2", "user3"]
}
```

## Response Example

### Success Response

If the request is successful, the API returns a 201 status code with the following response:

```json
{
  "statusCode": 201,
  "body": {
    "id": "team123",
    "teamName": "Team Alpha",
    "eventID;year": "event123;2024",
    "memberIDs": ["user1", "user2", "user3"],
    "scannedQRs": [],
    "points": 0,
    "pointsSpent": 0,
    "transactions": [],
    "inventory": [],
    "submission": "",
    "metadata": {}
  }
}
```

## Error Handling

### Validation Error

If a validation error occurs, the API returns a 400 status code with the following response:

```json
{
  "statusCode": 400,
  "body": {
    "error": "Validation Error",
    "message": "One or more input parameters are invalid."
  }
}
```

### Registration Error

If a user is not registered for the event, the API returns a 403 status code with the following response:

```json
{
  "statusCode": 403,
  "body": {
    "error": "Registration Error",
    "message": "User [userID] is not registered for event [eventID;year]."
  }
}
```

## Detailed Steps

Here is a detailed breakdown of the steps performed by the `makeTeam` function:

1. **Member Registration Check**:

   - The function iterates through the `memberIDs` and checks if all members are registered for the event.
   - Example:
     ```javascript
     for (let i = 0; i < memberIDs.length; i++) {
       const memberID = memberIDs[i];
       await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
         "eventID;year": eventID_year
       }).then((res) => {
         if (!res) {
           throw helpers.inputError("User " + memberID + " is not registered for event " + eventID_year, 403);
         }
       });
     }
     ```

2. **Create Team Entry**:

   - The function creates a new team entry in the Teams table with the provided details.
   - Example:
     ```javascript
     const params = {
       TableName: TEAMS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
       Item: {
         id: uuidv4(),
         teamName: team_name,
         "eventID;year": eventID + ";" + year,
         memberIDs: memberIDs,
         scannedQRs: [],
         points: 0,
         pointsSpent: 0,
         transactions: [],
         inventory: [],
         submission: "",
         metadata: {}
       }
     };
     ```

3. **Update User Registrations**:

   - The function updates the user registrations to include the newly created team ID.
   - Example:
     ```javascript
     for (let i = 0; i < memberIDs.length; i++) {
       const memberID = memberIDs[i];
       db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
         "eventID;year": eventID_year
       }).then((res) => {
         if (res.teamID) {
           this._getTeamFromUserRegistration(memberID, eventID, year).then((team) => {
             team.memberIDs = team.memberIDs.filter((id) => id !== memberID);
             this._putTeam(team);
           });
         }
         res.teamID = params.Item.id;
         docClient.put({
           TableName: USER_REGISTRATIONS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
           Item: res
         }).promise().then(() => {}).catch((err) => {
           console.log(err);
           throw new Error(err);
         });
       }).catch((err) => {
         console.log(err);
         throw new Error(err);
       });
     }
     ```

4. **Error Handling**:

   - If an error occurs during the process, the function catches the error and returns an appropriate response.
   - Example:
     ```javascript
     catch (err) {
       callback(null, helpers.createResponse(400, err));
     }
     ```

---


## Get Team from User ID

The `getTeamFromUserID` endpoint retrieves the team object of the team that the user is on from the user's ID.

```
POST /team/user
```

#### HTTP Method

The API uses the `POST` method to retrieve the team for a user.

#### Request Parameters

The request body must contain the following parameters:

- `user_id` (string, required): The ID of the user.
- `eventID` (string, required): The ID of the event.
- `year` (number, required): The year of the event.

#### Request Example

```json
{
  "user_id": "user1",
  "eventID": "event123",
  "year": 2024
}
```

#### Response Example

```json
{
  "statusCode": 200,
  "body": {
    "message": "Successfully retrieved team.",
    "response": {
      "id": "team123",
      "teamName": "Team Alpha",
      "eventID;year": "event123;2024",
      "memberIDs": ["user1", "user2", "user3"],
      "scannedQRs": [],
      "points": 0,
      "pointsSpent": 0,
      "transactions": [],
      "inventory": [],
      "submission": "",
      "metadata": {}
    }
  }
}
```

### Change Team Name

The `changeTeamName` endpoint changes the team name of the team with the given user_id.

```
POST /team/name
```

#### HTTP Method

The API uses the `POST` method to change the team name.

#### Request Parameters

The request body must contain the following parameters:

- `user_id` (string, required): The ID of the user.
- `eventID` (string, required): The ID of the event.
- `year` (number, required): The year of the event.
- `team_name` (string, required): The new name of the team.

#### Request Example

```json
{
  "user_id": "user1",
  "eventID": "event123",
  "year": 2024,
  "team_name": "Team Beta"
}
```

#### Response Example

```json
{
  "statusCode": 200,
  "body": {
    "message": "Successfully changed team name.",
    "response": {
      "id": "team123",
      "teamName": "Team Beta",
      "eventID;year": "event123;2024",
      "memberIDs": ["user1", "user2", "user3"],
      "scannedQRs": [],
      "points": 0,
      "pointsSpent": 0,
      "transactions": [],
      "inventory": [],
      "submission": "",
      "metadata": {}
    }
  }
}
```

### Add QR Scan

The `addQRScan` endpoint adds a QR code to the scannedQRs array of the team.

```
POST /team/qrscan
```

#### HTTP Method

The API uses the `POST` method to add a QR scan.

#### Request Parameters

The request body must contain the following parameters:

- `user_id` (string, required): The ID of the user.
- `qr_code_id` (string, required): The ID of the QR code.
- `eventID` (string, required): The ID of the event.
- `year` (number, required): The year of the event.
- `points` (number, optional): The points to be added to the team.

#### Request Example

```json
{
  "user_id": "user1",
  "qr_code_id": "qr123",
  "

eventID": "event123",
  "year": 2024,
  "points": 10
}
```

#### Response Example

```json
{
  "statusCode": 200,
  "body": {
    "message": "Successfully added QR code to scannedQRs array of team.",
    "response": {
      "id": "team123",
      "teamName": "Team Alpha",
      "eventID;year": "event123;2024",
      "memberIDs": ["user1", "user2", "user3"],
      "scannedQRs": ["qr123"],
      "points": 10,
      "pointsSpent": 0,
      "transactions": [],
      "inventory": [],
      "submission": "",
      "metadata": {}
    }
  }
}
```

### Check QR Scanned

The `checkQRScanned` endpoint checks if a QR code has been scanned by a team.

```
POST /team/qrcheck
```

#### HTTP Method

The API uses the `POST` method to check a QR scan.

#### Request Parameters

The request body must contain the following parameters:

- `user_id` (string, required): The ID of the user.
- `qr_code_id` (string, required): The ID of the QR code.
- `eventID` (string, required): The ID of the event.
- `year` (number, required): The year of the event.

#### Request Example

```json
{
  "user_id": "user1",
  "qr_code_id": "qr123",
  "eventID": "event123",
  "year": 2024
}
```

#### Response Example

```json
{
  "statusCode": 200,
  "body": {
    "message": "Attached boolean for check if QR code has been scanned for that user's team; refer to \"response\" field.",
    "response": true
  }
}
```

### Get Teams by Event

The `get` endpoint retrieves all teams for a specific event and year.

```
GET /teams/{eventID}/{year}
```

#### HTTP Method

The API uses the `GET` method to retrieve teams.

#### Request Parameters

- `eventID` (string, required): The ID of the event (path parameter).
- `year` (number, required): The year of the event (path parameter).

#### Response Example

```json
{
  "statusCode": 200,
  "body": [
    {
      "id": "team123",
      "teamName": "Team Alpha",
      "eventID;year": "event123;2024",
      "memberIDs": ["user1", "user2", "user3"],
      "scannedQRs": [],
      "points": 0,
      "pointsSpent": 0,
      "transactions": [],
      "inventory": [],
      "submission": "",
      "metadata": {}
    }
  ]
}
```
