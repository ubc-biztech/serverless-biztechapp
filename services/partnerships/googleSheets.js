import { v4 as uuidv4 } from "uuid";
import { google } from "googleapis";
import db from "../../lib/db";
import {
  PARTNERS_TABLE,
  PARTNER_EVENT_LINKS_TABLE,
  PARTNERSHIP_EVENTS_TABLE,
  PARTNERSHIPS_META_TABLE
} from "../../constants/tables";
import {
  DEFAULT_PARTNERSHIP_STATUS,
  getTierLabel,
  mergeAlumniTag,
  normalizeStatus,
  normalizeStoredStatus,
  normalizeTier,
  normalizeText,
  toEventIdYear
} from "./helpers";
import {
  buildPartnershipExportRows,
  PARTNERSHIP_EXPORT_COLUMNS,
  PARTNERSHIP_EXPORT_COLUMN_WIDTHS,
  PARTNERSHIP_EXPORT_HEADERS
} from "./exportRows";

const SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];
const DEFAULT_SHEET_NAME = "PartnershipsCRM";
const MAX_WARNING_COUNT = 50;
const GOOGLE_SHEETS_SYNC_META_ID = "google_sheets_sync_status";
const BASE_TEXT_COLOR = {
  red: 0.07,
  green: 0.1,
  blue: 0.16
};

const normalizeHeaderKey = (value) => String(value || "").trim();

const colorFromHex = (hex) => {
  const normalized = String(hex || "")
    .trim()
    .replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return BASE_TEXT_COLOR;
  }
  return {
    red: parseInt(normalized.slice(0, 2), 16) / 255,
    green: parseInt(normalized.slice(2, 4), 16) / 255,
    blue: parseInt(normalized.slice(4, 6), 16) / 255
  };
};

const SHEET_HEADER_ALIAS_MAP = PARTNERSHIP_EXPORT_COLUMNS.reduce((acc, key, index) => {
  const normalizedKey = normalizeHeaderKey(key).toLowerCase();
  const normalizedLabel = normalizeHeaderKey(PARTNERSHIP_EXPORT_HEADERS[index]).toLowerCase();

  acc[normalizedKey] = key;
  if (normalizedLabel) {
    acc[normalizedLabel] = key;
  }

  return acc;
}, {});

SHEET_HEADER_ALIAS_MAP.sponsorshiptier = "packageTier";
SHEET_HEADER_ALIAS_MAP.tier = "packageTier";
SHEET_HEADER_ALIAS_MAP.involvementtype = "eventRole";
SHEET_HEADER_ALIAS_MAP.role = "eventRole";
SHEET_HEADER_ALIAS_MAP.amount = "sponsorshipAmount";
SHEET_HEADER_ALIAS_MAP.amountusd = "sponsorshipAmount";
SHEET_HEADER_ALIAS_MAP.partnertags = "tags";

const toCanonicalHeaderKey = (value) => {
  const normalized = normalizeHeaderKey(value).toLowerCase();
  return SHEET_HEADER_ALIAS_MAP[normalized] || normalizeHeaderKey(value);
};

const toColumnLetter = (columnIndex) => {
  let dividend = Number(columnIndex) + 1;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
};

const toBoolean = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["true", "yes", "y", "1"].includes(normalized);
};

const toNumericAmount = (value) => {
  const raw = String(value || "")
    .replace(/[,$]/g, "")
    .trim();

  if (!raw) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
};

