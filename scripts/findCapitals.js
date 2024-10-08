import * as dotenv from "dotenv";
import {
  DynamoDB
} from "@aws-sdk/client-dynamodb";
import * as fs from "fs";


dotenv.config({
  path: "../.env"
});

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
  //   accessKeyId: "AKID",
  //   secretAccessKey: "SECRET",
  //   endpoint: "http://localhost:8000", // use the local dynamodb url here
  //   region: "us-west-2",
};


const dynamodb = new DynamoDB(awsConfig);

// Define the parameters for the scan operation
const params = {
  TableName: "biztechUsersPROD",
  // ProjectionExpression: 'id' // Specify the attributes you want to retrieve
};

// Perform the scan operation
dynamodb.scan(params, (err, data) => {
  if (err) {
    console.error("Error scanning DynamoDB table:", err);
  } else {
    // Process the scanned items
    const result = [];
    data.Items.forEach(item => {
      const email = item.id.S;

      // Check if the email contains any capital letter
      if (/[A-Z]/.test(email)) {
        const lowercaseId = email.toLowerCase();
        result.push({
          email,
          lowercaseEmail: lowercaseId
        });
        //         const updateParams = {
        //             TableName: 'biztechUsersPROD',
        //             Key: {
        //                 'id': { S: email }, // Specify the primary key of the item
        //             },
        //             UpdateExpression: 'SET id = :lowercaseId', // Update the 'id' attribute
        //             ExpressionAttributeValues: {
        //                 ':lowercaseId': { S: lowercaseId },
        //             },
        //         };
        //         dynamodb.updateItem(updateParams, (updateErr, updateData) => {
        //             if (updateErr) {
        //                 console.error('Error updating DynamoDB item:', updateErr);
        //             } else {
        //                 console.log('Updated item with ID:', email, 'New ID:', lowercaseId);
        //             }
        //         });
        //     }
        // });
        // const putParams = {
        //   TableName: "biztechUsers",
        //   Key: {
        //     "id": {
        //       S: lowercaseId
        //     }, // Specify the primary key of the item
        //   },
        //   UpdateExpression: "SET " + Object.keys(item).filter(attribute => attribute !== "id" && attribute !== "favedEventsID;year").map(attribute => `#attr_${attribute} = :val_${attribute}`).join(", "), // Update the 'id' attribute and clone the rest
        //   ExpressionAttributeNames: Object.keys(item).reduce((acc, attribute) => {
        //     if (attribute !== "id" && attribute !== "favedEventsID;year") {
        //       acc[`#attr_${attribute}`] = attribute;
        //     }
        //     return acc;
        //   }, {
        //   }),
        //   ExpressionAttributeValues: Object.keys(item).reduce((acc, attribute) => {
        //     if (attribute !== "id" && attribute !== "favedEventsID;year") {
        //       acc[`:val_${attribute}`] = item[attribute];
        //     }
        //     return acc;
        //   }, {
        //   }),
        //   ReturnValues: "ALL_NEW", // Retrieve the updated item
        // };

        // // Include all attributes from the original item
        // Object.keys(item).forEach(attribute => {
        //     // Exclude the primary key attribute from being duplicated
        //     if (attribute !== 'id') {
        //         putParams.Item[attribute] = item[attribute];
        //     }
        // });
        // if (email === "EdwardliaNgedli@gmail.com") {
        //   console.log(putParams);
        // }
        // // Perform the insert operation
        // const res = await dynamodb.updateItem(putParams).promise();
        // if (email === "EdwardliaNgedli@gmail.com") {
        //   console.log(res);
        // }
      }
    });
    console.log(result);
    const jsonString = JSON.stringify(result, null, 2);

    const filePath = "../constants/emails.js";
    fs.writeFileSync(filePath, `const CAPITALIZED_EMAILS = ${jsonString};\n\nexport default CAPITALIZED_EMAILS;\n`);

    console.log(`Results written to ${filePath}`);
  }
});
