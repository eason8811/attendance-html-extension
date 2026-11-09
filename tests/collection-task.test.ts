import { describe, expect, it, vi } from "vitest";
import type { AttendanceTaskDirectory } from "../features/filesystem/directory-access";
import type {
  AttendancePageDriver,
  CapturedAttendancePage,
} from "../features/collection/collection-task";
import { runAttendanceCollection } from "../features/collection/collection-task";
import type { AttendancePageInfo } from "../features/target-page/inspect-page";

function pageInfo(page: number, totalPages: number): AttendancePageInfo {
  return {
    title: "考勤明细",
    totalRecords: totalPages * 50,
    totalPages,
    currentPage: page,
    pageSize: 50,
    activePage: page,
    rowCount: page === totalPages ? 17 : 50,
    tableSignature: `signature-${page}`,
    headers: ["序号", "员工编号", "考勤日期"],
  };
}

function createDirectory(options: {
  writes?: number[];
  failPage?: number;
} = {}): AttendanceTaskDirectory {
  return {
    name: "attendance-test-task",
    async writePage(page) {
      options.writes?.push(page);
      if (options.failPage === page) throw new Error("模拟磁盘写入失败");
      return { fileName: `page-${String(page).padStart(3, "0")}.html`, bytes: 1 };
    },
  };
}

function createDriver(
  options: {
    totalPages: number;
    startPage?: number;
    actions?: string[];
    onRequestPage?(page: number): void;
  },
): AttendancePageDriver {
  let currentPage = options.startPage ?? 1;
  return {
    async inspect() {
      options.actions?.push(`inspect:${currentPage}`);
      return pageInfo(currentPage, options.totalPages);
    },
    async requestPage(page) {
      options.actions?.push(`request:${page}`);
      options.onRequestPage?.(page);
      currentPage = page;
    },
    async waitForPage(page) {
      options.actions?.push(`wait:${page}`);
      currentPage = page;
      return pageInfo(page, options.totalPages);
    },
    async capturePage(page): Promise<CapturedAttendancePage> {
      options.actions?.push(`capture:${page}`);
      currentPage = page;
      return { page: pageInfo(page, options.totalPages), html: `<!DOCTYPE html><p>page ${page}</p>` };
    },
  };
}

describe("runAttendanceCollection", () => {
  it("saves a one-page task and completes only after the write resolves", async () => {
    const writes: number[] = [];
    const states: string[] = [];
    const result = await runAttendanceCollection({
      driver: createDriver({ totalPages: 1 }),
      createTaskDirectory: async () => createDirectory({ writes }),
      onState: (state) => states.push(state.phase),
    });

    expect(writes).toEqual([1]);
    expect(result).toMatchObject({ phase: "completed", totalPages: 1, savedPages: 1, failedPages: 0 });
    expect(states).toContain("preparing");
    expect(states.at(-1)).toBe("completed");
  });

  it("captures three pages in order and confirms each next page before saving it", async () => {
    const actions: string[] = [];
    const writes: number[] = [];
    const result = await runAttendanceCollection({
      driver: createDriver({ totalPages: 3, actions }),
      createTaskDirectory: async () => createDirectory({ writes }),
    });

    expect(writes).toEqual([1, 2, 3]);
    expect(actions).toEqual([
      "inspect:1",
      "wait:1",
      "capture:1",
      "request:2",
      "wait:2",
      "capture:2",
      "request:3",
      "wait:3",
      "capture:3",
    ]);
    expect(result).toMatchObject({ phase: "completed", savedPages: 3, failedPages: 0 });
  });

  it("returns to page one before creating a task when initially on a later page", async () => {
    const actions: string[] = [];
    const writes: number[] = [];
    const result = await runAttendanceCollection({
      driver: createDriver({ totalPages: 5, startPage: 4, actions }),
      createTaskDirectory: async () => createDirectory({ writes }),
    });

    expect(actions.slice(0, 3)).toEqual(["inspect:4", "request:1", "wait:1"]);
    expect(writes).toEqual([1, 2, 3, 4, 5]);
    expect(result).toMatchObject({ phase: "completed", totalPages: 5, savedPages: 5 });
  });

  it("counts only closed page writes and preserves prior pages after an IO failure", async () => {
    const writes: number[] = [];
    const result = await runAttendanceCollection({
      driver: createDriver({ totalPages: 3 }),
      createTaskDirectory: async () => createDirectory({ writes, failPage: 2 }),
    });

    expect(writes).toEqual([1, 2]);
    expect(result).toMatchObject({ phase: "failed", savedPages: 1, failedPages: 1 });
    expect(result.message).toContain("模拟磁盘写入失败");
  });

  it("cancels before requesting another page and keeps completed files", async () => {
    const controller = new AbortController();
    const writes: number[] = [];
    const capture = vi.fn();
    const driver = createDriver({
      totalPages: 3,
      onRequestPage: () => controller.abort(),
    });
    driver.capturePage = async (page) => {
      capture(page);
      return { page: pageInfo(page, 3), html: "<html></html>" };
    };
    const result = await runAttendanceCollection({
      driver,
      createTaskDirectory: async () => createDirectory({ writes }),
      signal: controller.signal,
    });

    expect(writes).toEqual([1]);
    expect(capture).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ phase: "cancelled", savedPages: 1, failedPages: 0 });
  });

  it("completes a simulated 23-page run without gaps or duplicate writes", async () => {
    const writes: number[] = [];
    const result = await runAttendanceCollection({
      driver: createDriver({ totalPages: 23 }),
      createTaskDirectory: async () => createDirectory({ writes }),
    });

    expect(writes).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
    expect(result).toMatchObject({ phase: "completed", totalPages: 23, savedPages: 23 });
  });
});