const toFollowUpDate = (value) => {
  const raw = normalizeText(value, 10);
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

const toYear = (value) => {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
};

const normalizePartnerLookupKey = (company, email, contactName) => {
  return [
    normalizeText(company, 140).toLowerCase(),
    normalizeText(email, 180).toLowerCase(),
    normalizeText(contactName, 120).toLowerCase()
  ].join("|");
};

const normalizePrivateKey = (rawKey) => {
  return String(rawKey || "")
    .replace(/\\n/g, "\n")
    .trim();
};

const getErrorMessage = (error) => {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error.";
};

const isResourceNotFoundError = (error) => {
  const type = String(error?.type || error?.name || error?.__type || "");
  return type.includes("ResourceNotFoundException");
};

const parseServiceAccountJson = () => {
  const raw = process.env.PARTNERSHIPS_GSHEETS_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return {
      credentials: null,
      parseError: null
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const clientEmail = String(parsed.client_email || "").trim();
    const privateKey = normalizePrivateKey(parsed.private_key);

    if (!clientEmail || !privateKey) {
      return {
        credentials: null,
        parseError: "Service account JSON is missing client_email/private_key."
      };
    }

    return {
      credentials: {
        clientEmail,
        privateKey
      },
      parseError: null
    };
  } catch (error) {
    return {
      credentials: null,
      parseError: `PARTNERSHIPS_GSHEETS_SERVICE_ACCOUNT_JSON is invalid JSON: ${error.message}`
    };
  }
};

const resolveServiceAccountCredentials = () => {
  const fromJson = parseServiceAccountJson();
  if (fromJson.credentials) {
    return {
      credentials: fromJson.credentials,
      source: "json",
      parseError: null
    };
  }

  const clientEmail = String(
    process.env.PARTNERSHIPS_GSHEETS_SERVICE_ACCOUNT_EMAIL || ""
  ).trim();
  const privateKey = normalizePrivateKey(
    process.env.PARTNERSHIPS_GSHEETS_PRIVATE_KEY
  );

  if (clientEmail && privateKey) {
    return {
      credentials: {
        clientEmail,
        privateKey
      },
      source: "split",
      parseError: fromJson.parseError
    };
  }

  return {
    credentials: null,
    source: null,
    parseError: fromJson.parseError
  };
};

export const getGoogleSheetsConfig = () => {
  const enabledRaw = String(process.env.PARTNERSHIPS_GSHEETS_ENABLED || "")
    .trim()
    .toLowerCase();
  const explicitlyDisabled = enabledRaw === "false";
  const spreadsheetId = String(
    process.env.PARTNERSHIPS_GSHEETS_SPREADSHEET_ID || ""
  ).trim();
  const sheetName =
    String(process.env.PARTNERSHIPS_GSHEETS_SHEET_NAME || "").trim() ||
    DEFAULT_SHEET_NAME;
  const resolvedCredentials = resolveServiceAccountCredentials();
  const credentials = resolvedCredentials.credentials;
  const autoSync =
    String(process.env.PARTNERSHIPS_GSHEETS_AUTO_SYNC || "")
      .trim()
      .toLowerCase() === "true";

  const configured =
    !explicitlyDisabled &&
    Boolean(
      spreadsheetId && credentials?.clientEmail && credentials?.privateKey
    );

  return {
    configured,
    autoSync,
    spreadsheetId,
    sheetName,
    credentials,
    diagnostics: {
      enabledRaw,
      explicitlyDisabled,
      spreadsheetIdPresent: Boolean(spreadsheetId),
      serviceAccountJsonPresent: Boolean(
        String(
          process.env.PARTNERSHIPS_GSHEETS_SERVICE_ACCOUNT_JSON || ""
        ).trim()
      ),
      serviceAccountEmailPresent: Boolean(
        String(
          process.env.PARTNERSHIPS_GSHEETS_SERVICE_ACCOUNT_EMAIL || ""
        ).trim()
      ),
      privateKeyPresent: Boolean(
        String(process.env.PARTNERSHIPS_GSHEETS_PRIVATE_KEY || "").trim()
      ),
      credentialSource: resolvedCredentials.source,
      credentialParseError: resolvedCredentials.parseError || null
    },
    reason: explicitlyDisabled
      ? "Google Sheets sync is disabled by PARTNERSHIPS_GSHEETS_ENABLED=false."
      : resolvedCredentials.parseError
        ? "Google Sheets credentials are invalid."
        : "Google Sheets sync is not configured."
  };
};

const assertSheetsConfigured = () => {
  const config = getGoogleSheetsConfig();
  if (!config.configured) {
    throw new Error(
      "Google Sheets sync is not configured. Set PARTNERSHIPS_GSHEETS_SPREADSHEET_ID and service account credentials on the server."
    );
  }
  return config;
};

const createSheetsClient = (config) => {
  const auth = new google.auth.JWT({
    email: config.credentials.clientEmail,
    key: config.credentials.privateKey,
    scopes: SHEETS_SCOPE
  });

  return google.sheets({
    version: "v4",
    auth
  });
};

const toSheetRange = (sheetName, range) => {
  const escaped = String(sheetName).replace(/'/g, "''");
  return `'${escaped}'!${range}`;
};

const ensureSheetExists = async (sheetsClient, spreadsheetId, sheetName) => {
  const metadataResponse = await sheetsClient.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,gridProperties.frozenRowCount)"
  });

  const sheets = metadataResponse?.data?.sheets || [];
  let target = sheets.find((sheet) => sheet?.properties?.title === sheetName);

  if (!target) {
    const createResponse = await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });

    const created = createResponse?.data?.replies?.[0]?.addSheet;
    target = created || null;
  }

  const sheetId = target?.properties?.sheetId;
  const frozenRows = target?.properties?.gridProperties?.frozenRowCount || 0;

  if (sheetId && frozenRows < 1) {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: "gridProperties.frozenRowCount"
            }
          }
        ]
      }
    });
  }

  return {
    sheetId: sheetId || null
  };
};

const rowsToSheetValues = (rows) => {
  const header = [...PARTNERSHIP_EXPORT_HEADERS];
  const values = rows.map((row) =>
    PARTNERSHIP_EXPORT_COLUMNS.map((column) =>
      row[column] === undefined || row[column] === null
        ? ""
        : row[column]
    )
  );
  return [header, ...values];
};

const objectFromSheetRow = (headers, row) => {
  const record = {};
  for (let index = 0; index < headers.length; index += 1) {
    const header = toCanonicalHeaderKey(headers[index]);
    if (!header) continue;
    record[header] = row[index] === undefined ? "" : String(row[index]).trim();
  }
  return record;
};

