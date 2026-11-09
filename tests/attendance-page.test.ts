import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectAttendancePage,
  TargetPageInspectionError,
  waitForAttendancePage,
} from "../features/target-page/inspect-page";

const fixture = readFileSync(resolve("tests/fixtures/attendance-detail.html"), "utf8");
const targetUrl =
  "https://ncpc.ibuy.ccb.com:9092/member/techworkload/queryMonWorkLoadAttendanceDetails.htm?fixture=masked";

function fixtureDocument(): Document {
  return new DOMParser().parseFromString(fixture, "text/html");
}

function expectPageError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("Expected page inspection to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(TargetPageInspectionError);
    expect(error).toMatchObject({ code });
  }
}

describe("inspectAttendancePage", () => {
  it("parses the sanitized fixture without depending on query values", () => {
    const page = inspectAttendancePage(targetUrl, fixtureDocument());

    expect(page).toMatchObject({
      title: "考勤明细",
      totalRecords: 1143,
      totalPages: 23,
      currentPage: 1,
      pageSize: 50,
      activePage: 1,
      rowCount: 2,
    });
    expect(page.headers).toEqual(["序号", "员工编号", "考勤日期"]);
  });

  it("rejects a different host, port, or pathname", () => {
    for (const url of [
      targetUrl.replace("ncpc.ibuy.ccb.com", "example.com"),
      targetUrl.replace(":9092", ":443"),
      targetUrl.replace("queryMonWorkLoadAttendanceDetails.htm", "another.htm"),
    ]) {
      expectPageError(() => inspectAttendancePage(url, fixtureDocument()), "URL_MISMATCH");
    }
  });

  it("rejects a document without the business form", () => {
    const documentRef = fixtureDocument();
    documentRef.querySelector("form#frm")?.remove();
    expectPageError(() => inspectAttendancePage(targetUrl, documentRef), "FORM_MISSING");
  });

  it("rejects a document without the attendance table", () => {
    const documentRef = fixtureDocument();
    documentRef.querySelector(".ebs-table")?.remove();
    expectPageError(() => inspectAttendancePage(targetUrl, documentRef), "TABLE_MISSING");
  });

  it("rejects tables missing required attendance headers", () => {
    const documentRef = fixtureDocument();
    documentRef.querySelector("thead th:nth-child(2)")?.remove();
    expectPageError(() => inspectAttendancePage(targetUrl, documentRef), "TABLE_HEADERS_MISSING");
  });

  it("rejects missing pagination controls and invalid summaries", () => {
    const missingPagination = fixtureDocument();
    missingPagination.querySelector(".table-pagination")?.remove();
    expectPageError(
      () => inspectAttendancePage(targetUrl, missingPagination),
      "PAGINATION_MISSING",
    );

    const invalidSummary = fixtureDocument();
    const summary = invalidSummary.querySelector(".left-pagination-info");
    if (summary) summary.textContent = "分页信息加载中";
    expectPageError(
      () => inspectAttendancePage(targetUrl, invalidSummary),
      "PAGINATION_SUMMARY_INVALID",
    );
  });

  it("checks page size and verifies the summary against the active page", () => {
    const missingPageSize = fixtureDocument();
    missingPageSize.querySelector("#ebidding_page_size")?.remove();
    expectPageError(
      () => inspectAttendancePage(targetUrl, missingPageSize),
      "PAGE_SIZE_MISSING",
    );

    const mismatchedPage = fixtureDocument();
    mismatchedPage.querySelector(".ebs-pager li.active a.page")?.setAttribute("page", "2");
    expectPageError(
      () => inspectAttendancePage(targetUrl, mismatchedPage),
      "PAGE_NUMBER_MISMATCH",
    );
  });
});

describe("waitForAttendancePage", () => {
  it("returns immediately when the target DOM is already ready", async () => {
    await expect(waitForAttendancePage(targetUrl, fixtureDocument())).resolves.toMatchObject({
      currentPage: 1,
      totalPages: 23,
    });
  });

  it("returns a bounded readiness error when the DOM stays incomplete", async () => {
    const documentRef = new DOMParser().parseFromString("<title>Loading</title>", "text/html");

    await expect(
      waitForAttendancePage(targetUrl, documentRef, { timeoutMs: 10 }),
    ).rejects.toMatchObject({
      code: "PAGE_NOT_READY",
      causeCode: "TITLE_MISMATCH",
    });
  });

  it("waits for the requested page and a stable table signature", async () => {
    await expect(
      waitForAttendancePage(targetUrl, fixtureDocument(), {
        expectedPage: 1,
        stableMs: 5,
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ currentPage: 1, totalPages: 23 });
  });

  it("does not accept an unchanged table after a requested page change", async () => {
    const documentRef = fixtureDocument();
    const previous = inspectAttendancePage(targetUrl, documentRef).tableSignature;
    await expect(
      waitForAttendancePage(targetUrl, documentRef, {
        expectedPage: 1,
        previousTableSignature: previous,
        stableMs: 1,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: "PAGE_NOT_READY", causeCode: "TABLE_NOT_CHANGED" });
  });

  it("honors an already-aborted page wait", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForAttendancePage(targetUrl, fixtureDocument(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
