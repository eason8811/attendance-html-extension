import type { AttendanceTaskDirectory } from "@/features/filesystem/directory-access";
import type { AttendancePageInfo } from "@/features/target-page/inspect-page";

export type CollectionPhase =
  | "idle"
  | "validating"
  | "preparing"
  | "capturing"
  | "turning"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface CollectionTaskState {
  phase: CollectionPhase;
  totalPages: number;
  currentPage: number;
  savedPages: number;
  failedPages: number;
  taskDirectoryName: string | null;
  message: string;
}

export interface CapturedAttendancePage {
  page: AttendancePageInfo;
  html: string;
}

export interface AttendancePageDriver {
  inspect(): Promise<AttendancePageInfo>;
  requestPage(page: number): Promise<void>;
  waitForPage(page: number, previousTableSignature?: string): Promise<AttendancePageInfo>;
  capturePage(page: number): Promise<CapturedAttendancePage>;
}

export interface CollectionTaskOptions {
  driver: AttendancePageDriver;
  createTaskDirectory(): Promise<AttendanceTaskDirectory>;
  signal?: AbortSignal;
  onState?(state: CollectionTaskState): void;
}

let activeTask = false;

export async function runAttendanceCollection(
  options: CollectionTaskOptions,
): Promise<CollectionTaskState> {
  if (activeTask) throw new Error("已有采集任务正在运行。 ");
  activeTask = true;

  let state: CollectionTaskState = {
    phase: "validating",
    totalPages: 0,
    currentPage: 0,
    savedPages: 0,
    failedPages: 0,
    taskDirectoryName: null,
    message: "正在重新检查目标页面。",
  };
  let taskDirectory: AttendanceTaskDirectory;
  let pageAttempted = false;

  const publish = (patch: Partial<CollectionTaskState>) => {
    state = { ...state, ...patch };
    options.onState?.(state);
  };
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new CollectionCancelledError();
  };

  try {
    publish({ phase: "validating", message: "正在重新检查目标页面。" });
    checkCancelled();
    const queryBaseline = await options.driver.inspect();
    checkCancelled();
    validatePageInfo(queryBaseline);
    publish({
      totalPages: queryBaseline.totalPages,
      currentPage: queryBaseline.currentPage,
      message: `页面已确认，共 ${queryBaseline.totalPages} 页。`,
    });

    if (queryBaseline.currentPage !== 1) {
      checkCancelled();
      publish({ phase: "turning", message: "正在通过页面控件返回第 1 页。" });
      await options.driver.requestPage(1);
      checkCancelled();
      publish({ phase: "waiting", currentPage: 1, message: "正在确认第 1 页和表格内容。" });
      const firstPageInfo = await options.driver.waitForPage(1, queryBaseline.tableSignature);
      checkCancelled();
      assertPageMatches(firstPageInfo, queryBaseline, 1);
    } else {
      const firstPageInfo = await options.driver.waitForPage(1);
      checkCancelled();
      assertPageMatches(firstPageInfo, queryBaseline, 1);
    }

    checkCancelled();
    publish({ phase: "preparing", currentPage: 1, message: "正在创建本次采集的独立目录。" });
    taskDirectory = await options.createTaskDirectory();
    publish({
      taskDirectoryName: taskDirectory.name,
      message: `保存目录已创建：${taskDirectory.name}`,
    });
    checkCancelled();

    let expectedPage = 1;
    while (expectedPage <= queryBaseline.totalPages) {
      checkCancelled();
      pageAttempted = true;
      publish({
        phase: "capturing",
        currentPage: expectedPage,
        message: `正在读取第 ${expectedPage} / ${queryBaseline.totalPages} 页。`,
      });

      const captured = await options.driver.capturePage(expectedPage);
      checkCancelled();
      assertPageMatches(captured.page, queryBaseline, expectedPage);
      if (!captured.html.trim()) throw new Error(`第 ${expectedPage} 页生成了空 HTML。`);

      publish({ phase: "preparing", message: `正在写入第 ${expectedPage} 页 HTML。` });
      await taskDirectory.writePage(expectedPage, captured.html);
      pageAttempted = false;
      publish({
        phase: "capturing",
        savedPages: state.savedPages + 1,
        currentPage: expectedPage,
        message: `第 ${expectedPage} 页已写入。`,
      });

      if (expectedPage === queryBaseline.totalPages) break;
      checkCancelled();

      const nextPage = expectedPage + 1;
      pageAttempted = true;
      publish({ phase: "turning", currentPage: nextPage, message: `正在请求第 ${nextPage} 页。` });
      await options.driver.requestPage(nextPage);
      checkCancelled();
      publish({ phase: "waiting", message: `正在等待第 ${nextPage} 页表格更新并稳定。` });
      const currentPageInfo = await options.driver.waitForPage(
        nextPage,
        captured.page.tableSignature,
      );
      checkCancelled();
      assertPageMatches(currentPageInfo, queryBaseline, nextPage);
      expectedPage = nextPage;
    }

    return publishAndReturn({
      phase: "completed",
      currentPage: queryBaseline.totalPages,
      failedPages: 0,
      message: `采集完成：${queryBaseline.totalPages} 页已写入 ${taskDirectory.name}。`,
    });
  } catch (error) {
    if (options.signal?.aborted || error instanceof CollectionCancelledError) {
      return publishAndReturn({
        phase: "cancelled",
        failedPages: 0,
        message: `采集已取消，已成功保存 ${state.savedPages} 页。`,
      });
    }
    return publishAndReturn({
      phase: "failed",
      failedPages: pageAttempted ? 1 : 0,
      message: toMessage(error),
    });
  } finally {
    activeTask = false;
  }

  function publishAndReturn(patch: Partial<CollectionTaskState>): CollectionTaskState {
    publish(patch);
    return state;
  }
}

function validatePageInfo(page: AttendancePageInfo): void {
  if (
    !Number.isSafeInteger(page.totalPages) ||
    page.totalPages < 1 ||
    !Number.isSafeInteger(page.currentPage) ||
    page.currentPage < 1 ||
    page.currentPage > page.totalPages ||
    !Number.isSafeInteger(page.pageSize) ||
    page.pageSize < 1 ||
    !Number.isSafeInteger(page.totalRecords) ||
    page.totalRecords < 0
  ) {
    throw new Error("分页信息无效，已停止采集。 ");
  }
}

function assertSameQuery(page: AttendancePageInfo, baseline: AttendancePageInfo): void {
  if (
    page.totalPages !== baseline.totalPages ||
    page.pageSize !== baseline.pageSize ||
    page.totalRecords !== baseline.totalRecords
  ) {
    throw new Error("查询条件或分页信息在采集期间发生变化，已停止采集。 ");
  }
}

function assertPageMatches(
  page: AttendancePageInfo,
  baseline: AttendancePageInfo,
  expectedPage: number,
): void {
  validatePageInfo(page);
  assertSameQuery(page, baseline);
  if (page.currentPage !== expectedPage || page.activePage !== expectedPage) {
    throw new Error(`请求第 ${expectedPage} 页，但页面当前页码不一致，已停止采集。`);
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "采集失败，发生未知错误。";
}

export class CollectionCancelledError extends Error {
  constructor() {
    super("采集任务已取消。");
    this.name = "CollectionCancelledError";
  }
}
