import db from "../lib/db.js";
import docClient from "../lib/docClient.js";
import {
  USER_REGISTRATIONS_TABLE
} from "../constants/tables.js";
import * as fs from "fs";
import csv from "csv-parser";

let registrationData = {
  email: "",
  fname: "",
  eventID: "",
  year: 0,
  registrationStatus: "registered",
  isPartner: true,
  basicInformation: {
    fname: "",
    lname: "",
    gender: "",
    companyName: "",
    role: ""
  },
  dynamicResponses: {
  }
};

let googleFormToDevForm = {
  "What is your confirmed role?": "e79bd73c-9b27-424c-af0d-ed5b2b170675",
  "LinkedIn URL": "96d4e60e-6832-4f9f-b127-ecf734cbb05f",
  "Headshot": "4026ffed-9f12-4519-8e53-11720b5cfaae",
  "Do you have any dietary restrictions?": "12596ae4-98ad-4ed0-9b62-1d40aecb2e4a",
  "Please indicate any accessibility/mobility needs below": "75f50fe7-e2b3-4e56-84db-a8e923756c23",
  "What is your area of expertise? Example : UX Research, Venture Capital, Project Management": "647f5bd4-d8b8-47fc-a016-b00c6ab8afd7",
  "Is there anything else that you'd like us to be aware of?": "dfe5b2e4-28f8-4f0f-b934-1f2a79a16060",
  "[For Panelists & Workshop Hosts] Brief biography of current and/or past work experience, professional interests, etc. (3-4 sentences)": "9917f8fe-29c8-4a8b-8124-afc72425ba8c"
};

const prepareData = (csvData, id, year) => {
  let data = csvData[1];
  let registrations = [];

  for (let d of data) {
    let newRegistration = JSON.parse(JSON.stringify(registrationData));
    const [fname, lname] = getFirstLastName(d["Full Name"]);

    newRegistration.eventID = id;
    newRegistration.year = year;
    newRegistration.fname = fname;
    newRegistration.email = d["Email Address"];
    newRegistration.basicInformation.fname = fname;
    newRegistration.basicInformation.lname = lname;
    newRegistration.basicInformation.gender = d["Preferred Pronouns"];
    newRegistration.basicInformation.companyName = d["Company Name"];
    newRegistration.basicInformation.role = d["Role at Company"];
    Object.entries(googleFormToDevForm).forEach(([key, value]) => {
      newRegistration.dynamicResponses[value] = cleanString(d[key]);
    });
    registrations.push(newRegistration);
  }
  return registrations;
};

const getFirstLastName = (fullName) => {
  const arr = fullName.split(" ");
  if (arr.length <= 2) {
    return arr;
  }
  const lastIndex = arr.length - 1;
  const firstPart = arr.slice(0, lastIndex);
  const lastElement = arr[lastIndex];

  return [firstPart.join(" "), lastElement];
};

const cleanString = (inputString) => {
  // Replace \r, \n, and other whitespace characters with an empty string
  const cleanedString = inputString.replace(/[\r\n\s]+/g, " ");

  return cleanedString;
};

const readCSV = async (csvFilePath) => {
  return new Promise((resolve, reject) => {
    const csvData = [];
    let csvHeader;

    const processCSV = (filePath) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("headers", (headers) => {
          // Trim spaces from headers
          csvHeader = headers.map(header => header.trim());
        })
        .on("data", (row) => {
          // Trim spaces from key values in the data
          const cleanedRow = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.trim(), value.trim()])
          );
          csvData.push(cleanedRow);
        })
        .on("end", () => {
          resolve([csvHeader, csvData]);
        })
        .on("error", (error) => {
          console.error(`Error reading CSV file: ${error.message}`);
          reject(error);
        });
    };

    processCSV(csvFilePath);
  });
};


const removeDefaultKeys = (data) => {
  const formResponse = data;
  const ignoreKeys = ["eventID", "year", "email"];

  Object.keys(formResponse).forEach(function (key) {
    if (ignoreKeys.includes(key)) delete formResponse[key];
  });
  return formResponse;
};

const writeToDB = async (
  registrationStatus,
  data,
  email,
  eventIDAndYear,
  createNew
) => {
  try {
    const formResponse = removeDefaultKeys(data);

    const updateObject = {
      ...formResponse
    };

    let conditionExpression =
      "attribute_exists(id) and attribute_exists(#eventIDYear)";
    // if we are creating a new object, the condition expression needs to be different
    if (createNew)
      conditionExpression =
        "attribute_not_exists(id) and attribute_not_exists(#eventIDYear)";

    // construct the update expressions
    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(updateObject);

    // Because biztechRegistration table has a sort key, we cannot use helpers.updateDB()
    let params = {
      Key: {
        id: email,
        ["eventID;year"]: eventIDAndYear
      },
      TableName:
        USER_REGISTRATIONS_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
        "#eventIDYear": "eventID;year"
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression: conditionExpression
    };
    // do the magic
    await docClient.update(params).promise();
    let message = `User with email ${email} successfully registered (through update) to status '${registrationStatus}'!`;
    console.log(message);
  } catch (err) {
    console.log(err);
  }
};

const migrate = async (id, year) => {
  // Call this to obtain the question IDs and manually put into the googleFormToDevForm object
  // const existingEvent = await db.getOne(id, EVENTS_TABLE, {
  //   year
  // });
  // console.log(existingEvent.partnerRegistrationQuestions);

  const data = await readCSV("./scripts/test.csv");
  const registrations = prepareData(data, id, year);
  let proms = [];
  for (let r of registrations) {
    proms.push(writeToDB("registered", r, r.email, id + ";" + year, true));
  }
  // await Promise.all(registrations);
};

migrate("test-script", 2024);
