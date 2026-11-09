import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { requestAttendancePage } from "../features/target-page/pagination-adapter";
import { TargetPageInspectionError } from "../features/target-page/inspect-page";

const fixture = readFileSync(resolve("tests/fixtures/attendance-detail.html"), "utf8");
const targetUrl =
  "https://ncpc.ibuy.ccb.com:9092/member/techworkload/queryMonWorkLoadAttendanceDetails.htm";

function fixtureDocument(): Document {
  return new DOMParser().parseFromString(fixture, "text/html");
}

describe("requestAttendancePage", () => {
  it("clicks an existing numbered page control", () => {
    const documentRef = fixtureDocument();
    const pageTwo = documentRef.querySelector<HTMLAnchorElement>(
      '.ebs-pager a.page[page="2"]:not([aria-label="Next"])',
    );
    const click = vi.spyOn(pageTwo!, "click");

    requestAttendancePage(targetUrl, documentRef, 2);

    expect(click).toHaveBeenCalledOnce();
  });

  it("uses the rendered page input and button when the target page is not in the pager window", () => {
    const documentRef = fixtureDocument();
    const input = documentRef.querySelector<HTMLInputElement>("#pgnIpt")!;
    const go = documentRef.querySelector<HTMLButtonElement>("#pageGo")!;
    const click = vi.spyOn(go, "click");

    requestAttendancePage(targetUrl, documentRef, 15);

    expect(input.value).toBe("15");
    expect(click).toHaveBeenCalledOnce();
  });

  it("stops when no page control exists", () => {
    const documentRef = fixtureDocument();
    documentRef.querySelector("#pgnIpt")?.remove();
    documentRef.querySelector("#pageGo")?.remove();

    expect(() => requestAttendancePage(targetUrl, documentRef, 15)).toThrowError(
      TargetPageInspectionError,
    );
  });
});
