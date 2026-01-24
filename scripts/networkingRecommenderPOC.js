import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PdfReader } = require("pdfreader");
import { algoliaClient } from "../lib/algoliaClient.js";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

import search from "../lib/search.js";
import {
  BLUEPRINT_OPENSEARCH_TEST_INDEX,
  BLUEPRINT_OPENSEARCH_PROD_INDEX,
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

async function downloadDrivePDF(driveUrl) {
  // Check if it's a Google Docs URL
  if (driveUrl.includes('docs.google.com/document')) {
    const docIdMatch = driveUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!docIdMatch) {
      console.error('Could not extract doc ID from URL');
      return null;
    }
    
    const docId = docIdMatch[1];
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=pdf`;
    
    console.log(`Attempting to export Google Doc: ${docId}`);
    
    try {
      const response = await axios.get(exportUrl, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" },
        maxRedirects: 5
      });
      
      console.log(`Export response status: ${response.status}, content-type: ${response.headers['content-type']}`);
      
      if (response.headers['content-type']?.includes('application/pdf')) {
        console.log('Successfully exported Google Doc as PDF');
        return Buffer.from(response.data);
      } else {
        console.error(`Expected PDF but got: ${response.headers['content-type']}`);
        return null;
      }
    } catch (error) {
      console.error(`Failed to export Google Doc: ${error.message}`);
      console.error(`Status: ${error.response?.status}, URL: ${exportUrl}`);
      return null;
    }
  }
  
  // Original PDF download logic
  const fileId = driveUrl.match(/[-\w]{25,}/)?.[0];
  if (!fileId) return null;

  const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  let response = await axios.get(baseUrl, {
    responseType: "arraybuffer",
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  if (response.headers["content-type"]?.includes("text/html")) {
    const html = response.data.toString();
    const confirmToken = html.match(/confirm=([0-9A-Za-z_]+)/)?.[1];
    if (confirmToken) {
      response = await axios.get(`${baseUrl}&confirm=${confirmToken}`, {
        responseType: "arraybuffer"
      });
    }
  }

  return Buffer.from(response.data);
}

async function extractTextFromPDF(pdfBuffer) {
  return new Promise((resolve) => {
    let text = "";
    let hasResolved = false;
    
    try {
      const reader = new PdfReader({ debug: false });
      
      reader.parseBuffer(pdfBuffer, (err, item) => {
        if (hasResolved) return;
        
        if (err) {
          console.error(`PDF parse error: ${err.message}`);
          hasResolved = true;
          resolve("");
          return;
        }
        if (!item) {
          console.log(`Extracted ${text.length} characters from PDF`);
          hasResolved = true;
          resolve(text.trim());
        } else if (item.text) {
          text += item.text + " ";
        }
      });
      
      // Add timeout in case reader never calls back
      setTimeout(() => {
        if (!hasResolved) {
          console.error('PDF extraction timeout after 10s');
          hasResolved = true;
          resolve("");
        }
      }, 10000);
      
    } catch (error) {
      console.error(`PDF extraction sync error: ${error.message}`);
      resolve("");
    }
  });
}

async function parseResume(resumeURL) {
  if (!resumeURL) return "";
  try {
    const buffer = await downloadDrivePDF(resumeURL);
    if (!buffer) return "";
    const text = await extractTextFromPDF(buffer);
    if (!text) return "";
    return normalizer(text);
  } catch (error) {
    const errorMsg = error?.message || String(error);
    console.error(`Skipping PDF: ${errorMsg.split('\n')[0]}`);
    return "";
  }
}

function normalizer(text) {
  if (!text) return "";
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 10000);
}

async function fetchProfiles(eventID, year) {
  const registrations = await client.send(
    new QueryCommand({
      TableName: "biztechRegistrationsPROD",
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
      console.log(`\n--- Parsing: ${registration.basicInformation.fname} ---`);
      const rawPdfText = await parseResume(resumeURL);
      
      // If the PDF reader extracted basically nothing, don't waste the API call
      if (rawPdfText && rawPdfText.length > 30) {
        resumeText = await cleanWithLLM(rawPdfText);
      } else {
        console.log(` ⚠ PDF contained no readable text. Skipping LLM.`);
      }
    }

    profiles.push({
      objectID: registration.id,
      name: `${registration.basicInformation.fname} ${registration.basicInformation.lname}`,
      companiesWorkedAt: responses[BLUEPRINT_RESPONSE_MAP.experience] || "",
      rolesInterested: responses[BLUEPRINT_RESPONSE_MAP.interested_roles] || "",
      industriesInterested: responses[BLUEPRINT_RESPONSE_MAP.interested_industries] || "",
      resumeText: resumeText // This will be a clean CSV string
    });
  }
  return profiles;
}

let requestCount = 0;
let lastResetTime = Date.now();

async function cleanWithLLM(text, retries = 3) {
  if (!text || text.length < 50) {
    console.log(`Skipping LLM: text too short (${text?.length || 0} chars)`);
    return "";
  }

  // OpenAI has high limits, so we can be more aggressive, but let's keep it clean
  console.log(`→ GPT-4o-mini processing: ${text.length} chars...`);

  const systemInstructions = `You are a professional recruiting assistant. 
Extract up to 30 high-value keywords from the provided resume text.
Focus on: Programming languages, Technical tools, Job titles, and Companies.

Rules:
- Output ONLY a comma-separated list of strings.
- Do NOT include headers, bullet points, or introductory text.
- If the resume is sparse, provide fewer keywords. Do NOT hallucinate.
- Deduplicate similar terms.`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstructions },
          { role: "user", content: `Resume text: ${text.substring(0, 5000)}` }
        ],
        temperature: 0, // Keep it deterministic
        max_tokens: 600,
      });

      let content = completion.choices[0].message.content || "";

      // Post-processing: Remove any potential weird formatting
      content = content.replace(/[`#*]/g, "").trim();

      // Deduplicate and filter out short/empty strings
      const keywords = [...new Set(content.split(',')
        .map(k => k.trim())
        .filter(k => k.length > 1))]
        .slice(0, 30);

      const result = keywords.join(", ");
      
      console.log(` ✓ Success: Extracted ${keywords.length} keywords.`);
      return result;

    } catch (e) {
      console.error(` ✗ OpenAI Attempt ${attempt + 1} failed: ${e.message}`);
      
      if (e.status === 429) {
        console.log("Rate limit hit. Waiting 30s...");
        await new Promise(r => setTimeout(r, 30000));
      } else if (attempt === retries) {
        return "";
      }
    }
  }
  return "";
}

async function run(eventID, year) {
  const maxProfiles = 200;
  const allProfiles = await fetchProfiles(String(eventID), String(year));
  
  const existingIDs = await search.getAllObjectIDs({
    indexName: BLUEPRINT_OPENSEARCH_PROD_INDEX
  });
  
  const newRegistrations = (allProfiles.Items || []).filter(r => !existingIDs.has(r.id));
  console.log(`Found ${newRegistrations.length} new profiles to index.`);
  
  const parsedProfiles = await parseRegistrationsToProfiles(newRegistrations.slice(0, maxProfiles));

  console.log("Parsed", parsedProfiles.length, "profiles.");

  await search.indexDocuments({
    indexName: BLUEPRINT_OPENSEARCH_PROD_INDEX,
    documents: parsedProfiles
  });
}

// Clear index utility
async function clearIndex() {
  await algoliaClient.clearObjects({
    indexName: BLUEPRINT_OPENSEARCH_TEST_INDEX
  });
  console.log('Index cleared!');
}

// clearIndex().catch(console.error);

run("blueprint", 2026).catch(console.error);