const applySheetPresentation = async ({
  sheetsClient,
  spreadsheetId,
  sheetId,
  rowCount
}) => {
  if (sheetId === null || sheetId === undefined) return;

  const columnCount = PARTNERSHIP_EXPORT_COLUMNS.length;
  const amountColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("sponsorshipAmount");
  const statusColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("status");
  const followUpDateColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("followUpDate");
  const yearColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("eventYear");
  const alumniColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("alumniPartner");
  const archivedColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("archived");
  const partnerUpdatedAtColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("partnerUpdatedAt");
  const linkUpdatedAtColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("linkUpdatedAt");
  const partnerIdColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("partnerId");
  const eventIdColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("eventId");
  const linkIdColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("linkId");
  const notesStartColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("eventNotes");
  const notesEndColumnIndex = PARTNERSHIP_EXPORT_COLUMNS.indexOf("linkedIn") + 1;
  const lastRowIndex = Math.max(rowCount, 2);

  const metadataResponse = await sheetsClient.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId),conditionalFormats,bandedRanges(bandedRangeId))"
  });
  const targetSheet = (metadataResponse?.data?.sheets || []).find(
    (sheet) => Number(sheet?.properties?.sheetId) === Number(sheetId)
  );
  const existingConditionalFormatCount = Array.isArray(
    targetSheet?.conditionalFormats
  )
    ? targetSheet.conditionalFormats.length
    : 0;
  const existingBandings = Array.isArray(targetSheet?.bandedRanges)
    ? targetSheet.bandedRanges
    : [];

  const requests = [];

  for (let index = existingConditionalFormatCount - 1; index >= 0; index -= 1) {
    requests.push({
      deleteConditionalFormatRule: {
        sheetId,
        index
      }
    });
  }

  for (const banding of existingBandings) {
    if (!banding?.bandedRangeId) continue;
    requests.push({
      deleteBanding: {
        bandedRangeId: banding.bandedRangeId
      }
    });
  }

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          frozenRowCount: 1,
          frozenColumnCount: 2
        }
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
    }
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            bold: true,
            foregroundColor: colorFromHex("0B1324")
          },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP"
        }
      },
      fields:
        "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
    }
  });

  const headerGroups = [
    {
      start: 0,
      end: Math.min(9, columnCount),
      color: colorFromHex("CCE1FF")
    },
    {
      start: 9,
      end: Math.min(16, columnCount),
      color: colorFromHex("D6F0E1")
    },
    {
      start: 16,
      end: columnCount,
      color: colorFromHex("E6E0F7")
    }
  ];

  for (const group of headerGroups) {
    if (group.start >= group.end) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: group.start,
          endColumnIndex: group.end
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: group.color
          }
        },
        fields: "userEnteredFormat.backgroundColor"
      }
    });
  }

  requests.push({
    addBanding: {
      bandedRange: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: lastRowIndex,
          startColumnIndex: 0,
          endColumnIndex: columnCount
        },
        rowProperties: {
          firstBandColor: {
            red: 1,
            green: 1,
            blue: 1
          },
          secondBandColor: {
            red: 0.97,
            green: 0.98,
            blue: 1
          }
        }
      }
    }
  });

  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: Math.max(rowCount, 1),
          startColumnIndex: 0,
          endColumnIndex: columnCount
        }
      }
    }
  });

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: 0,
        endIndex: 1
      },
      properties: {
        pixelSize: 40
      },
      fields: "pixelSize"
    }
  });

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: 1,
        endIndex: lastRowIndex
      },
      properties: {
        pixelSize: 32
      },
      fields: "pixelSize"
    }
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: lastRowIndex,
        startColumnIndex: 0,
        endColumnIndex: columnCount
      },
      cell: {
        userEnteredFormat: {
          verticalAlignment: "MIDDLE",
          wrapStrategy: "CLIP",
          textFormat: {
            foregroundColor: BASE_TEXT_COLOR
          }
        }
      },
      fields:
        "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat.foregroundColor)"
    }
  });

  if (notesStartColumnIndex >= 0 && notesEndColumnIndex > notesStartColumnIndex) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: notesStartColumnIndex,
          endColumnIndex: notesEndColumnIndex
        },
        cell: {
          userEnteredFormat: {
            wrapStrategy: "WRAP"
          }
        },
        fields: "userEnteredFormat.wrapStrategy"
      }
    });
  }

  for (let index = 0; index < PARTNERSHIP_EXPORT_COLUMN_WIDTHS.length; index += 1) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: index,
          endIndex: index + 1
        },
        properties: {
          pixelSize: PARTNERSHIP_EXPORT_COLUMN_WIDTHS[index]
        },
        fields: "pixelSize"
      }
    });
  }

  if (yearColumnIndex >= 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: yearColumnIndex,
          endColumnIndex: yearColumnIndex + 1
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat.horizontalAlignment"
      }
    });
  }

  if (statusColumnIndex >= 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: statusColumnIndex,
          endColumnIndex: statusColumnIndex + 1
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat.horizontalAlignment"
      }
    });
  }

  for (const columnIndex of [alumniColumnIndex, archivedColumnIndex]) {
    if (columnIndex < 0) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: columnIndex,
          endColumnIndex: columnIndex + 1
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat.horizontalAlignment"
      }
    });
  }

  if (amountColumnIndex >= 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: amountColumnIndex,
          endColumnIndex: amountColumnIndex + 1
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "CURRENCY",
              pattern: "$#,##0.00"
            },
            horizontalAlignment: "RIGHT"
          }
        },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)"
      }
    });
  }

  if (followUpDateColumnIndex >= 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: followUpDateColumnIndex,
          endColumnIndex: followUpDateColumnIndex + 1
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "DATE",
              pattern: "yyyy-mm-dd"
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)"
      }
    });
  }

  for (const timeColumnIndex of [partnerUpdatedAtColumnIndex, linkUpdatedAtColumnIndex]) {
    if (timeColumnIndex < 0) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: lastRowIndex,
          startColumnIndex: timeColumnIndex,
          endColumnIndex: timeColumnIndex + 1
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "DATE_TIME",
              pattern: "yyyy-mm-dd hh:mm"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    });
  }

  if (statusColumnIndex >= 0) {
    const statusColumnLetter = toColumnLetter(statusColumnIndex);
    const anyStatusFormula = `=LEN(TRIM($${statusColumnLetter}2))>0`;
    const statusStyles = [
      {
        value: "Prospecting",
        backgroundColor: colorFromHex("E5E7EB"),
        textColor: colorFromHex("1F2937")
      },
      {
        value: "Pitched",
        backgroundColor: colorFromHex("DBEAFE"),
        textColor: colorFromHex("1E3A8A")
      },
      {
        value: "Reached Out",
        backgroundColor: colorFromHex("E0F2FE"),
        textColor: colorFromHex("0C4A6E")
      },
      {
        value: "Shortlist",
        backgroundColor: colorFromHex("EDE9FE"),
        textColor: colorFromHex("4C1D95")
      },
      {
        value: "Paid",
        backgroundColor: colorFromHex("DCFCE7"),
        textColor: colorFromHex("14532D")
      },
      {
        value: "Confirmed",
        backgroundColor: colorFromHex("CCFBF1"),
        textColor: colorFromHex("134E4A")
      },
      {
        value: "Declined",
        backgroundColor: colorFromHex("FEE2E2"),
        textColor: colorFromHex("7F1D1D")
      },
      {
        value: "Backed Out",
        backgroundColor: colorFromHex("FFEDD5"),
        textColor: colorFromHex("7C2D12")
      },
      {
        value: "In Conversation",
        backgroundColor: colorFromHex("DBEAFE"),
        textColor: colorFromHex("1E3A8A")
      },
      {
        value: "Followed Up",
        backgroundColor: colorFromHex("E0E7FF"),
        textColor: colorFromHex("312E81")
      }
    ];

    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 1,
              endRowIndex: lastRowIndex,
              startColumnIndex: statusColumnIndex,
              endColumnIndex: statusColumnIndex + 1
            }
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: anyStatusFormula }]
            },
            format: {
              backgroundColor: colorFromHex("F3F4F6"),
              textFormat: {
                bold: true,
                foregroundColor: colorFromHex("111827")
              }
            }
          }
        }
      }
    });

    for (const style of statusStyles) {
      requests.push({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 1,
                endRowIndex: lastRowIndex,
                startColumnIndex: statusColumnIndex,
                endColumnIndex: statusColumnIndex + 1
              }
            ],
            booleanRule: {
              condition: {
                type: "TEXT_EQ",
                values: [
                  {
                    userEnteredValue: style.value
                  }
                ]
              },
              format: {
                backgroundColor: style.backgroundColor,
                textFormat: {
                  bold: true,
                  foregroundColor: style.textColor
                }
              }
            }
          }
        }
      });
    }
  }

  if (followUpDateColumnIndex >= 0) {
    const followUpLetter = toColumnLetter(followUpDateColumnIndex);
    const overdueFormula = `=AND($${followUpLetter}2<>"",$${followUpLetter}2<TODAY())`;
    const soonFormula = `=AND($${followUpLetter}2<>"",$${followUpLetter}2>=TODAY(),$${followUpLetter}2<=TODAY()+7)`;

    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 1,
              endRowIndex: lastRowIndex,
              startColumnIndex: followUpDateColumnIndex,
              endColumnIndex: followUpDateColumnIndex + 1
            }
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: overdueFormula }]
            },
            format: {
              backgroundColor: colorFromHex("FECACA"),
              textFormat: {
                bold: true,
                foregroundColor: colorFromHex("7F1D1D")
              }
            }
          }
        }
      }
    });

    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 1,
              endRowIndex: lastRowIndex,
              startColumnIndex: followUpDateColumnIndex,
              endColumnIndex: followUpDateColumnIndex + 1
            }
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: soonFormula }]
            },
            format: {
              backgroundColor: colorFromHex("FEF3C7"),
              textFormat: {
                bold: true,
                foregroundColor: colorFromHex("78350F")
              }
            }
          }
        }
      }
    });
  }

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: columnCount
      },
      properties: {
        hiddenByUser: false
      },
      fields: "hiddenByUser"
    }
  });

  const technicalColumns = [
    partnerIdColumnIndex,
    eventIdColumnIndex,
    linkIdColumnIndex,
    partnerUpdatedAtColumnIndex,
    linkUpdatedAtColumnIndex
  ].filter((index) => index >= 0);

  for (const index of technicalColumns) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: index,
          endIndex: index + 1
        },
        properties: {
          hiddenByUser: true
        },
        fields: "hiddenByUser"
      }
    });
  }

  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests
    }
  });
};

