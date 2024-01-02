import db from "../lib/db.js";
import docClient from "../lib/docClient.js";
import {
  EVENTS_TABLE
} from "../constants/tables.js";
import * as fs from "fs";

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
  dynamicResponses: {}
}

const readCSV = () => {
  const csvFilePath = "scripts/test.csv";
  const csvData = [];
  let csvHeader;

  fs.readFile(csvFilePath, "utf-8", (err, data) => {
    if (err) {
      console.error(`Error reading CSV file: ${err.message}`);
      return;
    }

    const lines = data.split(/\r?\n/);
    csvHeader = lines[0].split(",");

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",");
      csvData.push(row);
    }

    console.log("CSV Header:", csvHeader);
    console.log("CSV Data:", csvData);
  });
  return [csvHeader, csvData];
};

const prepareData = (questions) => {
  let registrations = [];
  // for 
}

const migrate = async (id, year) => {
  const existingEvent = await db.getOne(id, EVENTS_TABLE, {
    year
  });
  
  const data = readCSV();
  const preppedData = prepareData(existingEvent.partnerRegistrationQuestions);
};


/*
this is data
[registrations] {
[registrations]   email: "asdfsdf@gmailc.om",
[registrations]   fname: "asdfsafd",
[registrations]   eventID: "script",
[registrations]   year: 2023,
[registrations]   registrationStatus: "registered",
[registrations]   isPartner: true,
[registrations]   basicInformation: {
[registrations]     fname: "asdfsafd",
[registrations]     lname: "asdf",
[registrations]     gender: "He/Him/His",
[registrations]     companyName: "Splunk",
[registrations]     role: "SWE"
[registrations]   },
[registrations]   dynamicResponses: {
[registrations]     "e3ae9339-a5e7-453f-bc98-e87e7bb461e6": "Sponsor, Keynote Speaker",
[registrations]     "55bf0df1-0952-42b1-96a1-1b94accd42e2": "linkedin.com",
[registrations]     "edafe5e4-e08b-43d2-aeb3-6bc45bbb4a73": "n/a",
[registrations]     "c2c104bd-1035-4b4c-927d-eb1ccc0cfbc9": "swe",
[registrations]     "51d7b71e-babe-454b-ae8a-ec1cb9c1549f": "n/a",
[registrations]     "9944eb54-1b37-4613-aab2-20f47bf05c23": "asdf"
[registrations]   }
[registrations] }
[registrations] {
[registrations]   email: "asdfsdf@gmailc.om",
[registrations]   fname: "asdfsafd",
[registrations]   eventID: "script",
[registrations]   year: 2023,
[registrations]   registrationStatus: "registered",
[registrations]   isPartner: true,
[registrations]   basicInformation: {
[registrations]     fname: "asdfsafd",
[registrations]     lname: "asdf",
[registrations]     gender: "He/Him/His",
[registrations]     companyName: "Splunk",
[registrations]     role: "SWE"
[registrations]   },
[registrations]   dynamicResponses: {
[registrations]     "e3ae9339-a5e7-453f-bc98-e87e7bb461e6": "Sponsor, Keynote Speaker",
[registrations]     "55bf0df1-0952-42b1-96a1-1b94accd42e2": "linkedin.com",
[registrations]     "edafe5e4-e08b-43d2-aeb3-6bc45bbb4a73": "n/a",
[registrations]     "c2c104bd-1035-4b4c-927d-eb1ccc0cfbc9": "swe",
[registrations]     "51d7b71e-babe-454b-ae8a-ec1cb9c1549f": "n/a",
[registrations]     "9944eb54-1b37-4613-aab2-20f47bf05c23": "asdf",
                    "1babaeb4-97e9-452b-b64b-b127c0b826cc": "https://drive.google.com/file/d/1zuIIAddBRweftZYrUyYWAT8koOrKNBuT/view?usp=drivesdk"
[registrations]   }
[registrations] }
[registrations] CloudWatch debugging purposes
[registrations] {
[registrations]   year: 2023,
[registrations]   endDate: "2024-05-29T22:44:00.000Z",
[registrations]   isPublished: false,
[registrations]   partnerRegistrationQuestions: [
[registrations]     {
[registrations]       questionImageUrl: "",
[registrations]       label: "What is your confirmed role?",
[registrations]       questionId: "e3ae9339-a5e7-453f-bc98-e87e7bb461e6",
[registrations]       type: "CHECKBOX",
[registrations]       choices: "Sponsor,Keynote Speaker,Workshop Host,Networking Delegate,Panelist",
[registrations]       required: true
[registrations]     },
[registrations]     {
[registrations]       charLimit: 200,
[registrations]       questionId: "55bf0df1-0952-42b1-96a1-1b94accd42e2",
[registrations]       questionImageUrl: "",
[registrations]       label: "Linkedin URL",
[registrations]       type: "TEXT",
[registrations]       choices: "",
[registrations]       isSkillsQuestion: true,
[registrations]       required: true
[registrations]     },
[registrations]     {
[registrations]       label: "Please indicate any accesibility ",
[registrations]       charLimit: 200,
[registrations]       questionId: "edafe5e4-e08b-43d2-aeb3-6bc45bbb4a73",
[registrations]       type: "TEXT",
[registrations]       choices: "",
[registrations]       required: false
[registrations]     },
[registrations]     {
[registrations]       label: "Area of expertise",
[registrations]       charLimit: 100,
[registrations]       questionId: "c2c104bd-1035-4b4c-927d-eb1ccc0cfbc9",
[registrations]       type: "TEXT",
[registrations]       choices: "",
[registrations]       required: true
[registrations]     },
[registrations]     {
[registrations]       label: "Brief biography of current",
[registrations]       charLimit: 100,
[registrations]       questionId: "51d7b71e-babe-454b-ae8a-ec1cb9c1549f",
[registrations]       type: "TEXT",
[registrations]       choices: "",
[registrations]       required: false
[registrations]     },
[registrations]     {
[registrations]       label: "Beware of aything else?",
[registrations]       questionId: "9944eb54-1b37-4613-aab2-20f47bf05c23",
[registrations]       type: "TEXT",
[registrations]       choices: "",
[registrations]       required: false
[registrations]     }
[registrations]   ],
[registrations]   description: "asdf",
[registrations]   feedback: "",
[registrations]   createdAt: 1703980079735,
[registrations]   ename: "test-script",
[registrations]   capac: 123,
[registrations]   elocation: "nonappbased",
[registrations]   imageUrl: "https://i.natgeofe.com/n/566ed88f-7ee4-4a57-be2e-aa312a5f65a1/capybara_4x3.jpg",
[registrations]   id: "script",
[registrations]   deadline: "2024-03-06T23:44:00.000Z",
[registrations]   partnerDescription: "asdfasdf",
[registrations]   startDate: "2023-12-30T23:44:37.504Z",
[registrations]   pricing: { members: 0 },
[registrations]   isApplicationBased: false,
[registrations]   updatedAt: 1703980079735,
[registrations]   registrationQuestions: []
[registrations] }
*/