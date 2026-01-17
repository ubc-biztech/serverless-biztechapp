import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PdfReader } = require("pdfreader"); // commonjs import is necessary

import search from "../lib/search.js";
import {
  BLUEPRINT_OPENSEARCH_TEST_INDEX,
  BLUEPRINT_RESPONSE_MAP
} from "../constants/indexes.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import axios from "axios";

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2"
};

const client = new DynamoDBClient(awsConfig);

// clanker code

async function downloadDrivePDF(driveUrl) {
  const fileId = driveUrl.match(/[-\w]{25,}/)?.[0];
  if (!fileId) return null;

  const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  let response = await axios.get(baseUrl, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  // handle case where file is too large
  if (response.headers['content-type']?.includes('text/html')) {
    const html = response.data.toString();
    const confirmToken = html.match(/confirm=([0-9A-Za-z_]+)/)?.[1];
    if (confirmToken) {
      response = await axios.get(`${baseUrl}&confirm=${confirmToken}`, {
        responseType: 'arraybuffer'
      });
    }
  }

  return Buffer.from(response.data);
}

async function extractTextFromPDF(pdfBuffer) {
  return new Promise((resolve, reject) => {
    let text = "";
    new PdfReader().parseBuffer(pdfBuffer, (err, item) => {
      if (err) reject(err);
      else if (!item) resolve(text.trim());
      else if (item.text) text += item.text + " ";
    });
  });
}

function normalizer(text) {
  if (!text) return "";
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 10000); // text cap
}

async function parseResume(resumeURL) {
  if (!resumeURL) return "";
  try {
    const buffer = await downloadDrivePDF(resumeURL);
    if (!buffer) return "";
    const text = await extractTextFromPDF(buffer);
    return normalizer(text.replace(/\s+/g, ' ').trim());
  } catch (error) {
    console.error(`PDF Error: ${error.message}`);
    return "";
  }
}

// not clanker code

async function fetchProfiles(eventID, year) {
  const registrations = await client.send(
    new QueryCommand({
      TableName: "biztechRegistrations" + (process.env.ENVIRONMENT || ""),
      IndexName: "event-query",
      KeyConditionExpression: "#eventIDYear = :eventIDYear",
      ExpressionAttributeNames: { "#eventIDYear": "eventID;year" },
      ExpressionAttributeValues: { ":eventIDYear": `${eventID};${year}` }
    })
  );
  return registrations;
}

async function parseRegistrationsToProfiles(registrations) {
  const profiles = [];
  for (const registration of registrations) {
    const responses = registration.dynamicResponses || {};
    const resumeURL = responses[BLUEPRINT_RESPONSE_MAP.resume];

    let resumeText = "";
    if (resumeURL) {
      console.log(`Parsing: ${registration.basicInformation.fname}...`);
      resumeText = await parseResume(resumeURL);
      // avoid being rate limited by calling groq because im a brick
      resumeText = await cleanWithLLM(resumeText);
    }

    profiles.push({
      objectID: registration.id,
      name: `${registration.basicInformation.fname} ${registration.basicInformation.lname}`,
      companiesWorkedAt: responses[BLUEPRINT_RESPONSE_MAP.experience] || "",
      rolesInterested: responses[BLUEPRINT_RESPONSE_MAP.interested_roles] || "",
      industriesInterested: responses[BLUEPRINT_RESPONSE_MAP.interested_industries] || "",
      resumeText
    });
  }
  return profiles;
}

async function cleanWithLLM(text) {
  if (!text || text.length < 10) return text;

  const systemInstructions = `You are a JSON-only API. Extract exactly 30 keywords from the resume focusing on companies, skills, technologies, and interests. Respond with ONLY valid JSON array format: ["keyword1","keyword2",...]. NO markdown, NO explanations, NO code blocks, NO extra text.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemInstructions },
          { role: "user", content: text }
        ],
        temperature: 0
      })
    });

    if (!response.ok) {
      console.error(`Groq API failed: ${response.status} ${response.statusText}`);
      return "";
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";

    content = content.replace(/```json/g, '').replace(/```/g, '').trim();

    const jsonMatch = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in response:", content);
      return "";
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const keywords = Array.isArray(parsed) ? parsed : (parsed.keywords || []);
    return keywords.join(', ');
  } catch (e) {
    console.error("LLM error:", e.message);
    return "";
  }
}

async function run(eventID, year) {
  const allProfiles = await fetchProfiles(String(eventID), String(year));
  const checkedIn = (allProfiles.Items || []).filter(r =>
    r.registrationStatus?.toLowerCase() === "checkedin"
  );

  console.log(`Found ${checkedIn.length} checked-in users.`);
  const parsedProfiles = await parseRegistrationsToProfiles(checkedIn);

  console.log("Parsed", parsedProfiles.length, "profiles.");

  console.log(parsedProfiles)

  await search.indexDocuments({
    indexName: BLUEPRINT_OPENSEARCH_TEST_INDEX,
    documents: parsedProfiles
  });
}

run("blueprint", 2026).catch(console.error);

