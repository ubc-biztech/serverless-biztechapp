export const groups = {
  "leads": [
    "chris",
    "jay",
    "jerryn",
    "jimmy",
    "karens"
  ],
  "internal": ["rohan", "kailey", "hannah", "marcus"],
  "experiences": [
    "jay",
    "john",
    "jade",
    "michele",
    "danielz",
    "evan",
    "samantha",
    "freya",
    "julianna",
    "pauline"
  ],
  "partnerships": [
    "jimmy",
    "karens",
    "amara",
    "kash",
    "keanan",
    "allison",
    "jack",
    "maddisen",
    "stella"
  ],
  "mmd": [
    "jerryn",
    "stephanie",
    "emma",
    "angela",
    "sophie",
    "brittany",
    "daisy",
    "tiger",
    "ali",
    "dhrishty"
  ],
  "devs": [
    "elijah",
    "kevin",
    "eliana",
    "darius",
    "timothy",
    "shun",
    "thomas",
    "daniel",
    "vi",
    "isaac"
  ],
};

export const projects = [
  "BT-Web-V2",
  "Discord Bot",
  "Biztech Card",
  "Internal Tools"
];

export const ack = {
  statusCode: 200,
  body: ""
};

export const installationID = 71407901;

export const reminderChannelID = "C08PTKNPCHX";

export const query = `
  query {
    organization(login: "ubc-biztech") {
      projectV2(number: 4) {
        id
        title
        items(first: 100) {
          nodes {
            id
            content {
              ... on Issue {
                title
                number
                state
                url
                createdAt
                assignees(first: 5) {
                  nodes {
                    login
                  }
                }
                labels(first: 3) {
                  nodes {
                    name
                  }
                }
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldDateValue {
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                  date
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const btFields = Object.freeze({
  endDate: "End date"
});

export const btDevs = Object.freeze({
  "ethan-t-hansen": "ethan",
  "kevinxiao27": "kevin",
  "ahosseini06": "ali",
  "jaypark25": "jay",
  "bennypc": "benny",
  "liuisaac": "isaac",
  "auroraxcheng": "aurora",
  "alex-gour": "alexg",
  "briannval": "brian",
  "elijahzhao24": "elijah"
});

// discord constants (hardcoded to the server)
export const DISCORD_GUILD_ID = "1388652277178302576";
export const DISCORD_GUILD_ID_PROD = "1404646266725732492";
const VERIFIED_MEMBERSHIP = "1422059115273785434";
const MEMBERSHIP_PROD = "1414805157371318272";

export const MEMBERSHIP_ROLES = {
  verified: [VERIFIED_MEMBERSHIP],
  verifiedPROD: [MEMBERSHIP_PROD]
};
