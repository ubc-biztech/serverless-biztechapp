import {
  getTierLabel,
  getStatusLabel,
  normalizeTier,
  normalizeStoredStatus,
  sortLinksNewestFirst,
  sortPartners
} from "./helpers";

const EMPTY_LINK_ROW = {
  linkId: "",
  status: "",
  eventId: "",
  eventYear: "",
  eventName: "",
  packageTier: "",
  eventRole: "",
  eventNotes: "",
  sponsorshipAmount: "",
  followUpDate: "",
  linkUpdatedAt: ""
};

const toIsoFromTimestamp = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return "";
  return tags.filter(Boolean).join(", ");
};

const toBasePartnerRow = (partner) => {
  return {
    partnerId: partner.id || "",
    company: partner.company || "",
    contactName: partner.contactName || "",
    email: partner.email || "",
    phone: partner.phone || "",
    contactRole: partner.contactRole || "",
    partnerTier: getTierLabel(normalizeTier(partner.tier || "")),
    linkedIn: partner.linkedin || "",
    partnerNotes: partner.notes || "",
    tags: normalizeTags(partner.tags),
    alumniPartner: partner.isAlumni ? "Yes" : "No",
    archived: partner.archived ? "Yes" : "No",
    partnerUpdatedAt: toIsoFromTimestamp(partner.updatedAt)
  };
};

const toLinkRow = (link) => {
  return {
    linkId: link.id || "",
    status: getStatusLabel(normalizeStoredStatus(link.status)),
    eventId: link.eventId || "",
    eventYear: link.eventYear || "",
    eventName: link.eventName || "",
    packageTier: getTierLabel(normalizeTier(link.packageTier || "")),
    eventRole: link.role || "",
    eventNotes: link.notes || "",
    sponsorshipAmount:
      typeof link.amount === "number" && Number.isFinite(link.amount)
        ? String(link.amount)
        : "",
    followUpDate: link.followUpDate || "",
    linkUpdatedAt: toIsoFromTimestamp(link.updatedAt || link.createdAt)
  };
};

export const PARTNERSHIP_EXPORT_SCHEMA = [
  {
    key: "company",
    label: "Company",
    width: 220
  },
  {
    key: "contactName",
    label: "Primary Contact",
    width: 190
  },
  {
    key: "contactRole",
    label: "Contact Role",
    width: 160
  },
  {
    key: "email",
    label: "Email",
    width: 220
  },
  {
    key: "phone",
    label: "Phone",
    width: 130
  },
  {
    key: "tags",
    label: "Tags",
    width: 180
  },
  {
    key: "alumniPartner",
    label: "Alumni Partner",
    width: 120
  },
  {
    key: "archived",
    label: "Archived",
    width: 100
  },
  {
    key: "partnerTier",
    label: "Partner Tier",
    width: 130
  },
  {
    key: "eventName",
    label: "Event",
    width: 220
  },
  {
    key: "eventYear",
    label: "Event Year",
    width: 90
  },
  {
    key: "status",
    label: "Pipeline Status",
    width: 170
  },
  {
    key: "eventRole",
    label: "Involvement Type",
    width: 180
  },
  {
    key: "packageTier",
    label: "Package Tier",
    width: 130
  },
  {
    key: "sponsorshipAmount",
    label: "Amount (USD)",
    width: 120
  },
  {
    key: "followUpDate",
    label: "Follow-up Date",
    width: 120
  },
  {
    key: "eventNotes",
    label: "Event Notes",
    width: 280
  },
  {
    key: "partnerNotes",
    label: "Partner Notes",
    width: 300
  },
  {
    key: "linkedIn",
    label: "LinkedIn",
    width: 240
  },
  {
    key: "partnerId",
    label: "Partner ID",
    width: 240
  },
  {
    key: "eventId",
    label: "Event ID",
    width: 180
  },
  {
    key: "linkId",
    label: "Link ID",
    width: 260
  },
  {
    key: "partnerUpdatedAt",
    label: "Partner Updated At",
    width: 190
  },
  {
    key: "linkUpdatedAt",
    label: "Link Updated At",
    width: 190
  }
];

export const PARTNERSHIP_EXPORT_COLUMNS = PARTNERSHIP_EXPORT_SCHEMA.map(
  (column) => column.key
);

export const PARTNERSHIP_EXPORT_HEADERS = PARTNERSHIP_EXPORT_SCHEMA.map(
  (column) => column.label
);

export const PARTNERSHIP_EXPORT_COLUMN_WIDTHS = PARTNERSHIP_EXPORT_SCHEMA.map(
  (column) => column.width || 140
);

export const buildPartnershipExportRows = (partners, links) => {
  const linksByPartner = (links || []).reduce((acc, link) => {
    if (!acc[link.partnerId]) {
      acc[link.partnerId] = [];
    }
    acc[link.partnerId].push(link);
    return acc;
  }, {});

  const rows = [];

  for (const partner of sortPartners(partners || [])) {
    const basePartnerRow = toBasePartnerRow(partner);
    const partnerLinks = sortLinksNewestFirst(linksByPartner[partner.id] || []);

    if (!partnerLinks.length) {
      rows.push({
        ...basePartnerRow,
        ...EMPTY_LINK_ROW
      });
      continue;
    }

    for (const link of partnerLinks) {
      rows.push({
        ...basePartnerRow,
        ...toLinkRow(link)
      });
    }
  }

  return rows;
};
