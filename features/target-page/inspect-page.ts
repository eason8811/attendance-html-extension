import { isTargetAttendanceUrl } from "./target-config";

const REQUIRED_HEADERS = ["序号", "员工编号", "考勤日期"] as const;

export type TargetPageErrorCode =
  | "URL_MISMATCH"
  | "TITLE_MISMATCH"
  | "FORM_MISSING"
  | "TABLE_MISSING"
  | "TABLE_HEADERS_MISSING"
  | "PAGINATION_MISSING"
  | "PAGINATION_SUMMARY_INVALID"
  | "PAGE_SIZE_MISSING"
  | "ACTIVE_PAGE_MISSING"
  | "PAGE_NUMBER_MISMATCH"
  | "TABLE_NOT_CHANGED"
  | "PAGINATION_CONTROL_MISSING"
  | "PAGE_NOT_READY"
  | "CANCELLED";

export class TargetPageInspectionError extends Error {
  constructor(
    readonly code: TargetPageErrorCode,
    message: string,
    readonly causeCode?: TargetPageErrorCode,
  ) {
    super(message);
    this.name = "TargetPageInspectionError";
  }
}

export interface AttendancePageInfo {
  title: string;
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  activePage: number;
  rowCount: number;
  tableSignature: string;
  headers: string[];
}

export function inspectAttendancePage(
  input: string | URL,
  documentRef: Document,
): AttendancePageInfo {
  if (!isTargetAttendanceUrl(input)) {
    throw new TargetPageInspectionError(
      "URL_MISMATCH",
      "当前标签页的地址与目标考勤明细页面不匹配。",
    );
  }

  const title = normalizeText(documentRef.title);
  if (!title.includes("考勤明细")) {
    throw new TargetPageInspectionError("TITLE_MISMATCH", "页面标题不符合考勤明细页面特征。");
  }

  if (!documentRef.querySelector("form#frm")) {
    throw new TargetPageInspectionError("FORM_MISSING", "页面缺少业务表单 form#frm。");
  }

  const table = documentRef.querySelector<HTMLTableElement>(
    ".ebs-table .table-container table",
  );
  if (!table) {
    throw new TargetPageInspectionError("TABLE_MISSING", "考勤业务表格尚未出现。");
  }

  const headers = Array.from(table.querySelectorAll("thead th"), (cell) =>
    normalizeText(cell.textContent ?? ""),
  );
  const missingHeaders = REQUIRED_HEADERS.filter((required) => !headers.includes(required));
  if (missingHeaders.length > 0) {
    throw new TargetPageInspectionError(
      "TABLE_HEADERS_MISSING",
      `表格缺少必要表头：${missingHeaders.join("、")}。`,
    );
  }

  const pagination = documentRef.querySelector(".table-pagination");
  const summaryElement = pagination?.querySelector(".left-pagination-info");
  if (!pagination || !summaryElement) {
    throw new TargetPageInspectionError("PAGINATION_MISSING", "页面分页摘要或分页容器尚未出现。");
  }

  const summary = normalizeText(summaryElement.textContent ?? "");
  const totalRecords = parseSummaryNumber(summary, /共\s*([\d,，]+)\s*条/);
  const totalPages = parseSummaryNumber(summary, /共\s*(\d+)\s*页/);
  const currentPage = parseSummaryNumber(summary, /当前第\s*(\d+)\s*页/);
  if (
    totalRecords === null ||
    totalPages === null ||
    currentPage === null ||
    totalPages < 1 ||
    currentPage < 1 ||
    currentPage > totalPages
  ) {
    throw new TargetPageInspectionError(
      "PAGINATION_SUMMARY_INVALID",
      "分页摘要无法解析总记录数、总页数或当前页。",
    );
  }

  const pageSize = readSelectedPageSize(documentRef);
  if (pageSize === null || pageSize < 1) {
    throw new TargetPageInspectionError("PAGE_SIZE_MISSING", "无法从分页控件读取有效的每页条数。");
  }

  const activePageElement = pagination.querySelector<HTMLElement>(
    ".ebs-pager li.active a.page[page]",
  );
  const activePage = parsePositiveInteger(activePageElement?.getAttribute("page") ?? null);
  if (activePage === null) {
    throw new TargetPageInspectionError("ACTIVE_PAGE_MISSING", "分页控件没有标记当前激活页码。");
  }
  if (activePage !== currentPage) {
    throw new TargetPageInspectionError(
      "PAGE_NUMBER_MISMATCH",
      "分页摘要与当前激活页码不一致，已停止读取。",
    );
  }

  const rows = table.querySelectorAll("tbody tr");
  const tableSignature = signatureOf(table.querySelector("tbody")?.textContent ?? "");

  return {
    title,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    activePage,
    rowCount: rows.length,
    tableSignature: `${rows.length}:${tableSignature}`,
    headers,
  };
}

