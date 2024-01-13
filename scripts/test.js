import {
  sendEmail
} from "../services/registrations/handler";

const emails = [
  "allan.zf.tan@gmail.com"
];

const existingEvent = {
  "elocation": "AMS Student Nest, The Great Hall (2nd Floor)",
  "partnerDescription": "UBC BizTech invites you to our flagship conference & largest event of the year: BluePrint 2024! Join us as we dive into the latest innovations, spotlight tech-driven revolutions, and empower students to make their mark on the tech industry. THEME: Digital Disruptions WHEN: Saturday, January 27th, 2024 | 11am-5pm WHERE: The Great Hall, AMS Nest (2nd Floor)",
  "registrationQuestions": [
    {
      "M": {
        "label": {
          "S": "LinkedIn URL:"
        },
        "questionId": {
          "S": "013bb98c-4286-4649-bbb9-fbc27185925c"
        },
        "choices": {
          "S": ""
        },
        "type": {
          "S": "TEXT"
        },
        "required": {
          "BOOL": false
        }
      }
    },
    {
      "M": {
        "questionImageUrl": {
          "S": ""
        },
        "label": {
          "S": "Which college do you attend?"
        },
        "questionId": {
          "S": "bede9713-17cf-4bb9-b362-8c30a1e5b543"
        },
        "choices": {
          "S": "UBC,SFU,KPU,Douglas"
        },
        "type": {
          "S": "CHECKBOX"
        },
        "required": {
          "BOOL": true
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "Why are you interested in attending BluePrint?"
        },
        "questionId": {
          "S": "0a34f9d2-12a5-4aed-abe5-d7d897f2fb5e"
        },
        "choices": {
          "S": ""
        },
        "type": {
          "S": "TEXT"
        },
        "required": {
          "BOOL": true
        }
      }
    }
  ],
  "endDate": "2024-01-28T01:00:00.000Z",
  "capac": 250,
  "createdAt": 1698818082887,
  "deadline": "2024-01-21T08:00:00.000Z",
  "imageUrl": "https://imgur.com/fA1sxyD.png",
  "isApplicationBased": false,
  "updatedAt": 1704422538418,
  "isPublished": true,
  "partnerRegistrationQuestions": [
    {
      "M": {
        "questionImageUrl": {
          "S": ""
        },
        "label": {
          "S": "What is your confirmed role? "
        },
        "questionId": {
          "S": "e79bd73c-9b27-424c-af0d-ed5b2b170675"
        },
        "type": {
          "S": "CHECKBOX"
        },
        "choices": {
          "S": "Sponsor,Keynote Speaker,Workshop Host,Networking Delegate,Panelist"
        },
        "required": {
          "BOOL": true
        }
      }
    },
    {
      "M": {
        "charLimit": {
          "N": "200"
        },
        "questionId": {
          "S": "96d4e60e-6832-4f9f-b127-ecf734cbb05f"
        },
        "questionImageUrl": {
          "S": ""
        },
        "label": {
          "S": "LinkedIn URL"
        },
        "type": {
          "S": "TEXT"
        },
        "choices": {
          "S": ""
        },
        "isSkillsQuestion": {
          "BOOL": true
        },
        "required": {
          "BOOL": true
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "Headshot"
        },
        "questionId": {
          "S": "4026ffed-9f12-4519-8e53-11720b5cfaae"
        },
        "type": {
          "S": "UPLOAD"
        },
        "choices": {
          "S": ""
        },
        "required": {
          "BOOL": true
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "Do you have any dietary restrictions?"
        },
        "questionId": {
          "S": "12596ae4-98ad-4ed0-9b62-1d40aecb2e4a"
        },
        "type": {
          "S": "TEXT"
        },
        "choices": {
          "S": ""
        },
        "required": {
          "BOOL": true
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "Please indicate any accessibility/mobility needs below"
        },
        "questionId": {
          "S": "75f50fe7-e2b3-4e56-84db-a8e923756c23"
        },
        "type": {
          "S": "TEXT"
        },
        "choices": {
          "S": ""
        },
        "required": {
          "BOOL": false
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "What is your area of expertise? Example : UX Research, Venture Capital, Project Management"
        },
        "questionId": {
          "S": "647f5bd4-d8b8-47fc-a016-b00c6ab8afd7"
        },
        "type": {
          "S": "TEXT"
        },
        "choices": {
          "S": ""
        },
        "required": {
          "BOOL": true
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "[For Panelists & Workshop Hosts] Brief biography of current and/or past work experience, professional interests, etc. (3-4 sentences) "
        },
        "questionId": {
          "S": "9917f8fe-29c8-4a8b-8124-afc72425ba8c"
        },
        "type": {
          "S": "TEXT"
        },
        "choices": {
          "S": ""
        },
        "required": {
          "BOOL": false
        }
      }
    },
    {
      "M": {
        "label": {
          "S": "Is there anything else that you'd like us to be aware of?"
        },
        "questionId": {
          "S": "dfe5b2e4-28f8-4f0f-b934-1f2a79a16060"
        },
        "type": {
          "S": "TEXT"
        },
        "choices": {
          "S": ""
        },
        "required": {
          "BOOL": false
        }
      }
    }
  ],
  "ename": "BLUEPRINT 2024",
  "startDate": "2024-01-27T19:00:00.000Z",
  "year": 2024,
  "description": "UBC BizTech invites you, the scientists, artists, entrepreneurs, united by our love for tech to join our 2024 Blueprint Conference! A one day event to advance your career in technology through opportunities to learn, connect and grow. BluePrint is not just a conference; it's a blueprint for your future. With this year's theme, DIGITAL DISRUPTIONS', we'll explore three transformative angles of the tech world. We'll dive into the latest groundbreaking innovations, spotlight the non-tech industries experiencing tech-driven revolutions, and empower students to make their mark on this dynamic industry. Where: UBC AMS NEST, The Great Hall (2nd Floor) When: Jan 27th from 11:00AM-5:00PM (Registration begins at 10:30AM) Cost: -Early members: $15 -Early Non-members: $20 -General members: $20 -General Non-members: $25 Still got questions? Message our page or email us at hannah@ubcbiztech.com. We can’t wait to see you there! #UBCBizTech #Blueprint2024",
  "feedback": null,
  "id": "blueprint",
  "pricing": {
    "members": {
      "N": "18"
    }
  }
};


for (let e of emails) {
  sendEmail({
    fname: ""
  });
}
