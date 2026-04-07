import {
  PARTNERSHIP_STATUSES,
  normalizeStoredStatus,
  normalizeText,
  toEventIdYear
} from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UPCOMING_WINDOW_DAYS = 21;
const DEFAULT_ACTION_LIMIT = 40;
const SECURED_STATUSES = new Set(["confirmed", "paid"]);
const CLOSED_STATUSES = new Set(["paid", "declined", "backed_out"]);
const STALE_PIPELINE_STATUSES = new Set([
  "prospecting",
  "pitched",
  "reached_out",
  "shortlist",
  "in_conversation",
  "followed_up",
  "confirmed"
]);

const toFiniteAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const toPercent = (ratio) => {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(clamp(ratio, 0, 1) * 10000) / 100;
};

const parseBoolean = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
};

const parseYear = (value) => {
  if (!value || value === "all" || value === "auto") return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
};

const parsePositiveInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return clamp(parsed, min, max);
};

const toIsoDate = (value) => {
  if (!value) return null;
  const normalized = normalizeText(value, 20);
  const dateOnly = normalized.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
};

const toDateFromIso = (isoDate) => {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const toDaysUntil = (todayDate, dueDate) => {
  if (!todayDate || !dueDate) return null;
  return Math.floor((dueDate.getTime() - todayDate.getTime()) / DAY_MS);
};

const toStatusLabel = (status) => {
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
};

const normalizeEventRecord = (event) => {
  const year = Number(event?.year);
  const safeYear = Number.isInteger(year) ? year : null;

  return {
    id: String(event?.id || ""),
    eventIdYear:
      event?.id && safeYear ? toEventIdYear(event.id, safeYear) : String(event?.eventIdYear || ""),
    name: normalizeText(event?.name, 140),
    year: safeYear,
    archived: Boolean(event?.archived),
    sponsorshipGoal:
      typeof event?.sponsorshipGoal === "number" && Number.isFinite(event.sponsorshipGoal)
        ? event.sponsorshipGoal
        : null,
    outreachStartDate: toIsoDate(event?.outreachStartDate),
    startDate: toIsoDate(event?.startDate),
    endDate: toIsoDate(event?.endDate),
    updatedAt: Number(event?.updatedAt) || 0
  };
};

const eventSorter = (left, right) => {
  if ((right.year || 0) !== (left.year || 0)) {
    return (right.year || 0) - (left.year || 0);
  }

  const rightStart = right.startDate || "";
  const leftStart = left.startDate || "";
  if (rightStart !== leftStart) {
    return rightStart.localeCompare(leftStart);
  }

  return String(left.name || "").localeCompare(String(right.name || ""));
};

const resolveProgressRatio = (startIsoDate, endIsoDate, fallbackYear, todayDate) => {
  const startDate = toDateFromIso(startIsoDate);
  const endDate = toDateFromIso(endIsoDate);

  if (startDate && endDate) {
    const total = endDate.getTime() - startDate.getTime();
    if (total <= 0) {
      return todayDate.getTime() >= endDate.getTime() ? 1 : 0;
    }

    const elapsed = todayDate.getTime() - startDate.getTime();
    return clamp(elapsed / total, 0, 1);
  }

  if (fallbackYear) {
    const yearStart = new Date(`${fallbackYear}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${fallbackYear}-12-31T23:59:59.999Z`);

    if (todayDate.getTime() <= yearStart.getTime()) return 0;
    if (todayDate.getTime() >= yearEnd.getTime()) return 1;

    const elapsed = todayDate.getTime() - yearStart.getTime();
    const total = yearEnd.getTime() - yearStart.getTime();
    return clamp(elapsed / total, 0, 1);
  }

  return 0;
};

const buildPaceStatus = (actualRatio, expectedRatio) => {
  if (!Number.isFinite(expectedRatio) || expectedRatio <= 0) {
    return "not_started";
  }

  if (actualRatio >= expectedRatio + 0.08) return "ahead";
  if (actualRatio >= expectedRatio - 0.05) return "on_track";
  return "behind";
};

const buildEventRows = ({
  scopedEvents,
  linksByEventKey,
  todayIsoDate,
  todayDate,
  upcomingWindowDays
}) => {
  const soonCutoffDate = new Date(
    todayDate.getTime() + upcomingWindowDays * DAY_MS
  );

  return scopedEvents.map((eventRecord) => {
    const eventLinks = linksByEventKey.get(eventRecord.eventIdYear) || [];

    let relationshipCount = 0;
    let confirmedCount = 0;
    let paidCount = 0;
    let committedAmount = 0;
    let securedAmount = 0;
    let upcomingFollowUps = 0;
    let overdueFollowUps = 0;
    let lastActivityAt = eventRecord.updatedAt || 0;

    for (const link of eventLinks) {
      relationshipCount += 1;

      const status = normalizeStoredStatus(link.status);
      if (status === "confirmed") confirmedCount += 1;
      if (status === "paid") paidCount += 1;

      const amount = toFiniteAmount(link.amount);
      committedAmount += amount;
      if (SECURED_STATUSES.has(status)) {
        securedAmount += amount;
      }

      const followUpIso = toIsoDate(link.followUpDate);
      if (followUpIso) {
        if (followUpIso < todayIsoDate) {
          overdueFollowUps += 1;
        } else {
          const followUpDate = toDateFromIso(followUpIso);
          if (
            followUpDate &&
            followUpDate.getTime() <= soonCutoffDate.getTime()
          ) {
            upcomingFollowUps += 1;
          }
        }
      }

      const touchedAt = Number(link.updatedAt) || Number(link.createdAt) || 0;
      if (touchedAt > lastActivityAt) {
        lastActivityAt = touchedAt;
      }
    }

    const goalAmount = toFiniteAmount(eventRecord.sponsorshipGoal);
    const hasGoal = goalAmount > 0;
    const remainingToGoal = hasGoal ? Math.max(goalAmount - securedAmount, 0) : 0;
    const pipelineAmount = Math.max(committedAmount - securedAmount, 0);

    const progressRatio = hasGoal ? securedAmount / goalAmount : 0;
    const targetRatio = resolveProgressRatio(
      eventRecord.outreachStartDate || eventRecord.startDate,
      eventRecord.endDate,
      eventRecord.year,
      todayDate
    );
    const expectedSecuredByNow = hasGoal ? goalAmount * targetRatio : 0;
    const paceDelta = hasGoal ? securedAmount - expectedSecuredByNow : 0;
    const onTrack = hasGoal ? progressRatio + 0.05 >= targetRatio : null;
    const paceStatus = hasGoal
      ? buildPaceStatus(progressRatio, targetRatio)
      : "no_goal";

    return {
      eventId: eventRecord.id,
      eventIdYear: eventRecord.eventIdYear,
      eventName: eventRecord.name || "Untitled Event",
      eventYear: eventRecord.year,
      archived: Boolean(eventRecord.archived),
      goalAmount: hasGoal ? goalAmount : 0,
      hasGoal,
      committedAmount,
      securedAmount,
      pipelineAmount,
      remainingToGoal,
      progressToGoalPct: hasGoal ? toPercent(progressRatio) : null,
      expectedProgressPct: hasGoal ? toPercent(targetRatio) : null,
      expectedSecuredByNow: hasGoal ? expectedSecuredByNow : null,
      paceDelta: hasGoal ? paceDelta : null,
      onTrack,
      paceStatus,
      relationshipCount,
      confirmedCount,
      paidCount,
      upcomingFollowUps,
      overdueFollowUps,
      lastActivityAt
    };
  });
};

const buildPipeline = (links) => {
  const statusOrder = [];
  const seen = new Set();

  for (const status of PARTNERSHIP_STATUSES) {
    if (seen.has(status)) continue;
    seen.add(status);
    statusOrder.push(status);
  }

  for (const link of links || []) {
    const status = normalizeStoredStatus(link.status);
    if (seen.has(status)) continue;
    seen.add(status);
    statusOrder.push(status);
  }

  const breakdown = new Map();
  for (const status of statusOrder) {
    breakdown.set(status, {
      status,
      label: toStatusLabel(status),
      count: 0,
      amount: 0,
      isSecured: SECURED_STATUSES.has(status)
    });
  }

  for (const link of links || []) {
    const status = normalizeStoredStatus(link.status);
    if (!breakdown.has(status)) {
      breakdown.set(status, {
        status,
        label: toStatusLabel(status),
        count: 0,
        amount: 0,
        isSecured: SECURED_STATUSES.has(status)
      });
    }

    const entry = breakdown.get(status);
    entry.count += 1;
    entry.amount += toFiniteAmount(link.amount);
  }

  const rows = Array.from(breakdown.values())
    .filter((row) => row.count > 0 || row.amount > 0)
    .sort((left, right) => {
      if (right.amount !== left.amount) return right.amount - left.amount;
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });

  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const securedAmount = rows.reduce(
    (sum, row) => sum + (row.isSecured ? row.amount : 0),
    0
  );

  return {
    totalCount,
    totalAmount,
    securedAmount,
    byStatus: rows.map((row) => ({
      ...row,
      shareByCountPct: totalCount > 0 ? toPercent(row.count / totalCount) : 0,
      shareByAmountPct: totalAmount > 0 ? toPercent(row.amount / totalAmount) : 0
    }))
  };
};

const buildActionItems = ({
  links,
  communications,
  eventsById,
  eventsByIdYear,
  partnersById,
  todayDate,
  upcomingWindowDays,
  actionLimit
}) => {
  const upcomingCutoffDate = new Date(
    todayDate.getTime() + upcomingWindowDays * DAY_MS
  );

  const actions = [];

  for (const link of links || []) {
    const partner = partnersById.get(link.partnerId) || null;
    const eventRecord =
      eventsById.get(link.eventId) || eventsByIdYear.get(link.eventIdYear) || null;
    const followUpIsoDate = toIsoDate(link.followUpDate);
    const status = normalizeStoredStatus(link.status);
    const statusLabel = toStatusLabel(status);
    const partnerName = normalizeText(partner?.contactName, 120) || "Unknown contact";
    const companyName = normalizeText(partner?.company, 140) || "Unknown company";
    const eventName =
      normalizeText(eventRecord?.name, 140) ||
      normalizeText(link.eventName, 140) ||
      "Unknown event";

    if (followUpIsoDate) {
      const dueDate = toDateFromIso(followUpIsoDate);
      if (!dueDate) continue;

      const daysUntilDue = toDaysUntil(todayDate, dueDate);
      if (daysUntilDue === null || dueDate.getTime() > upcomingCutoffDate.getTime()) {
        continue;
      }

      const isOverdue = daysUntilDue < 0;
      const priority = isOverdue ? 0 : daysUntilDue <= 2 ? 1 : daysUntilDue <= 7 ? 2 : 3;

      actions.push({
        id: `link-follow-up-${link.id}`,
        source: "partner_link",
        sourceId: link.id,
        type: "follow_up",
        priority,
        isOverdue,
        dueDate: followUpIsoDate,
        daysUntilDue,
        title: `${companyName} (${partnerName})`,
        description: `${eventName} • ${statusLabel}`,
        partnerId: link.partnerId || null,
        partnerName,
        companyName,
        eventId: link.eventId || null,
        eventIdYear: link.eventIdYear || null,
        eventName,
        eventYear: eventRecord?.year || link.eventYear || null,
        status,
        statusLabel,
        amount: toFiniteAmount(link.amount),
        updatedAt: Number(link.updatedAt) || Number(link.createdAt) || 0
      });
      continue;
    }

    if (!STALE_PIPELINE_STATUSES.has(status) || CLOSED_STATUSES.has(status)) {
      continue;
    }

    const touchedAt = Number(link.updatedAt) || Number(link.createdAt) || 0;
    if (!touchedAt) continue;

    const staleDays = Math.floor((todayDate.getTime() - touchedAt) / DAY_MS);
    if (staleDays < 14) continue;

    actions.push({
      id: `link-stale-${link.id}`,
      source: "partner_link",
      sourceId: link.id,
      type: "stale_pipeline",
      priority: staleDays >= 30 ? 1 : 2,
      isOverdue: staleDays >= 30,
      dueDate: null,
      daysUntilDue: null,
      title: `${companyName} (${partnerName})`,
      description: `${eventName} • ${statusLabel} • No follow-up set for ${staleDays} days`,
      partnerId: link.partnerId || null,
      partnerName,
      companyName,
      eventId: link.eventId || null,
      eventIdYear: link.eventIdYear || null,
      eventName,
      eventYear: eventRecord?.year || link.eventYear || null,
      status,
      statusLabel,
      amount: toFiniteAmount(link.amount),
      staleDays,
      updatedAt: touchedAt
    });
  }

  for (const communication of communications || []) {
    const followUpIsoDate = toIsoDate(communication.followUpDate);
    if (!followUpIsoDate) continue;

    const dueDate = toDateFromIso(followUpIsoDate);
    if (!dueDate || dueDate.getTime() > upcomingCutoffDate.getTime()) continue;

    const daysUntilDue = toDaysUntil(todayDate, dueDate);
    if (daysUntilDue === null) continue;

    const partner = partnersById.get(communication.partnerId) || null;
    const eventRecord =
      eventsById.get(communication.eventId) ||
      eventsByIdYear.get(communication.eventIdYear) ||
      null;

    const partnerName = normalizeText(partner?.contactName, 120) || "Unknown contact";
    const companyName = normalizeText(partner?.company, 140) || "Unknown company";
    const subject = normalizeText(communication.subject, 180) || "Follow-up needed";
    const eventName =
      normalizeText(eventRecord?.name, 140) ||
      normalizeText(communication.eventName, 140) ||
      "General";

    actions.push({
      id: `comm-follow-up-${communication.id}`,
      source: "communication",
      sourceId: communication.id,
      type: "communication_follow_up",
      priority: daysUntilDue < 0 ? 0 : daysUntilDue <= 2 ? 1 : 2,
      isOverdue: daysUntilDue < 0,
      dueDate: followUpIsoDate,
      daysUntilDue,
      title: `${companyName} (${partnerName})`,
      description: `${subject}${eventName ? ` • ${eventName}` : ""}`,
      partnerId: communication.partnerId || null,
      partnerName,
      companyName,
      eventId: communication.eventId || null,
      eventIdYear: communication.eventIdYear || null,
      eventName,
      eventYear: eventRecord?.year || communication.eventYear || null,
      status: null,
      statusLabel: null,
      amount: null,
      updatedAt:
        Number(communication.updatedAt) || Number(communication.createdAt) || 0
    });
  }

  return actions
    .sort((left, right) => {
      if (left.isOverdue !== right.isOverdue) {
        return left.isOverdue ? -1 : 1;
      }

      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
        return left.dueDate.localeCompare(right.dueDate);
      }

      if (left.dueDate && !right.dueDate) return -1;
      if (!left.dueDate && right.dueDate) return 1;

      return (right.updatedAt || 0) - (left.updatedAt || 0);
    })
    .slice(0, actionLimit);
};

