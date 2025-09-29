export const groups = {
  "leads": [
    "grace",
    "pauline",
    "ethanx",
    "kevin",
    "john",
    "dhrishty",
    "mikayla",
    "lillian",
    "lucas"
  ],
  "internal": ["mikayla", "erping", "ashley"],
  "experiences": [
    "pauline",
    "angela",
    "gautham",
    "jack",
    "allison",
    "danielz",
    "danielt",
    "chris"
  ],
  "partnerships": [
    "john",
    "rohan",
    "darius",
    "jimmy",
    "keon",
    "karens",
    "angelaf"
  ],
  "mmd": [
    "emma",
    "keira",
    "dhrishty",
    "emilyl",
    "stephanie",
    "ali",
    "yumin",
    "indy",
    "chelsea",
    "julianna"
  ],
  "devs": [
    "kevin",
    "ali",
    "jay",
    "ethan",
    "elijah",
    "brian",
    "benny",
    "kevinh",
    "isaac",
    "aurora",
    "alexg"
  ],
  "fyr": ["michele", "sophia", "jade"],
  "data": ["ethanx", "hiro", "elena", "janaye"],
  "bizbot": ["alexg", "kevinh", "isaac", "jay", "kevin"],
  "bt-web-v2": ["benny", "ethan", "aurora", "ali", "jay", "kevin"]
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
export const DISCORD_GUILD_ID = "1048448989307093054";
const VERIFIED_MEMBERSHIP = "1054932021304115280";

export const MEMBERSHIP_ROLES = {
  verified: [
    VERIFIED_MEMBERSHIP
  ],
};
