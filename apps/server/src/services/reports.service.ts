import { and, desc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { reports, users, type Report } from "../db/schema.js";
import { AuthError } from "./auth.service.js";
import { disconnectUser } from "../socket/index.js";
import { saveEvidence } from "./evidenceStorage.js";

const reporter = alias(users, "reporter");
const reportedUser = alias(users, "reported_user");

// Adds reporter/reported display names and the reported user's *current*
// account status for admin review — raw UUIDs alone aren't useful in the UI.
export type AdminReportView = Report & {
  reporterDisplayName: string;
  reportedDisplayName: string;
  reportedAccountStatus: "active" | "suspended" | "banned";
};

function selectAdminReportView() {
  return db
    .select({
      report: reports,
      reporterDisplayName: reporter.displayName,
      reportedDisplayName: reportedUser.displayName,
      reportedAccountStatus: reportedUser.accountStatus,
    })
    .from(reports)
    .innerJoin(reporter, eq(reporter.id, reports.reporterUserId))
    .innerJoin(reportedUser, eq(reportedUser.id, reports.reportedUserId));
}

function toAdminReportView(row: {
  report: Report;
  reporterDisplayName: string;
  reportedDisplayName: string;
  reportedAccountStatus: "active" | "suspended" | "banned";
}): AdminReportView {
  return {
    ...row.report,
    reporterDisplayName: row.reporterDisplayName,
    reportedDisplayName: row.reportedDisplayName,
    reportedAccountStatus: row.reportedAccountStatus,
  };
}

export type ReportReason =
  | "harassment"
  | "sexual_inappropriate"
  | "not_eligible"
  | "fake_profile"
  | "spam_scam"
  | "threatening_unsafe"
  | "other";

export type ReportStatus = "pending" | "under_review" | "resolved" | "dismissed";
export type ReportAction = "none" | "warn" | "suspend" | "ban";

// Prevents obvious spam (e.g. a double-submit or a vindictive repeat-click)
// without blocking someone filing genuinely separate reports later.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export async function createReport(input: {
  reporterUserId: string;
  reportedUserId: string;
  reason: ReportReason;
  description?: string | null;
  matchId?: string | null;
  evidenceBase64?: string | null;
  evidenceMimeType?: string | null;
}): Promise<Report> {
  if (input.reporterUserId === input.reportedUserId) {
    throw new AuthError("You cannot report yourself.", 400);
  }

  const reportedUser = await db.query.users.findFirst({ where: eq(users.id, input.reportedUserId) });
  if (!reportedUser) {
    throw new AuthError("Reported user not found.", 404);
  }

  const recentDuplicate = await db.query.reports.findFirst({
    where: and(
      eq(reports.reporterUserId, input.reporterUserId),
      eq(reports.reportedUserId, input.reportedUserId),
      gt(reports.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS)),
    ),
  });
  if (recentDuplicate) {
    throw new AuthError("You already reported this user — our team will review it.", 429);
  }

  let evidencePath: string | null = null;
  let evidenceMimeType: string | null = null;
  if (input.evidenceBase64) {
    if (!input.evidenceMimeType) {
      throw new AuthError("Evidence upload is missing its file type.", 400);
    }
    evidencePath = await saveEvidence(input.evidenceBase64, input.evidenceMimeType);
    evidenceMimeType = input.evidenceMimeType;
  }

  const [created] = await db
    .insert(reports)
    .values({
      reporterUserId: input.reporterUserId,
      reportedUserId: input.reportedUserId,
      matchId: input.matchId ?? null,
      reason: input.reason,
      description: input.description?.trim() || null,
      evidencePath,
      evidenceMimeType,
    })
    .returning();

  return created;
}

export async function listReports(filter?: { status?: ReportStatus }): Promise<AdminReportView[]> {
  const rows = await selectAdminReportView()
    .where(filter?.status ? eq(reports.status, filter.status) : undefined)
    .orderBy(desc(reports.createdAt));
  return rows.map(toAdminReportView);
}

export async function getReportById(reportId: string): Promise<AdminReportView> {
  const [row] = await selectAdminReportView().where(eq(reports.id, reportId));
  if (!row) {
    throw new AuthError("Report not found.", 404);
  }
  return toAdminReportView(row);
}

export async function getReportEvidencePath(reportId: string): Promise<string> {
  const report = await getReportById(reportId);
  if (!report.evidencePath) {
    throw new AuthError("This report has no evidence attached.", 404);
  }
  return report.evidencePath;
}

export async function updateReportDecision(
  reportId: string,
  input: {
    status: ReportStatus;
    adminAction: ReportAction;
    adminNote?: string | null;
    suspendUntil?: Date | null;
    reviewedBy: string;
  },
): Promise<AdminReportView> {
  const report = await getReportById(reportId);

  await db
    .update(reports)
    .set({
      status: input.status,
      adminAction: input.adminAction,
      adminNote: input.adminNote?.trim() || null,
      reviewedAt: new Date(),
      reviewedBy: input.reviewedBy,
    })
    .where(eq(reports.id, reportId));

  if (input.adminAction === "suspend") {
    await db
      .update(users)
      .set({ accountStatus: "suspended", suspendedUntil: input.suspendUntil ?? null, updatedAt: new Date() })
      .where(eq(users.id, report.reportedUserId));
    disconnectUser(report.reportedUserId);
  } else if (input.adminAction === "ban") {
    await db
      .update(users)
      .set({ accountStatus: "banned", suspendedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, report.reportedUserId));
    disconnectUser(report.reportedUserId);
  }
  // "warn" and "none" intentionally make no account-status change — a
  // report is only an allegation until this decision, and even an upheld
  // "warn" is a recorded note, not an access restriction.

  return getReportById(reportId);
}