export const buildDashboardReport = ({
  partners = [],
  links = [],
  events = [],
  communications = [],
  query = {}
}) => {
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const todayDate = toDateFromIso(todayIsoDate);

  const includeArchived = parseBoolean(query.includeArchived) === true;
  const requestedYear = parseYear(query.year);
  const requestedEventId = normalizeText(query.eventId, 120);
  const upcomingWindowDays = parsePositiveInt(
    query.upcomingWindowDays,
    DEFAULT_UPCOMING_WINDOW_DAYS,
    7,
    90
  );
  const actionLimit = parsePositiveInt(
    query.actionLimit,
    DEFAULT_ACTION_LIMIT,
    10,
    200
  );

  const normalizedEvents = (events || []).map(normalizeEventRecord);
  const eventsById = new Map();
  const eventsByIdYear = new Map();
  for (const eventRecord of normalizedEvents) {
    if (eventRecord.id) {
      eventsById.set(eventRecord.id, eventRecord);
    }
    if (eventRecord.eventIdYear) {
      eventsByIdYear.set(eventRecord.eventIdYear, eventRecord);
    }
  }

  const nonArchivedEvents = normalizedEvents.filter(
    (eventRecord) => includeArchived || !eventRecord.archived
  );

  const availableYears = Array.from(
    new Set(nonArchivedEvents.map((eventRecord) => eventRecord.year).filter(Boolean))
  ).sort((left, right) => Number(right) - Number(left));

  const selectedYear =
    requestedYear ||
    (requestedEventId
      ? nonArchivedEvents.find((eventRecord) => eventRecord.id === requestedEventId)
        ?.year || null
      : availableYears[0] || null);

  const scopedEvents = nonArchivedEvents
    .filter((eventRecord) => {
      if (requestedYear && eventRecord.year !== requestedYear) return false;
      if (requestedEventId && eventRecord.id !== requestedEventId) return false;
      return true;
    })
    .sort(eventSorter);

  const scopedEventIdYears = new Set(scopedEvents.map((event) => event.eventIdYear));

  const scopedLinks = (links || []).filter((link) => {
    const linkedEvent =
      eventsById.get(link.eventId) || eventsByIdYear.get(link.eventIdYear) || null;

    if (linkedEvent && !includeArchived && linkedEvent.archived) return false;

    if (requestedEventId && String(link.eventId || "") !== requestedEventId) {
      return false;
    }

    if (requestedYear) {
      const linkYear = linkedEvent?.year || Number(link.eventYear) || null;
      if (linkYear !== requestedYear) return false;
    }

    if (scopedEvents.length && scopedEventIdYears.size > 0) {
      const key =
        String(link.eventIdYear || "") ||
        (link.eventId && link.eventYear
          ? toEventIdYear(link.eventId, Number(link.eventYear))
          : "");
      if (key && !scopedEventIdYears.has(key)) {
        return false;
      }
    }

    return true;
  });

  const annualLinks = (links || []).filter((link) => {
    const linkedEvent =
      eventsById.get(link.eventId) || eventsByIdYear.get(link.eventIdYear) || null;

    if (linkedEvent && !includeArchived && linkedEvent.archived) return false;
    if (selectedYear === null) return true;

    const linkYear = linkedEvent?.year || Number(link.eventYear) || null;
    return Number(linkYear) === Number(selectedYear);
  });

  const scopedCommunications = (communications || []).filter((communication) => {
    const linkedEvent =
      eventsById.get(communication.eventId) ||
      eventsByIdYear.get(communication.eventIdYear) ||
      null;

    if (linkedEvent && !includeArchived && linkedEvent.archived) return false;

    if (requestedEventId) {
      if (String(communication.eventId || "") !== requestedEventId) return false;
    }

    if (requestedYear) {
      const communicationYear =
        linkedEvent?.year || Number(communication.eventYear) || null;
      if (communicationYear !== requestedYear) return false;
    }

    return true;
  });

  const linksByEventKey = new Map();
  for (const link of scopedLinks) {
    const key =
      String(link.eventIdYear || "") ||
      (link.eventId && link.eventYear
        ? toEventIdYear(link.eventId, Number(link.eventYear))
        : "");
    if (!key) continue;

    if (!linksByEventKey.has(key)) {
      linksByEventKey.set(key, []);
    }
    linksByEventKey.get(key).push(link);
  }

  const annualLinksByEventKey = new Map();
  for (const link of annualLinks) {
    const key =
      String(link.eventIdYear || "") ||
      (link.eventId && link.eventYear
        ? toEventIdYear(link.eventId, Number(link.eventYear))
        : "");
    if (!key) continue;

    if (!annualLinksByEventKey.has(key)) {
      annualLinksByEventKey.set(key, []);
    }
    annualLinksByEventKey.get(key).push(link);
  }

  const eventRows = buildEventRows({
    scopedEvents,
    linksByEventKey,
    todayIsoDate,
    todayDate,
    upcomingWindowDays
  });

  const annualRows =
    selectedYear !== null
      ? nonArchivedEvents
        .filter((eventRecord) => Number(eventRecord.year) === Number(selectedYear))
        .map((eventRecord) => {
          const linked = annualLinksByEventKey.get(eventRecord.eventIdYear) || [];
          let committedAmount = 0;
          let securedAmount = 0;
          for (const link of linked) {
            const amount = toFiniteAmount(link.amount);
            committedAmount += amount;
            if (SECURED_STATUSES.has(normalizeStoredStatus(link.status))) {
              securedAmount += amount;
            }
          }
          return {
            goalAmount: toFiniteAmount(eventRecord.sponsorshipGoal),
            committedAmount,
            securedAmount
          };
        })
      : [];

  const annualGoalAmount = annualRows.reduce((sum, row) => sum + row.goalAmount, 0);
  const annualCommittedAmount = annualRows.reduce(
    (sum, row) => sum + row.committedAmount,
    0
  );
  const annualSecuredAmount = annualRows.reduce(
    (sum, row) => sum + row.securedAmount,
    0
  );
  const annualPipelineAmount = Math.max(annualCommittedAmount - annualSecuredAmount, 0);
  const annualProgressRatio =
    annualGoalAmount > 0 ? annualSecuredAmount / annualGoalAmount : 0;
  const annualExpectedRatio = selectedYear
    ? resolveProgressRatio(null, null, selectedYear, todayDate)
    : 0;
  const annualExpectedSecured = annualGoalAmount * annualExpectedRatio;
  const annualRemainingToGoal =
    annualGoalAmount > 0 ? Math.max(annualGoalAmount - annualSecuredAmount, 0) : 0;

  const pipeline = buildPipeline(scopedLinks);
  const partnersById = new Map();
  for (const partner of partners || []) {
    if (partner?.id) {
      partnersById.set(partner.id, partner);
    }
  }

  const actionItems = buildActionItems({
    links: scopedLinks,
    communications: scopedCommunications,
    eventsById,
    eventsByIdYear,
    partnersById,
    todayDate,
    upcomingWindowDays,
    actionLimit
  });

  const partnerIdsInScope = new Set(scopedLinks.map((link) => link.partnerId));
  const securedRelationshipCount = scopedLinks.filter((link) =>
    SECURED_STATUSES.has(normalizeStoredStatus(link.status))
  ).length;
  const overdueFollowUps = actionItems.filter((item) => item.isOverdue).length;
  const upcomingFollowUps = actionItems.filter(
    (item) => item.dueDate && !item.isOverdue
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      selectedYear: selectedYear || null,
      requestedYear: requestedYear || null,
      requestedEventId: requestedEventId || null,
      includeArchived,
      upcomingWindowDays,
      actionLimit,
      availableYears,
      scopedEventCount: scopedEvents.length
    },
    totals: {
      partnerCount: (partners || []).length,
      activePartnerCount: (partners || []).filter((partner) => !partner.archived).length,
      archivedPartnerCount: (partners || []).filter((partner) => partner.archived).length,
      partnersInScope: partnerIdsInScope.size,
      relationshipCount: scopedLinks.length,
      securedRelationshipCount,
      pipelineAmount: pipeline.totalAmount,
      securedAmount: pipeline.securedAmount,
      upcomingFollowUps,
      overdueFollowUps,
      actionItemCount: actionItems.length
    },
    annual: {
      year: selectedYear || null,
      goalAmount: annualGoalAmount,
      committedAmount: annualCommittedAmount,
      securedAmount: annualSecuredAmount,
      pipelineAmount: annualPipelineAmount,
      remainingToGoal: annualRemainingToGoal,
      progressToGoalPct: annualGoalAmount > 0 ? toPercent(annualProgressRatio) : null,
      expectedProgressPct: annualGoalAmount > 0 ? toPercent(annualExpectedRatio) : null,
      expectedSecuredByNow: annualGoalAmount > 0 ? annualExpectedSecured : null,
      paceDelta: annualGoalAmount > 0 ? annualSecuredAmount - annualExpectedSecured : null,
      onTrack:
        annualGoalAmount > 0 ? annualProgressRatio + 0.05 >= annualExpectedRatio : null
    },
    pipeline,
    revenueByEvent: eventRows,
    actionItems
  };
};