const readRowsFromSheet = async (sheetsClient, spreadsheetId, sheetName) => {
  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: toSheetRange(sheetName, "A:ZZ")
  });

  const values = response?.data?.values || [];
  if (!values.length) return [];

  const headers = values[0] || [];
  return values.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    record: objectFromSheetRow(headers, row)
  }));
};

const getSyncStatusSnapshot = async () => {
  try {
    const item = await db.getOne(
      GOOGLE_SHEETS_SYNC_META_ID,
      PARTNERSHIPS_META_TABLE
    );
    return item || null;
  } catch (error) {
    if (isResourceNotFoundError(error)) {
      return null;
    }
    console.error("Unable to read Google Sheets sync status record.", error);
    return null;
  }
};

const writeSyncStatus = async ({
  mode,
  status,
  summary = null,
  errorMessage = null
}) => {
  const timestamp = Date.now();
  const current = await db.getOne(
    GOOGLE_SHEETS_SYNC_META_ID,
    PARTNERSHIPS_META_TABLE
  );

  if (!current) {
    await db.create(
      {
        id: GOOGLE_SHEETS_SYNC_META_ID,
        integration: "google_sheets",
        lastSyncAt: new Date(timestamp).toISOString(),
        lastSyncMode: mode,
        lastSyncStatus: status,
        lastSyncSummary: summary,
        lastSyncError: errorMessage,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      PARTNERSHIPS_META_TABLE
    );
    return;
  }

  await db.updateDB(
    GOOGLE_SHEETS_SYNC_META_ID,
    {
      lastSyncAt: new Date(timestamp).toISOString(),
      lastSyncMode: mode,
      lastSyncStatus: status,
      lastSyncSummary: summary,
      lastSyncError: errorMessage
    },
    PARTNERSHIPS_META_TABLE
  );
};

const safeWriteSyncStatus = async (payload) => {
  try {
    await writeSyncStatus(payload);
  } catch (error) {
    if (isResourceNotFoundError(error)) {
      return;
    }
    console.error("Unable to persist Google Sheets sync status.", error);
  }
};

const loadExistingDataSnapshot = async () => {
  const [partners, links, events] = await Promise.all([
    db.scan(PARTNERS_TABLE),
    db.scan(PARTNER_EVENT_LINKS_TABLE),
    db.scan(PARTNERSHIP_EVENTS_TABLE)
  ]);

  const partnersById = new Map();
  const partnerLookup = new Map();

  for (const partner of partners) {
    partnersById.set(partner.id, partner);
    const lookupKey = normalizePartnerLookupKey(
      partner.company,
      partner.email,
      partner.contactName
    );
    if (!partnerLookup.has(lookupKey)) {
      partnerLookup.set(lookupKey, partner.id);
    }
  }

  const linksById = new Map(links.map((link) => [link.id, link]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const eventsByIdYear = new Map(
    events.map((event) => [toEventIdYear(event.id, event.year), event])
  );

  return {
    partnersById,
    partnerLookup,
    linksById,
    eventsById,
    eventsByIdYear
  };
};

const parseTags = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((tag) => normalizeText(tag, 40))
    .filter(Boolean);
};

const hasAnyPartnerContent = (record) => {
  return Boolean(
    normalizeText(record.company, 140) ||
    normalizeText(record.contactName, 120) ||
    normalizeText(record.email, 180) ||
    normalizeText(record.phone, 60)
  );
};

const addWarning = (warnings, message) => {
  if (warnings.length >= MAX_WARNING_COUNT) return;
  warnings.push(message);
};

const resolvePartnerId = (record, snapshot) => {
  const candidate = normalizeText(record.partnerId, 120);
  if (candidate) return candidate;

  const lookupKey = normalizePartnerLookupKey(
    record.company,
    record.email,
    record.contactName
  );
  const matchedPartnerId = snapshot.partnerLookup.get(lookupKey);
  if (matchedPartnerId) return matchedPartnerId;

  return uuidv4();
};

const upsertPartner = async (record, snapshot) => {
  const timestamp = Date.now();
  const partnerId = resolvePartnerId(record, snapshot);
  const existing = snapshot.partnersById.get(partnerId) || null;

  const company = normalizeText(record.company, 140);
  const email = normalizeText(record.email, 180).toLowerCase();
  const contactName = normalizeText(record.contactName, 120);
  const phone = normalizeText(record.phone, 60);
  const contactRole = normalizeText(
    record.contactRole || record.role || "",
    80
  );
  const tier = normalizeTier(record.partnerTier || record.tier || "");
  const linkedIn = normalizeText(record.linkedIn || record.linkedin || "", 300);
  const partnerNotes = normalizeText(
    record.partnerNotes || record.notes || "",
    5000
  );
  const isAlumni = toBoolean(record.alumniPartner);
  const archived = toBoolean(record.archived);
  const tags = mergeAlumniTag(parseTags(record.tags), isAlumni);

  if (!existing) {
    const item = {
      id: partnerId,
      company,
      email,
      contactName,
      phone,
      contactRole,
      tier,
      linkedin: linkedIn,
      notes: partnerNotes,
      tags,
      isAlumni,
      archived,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.create(item, PARTNERS_TABLE);
    snapshot.partnersById.set(partnerId, item);
    snapshot.partnerLookup.set(
      normalizePartnerLookupKey(company, email, contactName),
      partnerId
    );

    return {
      partnerId,
      action: "created"
    };
  }

  const payload = {
    company,
    email,
    contactName,
    phone,
    contactRole,
    tier,
    linkedin: linkedIn,
    notes: partnerNotes,
    tags,
    isAlumni,
    archived
  };

  await db.updateDB(partnerId, payload, PARTNERS_TABLE);

  snapshot.partnersById.set(partnerId, {
    ...existing,
    ...payload,
    updatedAt: timestamp
  });
  snapshot.partnerLookup.set(
    normalizePartnerLookupKey(company, email, contactName),
    partnerId
  );

  return {
    partnerId,
    action: "updated"
  };
};

const extractLinkFields = (record) => {
  const eventId = normalizeText(record.eventId, 120);
  const eventYear = toYear(record.eventYear);
  const eventName = normalizeText(record.eventName, 140);
  const statusRaw = normalizeText(record.status, 80);
  const packageTier = normalizeTier(
    record.packageTier || record.sponsorshipTier || record.tier || ""
  );
  const role = normalizeText(record.eventRole || "", 80);
  const notes = normalizeText(record.eventNotes || "", 3000);
  const amount = toNumericAmount(record.sponsorshipAmount);
  const followUpDate = toFollowUpDate(record.followUpDate);
  const linkId = normalizeText(record.linkId, 220);

  return {
    linkId,
    eventId,
    eventYear,
    eventName,
    statusRaw,
    packageTier,
    role,
    notes,
    amount,
    followUpDate
  };
};

const toAutoEventId = (eventName, eventYear) => {
  const base = normalizeText(eventName, 140)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  if (!base) return "";
  return `${base}-${eventYear}`;
};

const ensurePartnershipEvent = async (
  linkFields,
  snapshot,
  warnings,
  rowNumber
) => {
  if (!linkFields.eventYear) return null;

  let eventId = linkFields.eventId;
  if (!eventId) {
    eventId = toAutoEventId(linkFields.eventName, linkFields.eventYear);
  }

  if (!eventId) {
    addWarning(
      warnings,
      `Row ${rowNumber}: skipped link because eventId/eventName is missing.`
    );
    return null;
  }

  const existingById = snapshot.eventsById.get(eventId);
  if (existingById) {
    if (Number(existingById.year) !== Number(linkFields.eventYear)) {
      addWarning(
        warnings,
        `Row ${rowNumber}: eventId ${eventId} exists with year ${existingById.year}; row requested ${linkFields.eventYear}.`
      );
    }
    return existingById;
  }

  const createdAt = Date.now();
  const initialTierConfigs = linkFields.packageTier
    ? [
      {
        id: linkFields.packageTier,
        label: getTierLabel(linkFields.packageTier),
        amount: null
      }
    ]
    : [];

  const createdEvent = {
    id: eventId,
    name: linkFields.eventName || eventId,
    year: linkFields.eventYear,
    startDate: null,
    endDate: null,
    outreachStartDate: null,
    sponsorshipGoal: null,
    tierConfigs: initialTierConfigs,
    packageTiers: linkFields.packageTier ? [linkFields.packageTier] : [],
    notes: "",
    linkedMainEventId: "",
    linkedMainEventYear: null,
    archived: false,
    createdAt,
    updatedAt: createdAt
  };

  try {
    await db.create(createdEvent, PARTNERSHIP_EVENTS_TABLE);
    snapshot.eventsById.set(createdEvent.id, createdEvent);
    snapshot.eventsByIdYear.set(
      toEventIdYear(createdEvent.id, createdEvent.year),
      createdEvent
    );
    addWarning(
      warnings,
      `Row ${rowNumber}: created partnerships event ${createdEvent.id} (${createdEvent.year}).`
    );
    return createdEvent;
  } catch {
    const fetched = await db.getOne(eventId, PARTNERSHIP_EVENTS_TABLE);
    if (fetched) {
      snapshot.eventsById.set(fetched.id, fetched);
      snapshot.eventsByIdYear.set(toEventIdYear(fetched.id, fetched.year), fetched);
      return fetched;
    }
    return null;
  }
};

const ensureEventTierConfig = async (eventRecord, tierKey, snapshot) => {
  if (!eventRecord || !tierKey) return eventRecord;

  const tier = normalizeTier(tierKey);
  if (!tier) return eventRecord;

  const existingPackageTiers = Array.isArray(eventRecord.packageTiers)
    ? eventRecord.packageTiers.map((value) => normalizeTier(value || "")).filter(Boolean)
    : [];
  const packageTierSet = new Set(existingPackageTiers);

  const existingTierConfigs = [];
  if (Array.isArray(eventRecord.tierConfigs)) {
    for (const config of eventRecord.tierConfigs) {
      const id = normalizeTier(config?.id || config?.key || config?.tier || "");
      if (!id) continue;
      existingTierConfigs.push({
        id,
        label: normalizeText(config?.label || config?.name || "", 60) || getTierLabel(id),
        amount:
          typeof config?.amount === "number" && Number.isFinite(config.amount)
            ? config.amount
            : null
      });
    }
  }
  const tierConfigMap = new Map(existingTierConfigs.map((config) => [config.id, config]));

  let changed = false;

  if (!packageTierSet.has(tier)) {
    packageTierSet.add(tier);
    changed = true;
  }

  if (!tierConfigMap.has(tier)) {
    tierConfigMap.set(tier, {
      id: tier,
      label: getTierLabel(tier),
      amount: null
    });
    changed = true;
  }

  if (!changed) {
    return eventRecord;
  }

  const nextEvent = {
    ...eventRecord,
    packageTiers: Array.from(packageTierSet),
    tierConfigs: Array.from(tierConfigMap.values()),
    updatedAt: Date.now()
  };

  await db.updateDB(
    eventRecord.id,
    {
      packageTiers: nextEvent.packageTiers,
      tierConfigs: nextEvent.tierConfigs,
      updatedAt: nextEvent.updatedAt
    },
    PARTNERSHIP_EVENTS_TABLE
  );

  snapshot.eventsById.set(nextEvent.id, nextEvent);
  snapshot.eventsByIdYear.set(toEventIdYear(nextEvent.id, nextEvent.year), nextEvent);

  return nextEvent;
};

const upsertPartnerEventLink = async (
  record,
  partnerId,
  snapshot,
  warnings,
  rowNumber
) => {
  const linkFields = extractLinkFields(record);
  if (!linkFields.eventId && !linkFields.eventYear) {
    return {
      action: "skipped"
    };
  }

  if (!linkFields.eventYear) {
    addWarning(
      warnings,
      `Row ${rowNumber}: skipped link because eventYear is required.`
    );
    return {
      action: "skipped"
    };
  }

  const linkedEvent = await ensurePartnershipEvent(
    linkFields,
    snapshot,
    warnings,
    rowNumber
  );
  if (!linkedEvent) {
    addWarning(
      warnings,
      `Row ${rowNumber}: skipped link for unresolved event.`
    );
    return {
      action: "skipped"
    };
  }

  const linkedEventWithTier = await ensureEventTierConfig(
    linkedEvent,
    linkFields.packageTier,
    snapshot
  );

  const eventIdYear = toEventIdYear(linkedEventWithTier.id, linkedEventWithTier.year);

  const normalizedStatus = normalizeStatus(
    linkFields.statusRaw || DEFAULT_PARTNERSHIP_STATUS,
    {
      allowCustom: true
    }
  );

  const linkId =
    linkFields.linkId || `${partnerId}::${linkedEvent.id}`;
  const existing = snapshot.linksById.get(linkId) || null;
  const timestamp = Date.now();

  if (!existing) {
    const item = {
      id: linkId,
      partnerId,
      eventId: linkedEventWithTier.id,
      eventYear: linkedEventWithTier.year,
      eventIdYear,
      eventName:
        linkedEventWithTier.name || linkFields.eventName || linkedEventWithTier.id,
      status: normalizedStatus,
      packageTier: linkFields.packageTier,
      role: linkFields.role,
      notes: linkFields.notes,
      amount: linkFields.amount,
      followUpDate: linkFields.followUpDate,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.create(item, PARTNER_EVENT_LINKS_TABLE);
    snapshot.linksById.set(linkId, item);
    return {
      action: "created"
    };
  }

  const payload = {
    status: normalizeStoredStatus(normalizedStatus),
    packageTier: linkFields.packageTier,
    role: linkFields.role,
    notes: linkFields.notes,
    amount: linkFields.amount,
    followUpDate: linkFields.followUpDate
  };

  await db.updateDB(linkId, payload, PARTNER_EVENT_LINKS_TABLE);
  snapshot.linksById.set(linkId, {
    ...existing,
    ...payload,
    updatedAt: timestamp
  });

  return {
    action: "updated"
  };
};

export const getGoogleSheetsStatus = async () => {
  const config = getGoogleSheetsConfig();
  const syncStatus = config.configured ? await getSyncStatusSnapshot() : null;

  if (!config.configured) {
    return {
      configured: false,
      autoSync: config.autoSync,
      sheetName: config.sheetName,
      spreadsheetId: config.spreadsheetId || null,
      diagnostics: config.diagnostics,
      message: config.reason,
      lastSyncAt: syncStatus?.lastSyncAt || null,
      lastSyncMode: syncStatus?.lastSyncMode || null,
      lastSyncStatus: syncStatus?.lastSyncStatus || null,
      lastSyncSummary: syncStatus?.lastSyncSummary || null,
      lastSyncError: syncStatus?.lastSyncError || null
    };
  }

  const sheetsClient = createSheetsClient(config);

  try {
    await sheetsClient.spreadsheets.get({
      spreadsheetId: config.spreadsheetId,
      fields: "spreadsheetId"
    });

    return {
      configured: true,
      autoSync: config.autoSync,
      sheetName: config.sheetName,
      spreadsheetId: config.spreadsheetId,
      diagnostics: config.diagnostics,
      accessible: true,
      lastSyncAt: syncStatus?.lastSyncAt || null,
      lastSyncMode: syncStatus?.lastSyncMode || null,
      lastSyncStatus: syncStatus?.lastSyncStatus || null,
      lastSyncSummary: syncStatus?.lastSyncSummary || null,
      lastSyncError: syncStatus?.lastSyncError || null
    };
  } catch (error) {
    return {
      configured: true,
      autoSync: config.autoSync,
      sheetName: config.sheetName,
      spreadsheetId: config.spreadsheetId,
      diagnostics: config.diagnostics,
      accessible: false,
      message:
        "Google Sheets credentials are configured but the sheet could not be accessed.",
      accessError: getErrorMessage(error),
      lastSyncAt: syncStatus?.lastSyncAt || null,
      lastSyncMode: syncStatus?.lastSyncMode || null,
      lastSyncStatus: syncStatus?.lastSyncStatus || null,
      lastSyncSummary: syncStatus?.lastSyncSummary || null,
      lastSyncError: syncStatus?.lastSyncError || null
    };
  }
};

export const pushPartnershipsToGoogleSheets = async () => {
  const config = assertSheetsConfigured();
  const sheetsClient = createSheetsClient(config);

  const { sheetId } = await ensureSheetExists(
    sheetsClient,
    config.spreadsheetId,
    config.sheetName
  );

  const [partners, links] = await Promise.all([
    db.scan(PARTNERS_TABLE),
    db.scan(PARTNER_EVENT_LINKS_TABLE)
  ]);

  const rows = buildPartnershipExportRows(partners, links);
  const values = rowsToSheetValues(rows);

  await sheetsClient.spreadsheets.values.clear({
    spreadsheetId: config.spreadsheetId,
    range: toSheetRange(config.sheetName, "A:ZZ")
  });

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: toSheetRange(config.sheetName, "A1"),
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values
    }
  });

  await applySheetPresentation({
    sheetsClient,
    spreadsheetId: config.spreadsheetId,
    sheetId,
    rowCount: values.length
  });

  return {
    syncedRows: rows.length,
    syncedAt: new Date().toISOString(),
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName
  };
};

export const pullPartnershipsFromGoogleSheets = async () => {
  const config = assertSheetsConfigured();
  const sheetsClient = createSheetsClient(config);

  await ensureSheetExists(sheetsClient, config.spreadsheetId, config.sheetName);

  const sheetRows = await readRowsFromSheet(
    sheetsClient,
    config.spreadsheetId,
    config.sheetName
  );

  if (!sheetRows.length) {
    return {
      processedRows: 0,
      partnersCreated: 0,
      partnersUpdated: 0,
      linksCreated: 0,
      linksUpdated: 0,
      linksSkipped: 0,
      warnings: [],
      pulledAt: new Date().toISOString(),
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName
    };
  }

  const snapshot = await loadExistingDataSnapshot();
  const warnings = [];
  const counters = {
    processedRows: 0,
    partnersCreated: 0,
    partnersUpdated: 0,
    linksCreated: 0,
    linksUpdated: 0,
    linksSkipped: 0
  };

  for (const rowEntry of sheetRows) {
    const { rowNumber, record } = rowEntry;

    if (!hasAnyPartnerContent(record)) {
      counters.linksSkipped += 1;
      addWarning(
        warnings,
        `Row ${rowNumber}: skipped because company/contact details are empty.`
      );
      continue;
    }

    if (!normalizeText(record.company, 140)) {
      counters.linksSkipped += 1;
      addWarning(
        warnings,
        `Row ${rowNumber}: skipped because company is required for sync.`
      );
      continue;
    }

    counters.processedRows += 1;

    const partnerResult = await upsertPartner(record, snapshot);
    if (partnerResult.action === "created") {
      counters.partnersCreated += 1;
    } else if (partnerResult.action === "updated") {
      counters.partnersUpdated += 1;
    }

    const linkResult = await upsertPartnerEventLink(
      record,
      partnerResult.partnerId,
      snapshot,
      warnings,
      rowNumber
    );
    if (linkResult.action === "created") {
      counters.linksCreated += 1;
    } else if (linkResult.action === "updated") {
      counters.linksUpdated += 1;
    } else {
      counters.linksSkipped += 1;
    }
  }

  return {
    ...counters,
    warnings,
    pulledAt: new Date().toISOString(),
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName
  };
};

export const syncPartnershipsWithGoogleSheets = async (mode) => {
  const normalizedMode = String(mode || "push").toLowerCase();

  try {
    if (normalizedMode === "push") {
      const push = await pushPartnershipsToGoogleSheets();
      const result = {
        mode: "push",
        push
      };

      await safeWriteSyncStatus({
        mode: "push",
        status: "success",
        summary: {
          syncedRows: push.syncedRows
        }
      });

      return result;
    }

    if (normalizedMode === "pull") {
      const pull = await pullPartnershipsFromGoogleSheets();
      const result = {
        mode: "pull",
        pull
      };

      await safeWriteSyncStatus({
        mode: "pull",
        status: "success",
        summary: {
          processedRows: pull.processedRows,
          partnersCreated: pull.partnersCreated,
          partnersUpdated: pull.partnersUpdated,
          linksCreated: pull.linksCreated,
          linksUpdated: pull.linksUpdated
        }
      });

      return result;
    }

    if (normalizedMode === "merge") {
      const pull = await pullPartnershipsFromGoogleSheets();
      const push = await pushPartnershipsToGoogleSheets();
      const result = {
        mode: "merge",
        pull,
        push
      };

      await safeWriteSyncStatus({
        mode: "merge",
        status: "success",
        summary: {
          pullProcessedRows: pull.processedRows,
          pushSyncedRows: push.syncedRows
        }
      });

      return result;
    }

    throw new Error("Invalid sync mode. Use one of: push, pull, merge.");
  } catch (error) {
    await safeWriteSyncStatus({
      mode: normalizedMode,
      status: "error",
      summary: null,
      errorMessage: getErrorMessage(error)
    });
    throw error;
  }
};
