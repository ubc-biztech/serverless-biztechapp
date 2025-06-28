export const groups = {
  "@leads": [
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
  "@internal": ["mikayla", "erping", "ashley"],
  "@experiences": [
    "pauline",
    "angela",
    "gautham",
    "jack",
    "allison",
    "danielz",
    "danielt",
    "chris"
  ],
  "@partnerships": [
    "john",
    "rohan",
    "darius",
    "jimmy",
    "keon",
    "karens",
    "angelaf"
  ],
  "@mmd": [
    "dhrishty",
    "riana",
    "emilyl",
    "stephanie",
    "ali",
    "yumin",
    "indy",
    "chelsea",
    "julianna"
  ],
  "@devs": [
    "kevin",
    "ali",
    "jay",
    "ethan",
    "benny",
    "kevinh",
    "isaac",
    "aurora",
    "alexg"
  ],
  "@data": ["ethanx", "hiro", "elena", "janaye"],
  "@bizbot": ["alexg", "kevinh", "isaac", "jay", "kevin"],
  "@bt-web-v2": ["benny", "ethan", "aurora", "ali", "jay", "kevin"]
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
  kevinxiao27: "kevin",
  Kevmister331: "kevinh",
  ahosseini06: "ali",
  jaypark25: "jay",
  bennypc: "benny",
  liuisaac: "isaac",
  auroraxcheng: "aurora",
  "alex-gour": "alexg"
});