export function waitForAttendancePage(
  input: string | URL,
  documentRef: Document,
  options: {
    timeoutMs?: number;
    stableMs?: number;
    expectedPage?: number;
    previousTableSignature?: string;
    signal?: AbortSignal;
  } = {},
): Promise<AttendancePageInfo> {
  const { timeoutMs = 5_000, stableMs = 0, expectedPage, previousTableSignature, signal } = options;
  if (signal?.aborted) {
    return Promise.reject(new TargetPageInspectionError("CANCELLED", "页面检查已取消。"));
  }

  return new Promise((resolve, reject) => {
    let lastError: TargetPageInspectionError | null = null;
    let candidateSignature: string | null = null;
    let candidateSince = 0;
    let settled = false;
    let stabilityTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      candidateSignature = null;
      candidateSince = 0;
      if (stabilityTimer !== undefined) clearTimeout(stabilityTimer);
      stabilityTimer = undefined;
      checkPage();
    });
    const timeout = setTimeout(() => {
      finish(
        new TargetPageInspectionError(
          "PAGE_NOT_READY",
          `等待页面结构或页码稳定超时${lastError ? `（${lastError.code}）` : ""}。`,
          lastError?.code,
        ),
      );
    }, Math.max(0, timeoutMs));

    function cleanup() {
      observer.disconnect();
      clearTimeout(timeout);
      if (stabilityTimer !== undefined) clearTimeout(stabilityTimer);
      signal?.removeEventListener("abort", onAbort);
    }

    function finish(result: AttendancePageInfo | TargetPageInspectionError) {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof TargetPageInspectionError) reject(result);
      else resolve(result);
    }

    function onAbort() {
      finish(new TargetPageInspectionError("CANCELLED", "页面检查已取消。"));
    }

    function checkPage() {
      if (settled) return;
      let page: AttendancePageInfo;
      try {
        page = inspectAttendancePage(input, documentRef);
      } catch (nextError) {
        candidateSignature = null;
        candidateSince = 0;
        if (stabilityTimer !== undefined) clearTimeout(stabilityTimer);
        stabilityTimer = undefined;
        if (nextError instanceof TargetPageInspectionError) {
          if (nextError.code === "URL_MISMATCH") finish(nextError);
          else lastError = nextError;
        } else {
          finish(new TargetPageInspectionError("PAGE_NOT_READY", "页面检查失败。"));
        }
        return;
      }

      if (expectedPage !== undefined && page.currentPage !== expectedPage) {
        candidateSignature = null;
        candidateSince = 0;
        if (stabilityTimer !== undefined) clearTimeout(stabilityTimer);
        stabilityTimer = undefined;
        lastError = new TargetPageInspectionError(
          "PAGE_NUMBER_MISMATCH",
          `等待第 ${expectedPage} 页，当前页面报告第 ${page.currentPage} 页。`,
        );
        return;
      }

      if (previousTableSignature && page.tableSignature === previousTableSignature) {
        candidateSignature = null;
        candidateSince = 0;
        if (stabilityTimer !== undefined) clearTimeout(stabilityTimer);
        stabilityTimer = undefined;
        lastError = new TargetPageInspectionError(
          "TABLE_NOT_CHANGED",
          "页码已变化，但表格内容仍与上一页相同。",
        );
        return;
      }

      lastError = null;
      if (page.tableSignature !== candidateSignature) {
        candidateSignature = page.tableSignature;
        candidateSince = Date.now();
        if (stabilityTimer !== undefined) clearTimeout(stabilityTimer);
        if (stableMs <= 0) {
          finish(page);
          return;
        }
        stabilityTimer = setTimeout(() => {
          stabilityTimer = undefined;
          checkPage();
        }, stableMs);
        return;
      }

      if (Date.now() - candidateSince >= stableMs) {
        finish(page);
      } else if (stabilityTimer === undefined) {
        stabilityTimer = setTimeout(() => {
          stabilityTimer = undefined;
          checkPage();
        }, stableMs - (Date.now() - candidateSince));
      }
    }

    observer.observe(documentRef.documentElement ?? documentRef, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    checkPage();
  });
}

function signatureOf(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readSelectedPageSize(documentRef: Document): number | null {
  const select = documentRef.querySelector<HTMLSelectElement>("#ebidding_page_size");
  const option = select?.selectedOptions.item(0);
  if (!option) return null;

  return (
    parsePositiveInteger(option.value) ??
    parsePositiveInteger(option.textContent ?? "")
  );
}

function parseSummaryNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const normalized = match[1].replace(/[，,]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) ? value : null;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d[\d,，]*/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0].replace(/[，,]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
