import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeAttendanceDocument } from "../features/target-page/snapshot";

const fixture = readFileSync(resolve("tests/fixtures/attendance-detail.html"), "utf8");

describe("serializeAttendanceDocument", () => {
  it("preserves the document type and serializes the current document element", () => {
    const documentRef = new DOMParser().parseFromString(fixture, "text/html");
    documentRef.querySelector("tbody tr td:nth-child(2)")!.textContent = "UPDATED-MASKED";

    const snapshot = serializeAttendanceDocument(documentRef);

    expect(snapshot.html.startsWith("<!DOCTYPE html>\n<html")).toBe(true);
    expect(snapshot.html).toContain("UPDATED-MASKED");
  });

  it("serializes public and system identifiers in a doctype", () => {
    const documentRef = new DOMParser().parseFromString("<!DOCTYPE html><title>x</title>", "text/html");
    const doctype = documentRef.implementation.createDocumentType(
      "html",
      "-//W3C//DTD XHTML 1.0 Strict//EN",
      "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd",
    );
    const second = documentRef.implementation.createDocument(null, "html", doctype);

    expect(
      serializeAttendanceDocument(second).html.startsWith(
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
      ),
    ).toBe(true);
  });
});
