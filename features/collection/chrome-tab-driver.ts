import type {
  AttendancePageDriver,
  CapturedAttendancePage,
} from "./collection-task";
import type { TargetPageErrorCode } from "@/features/target-page/inspect-page";
import {
  CAPTURE_ATTENDANCE_PAGE,
  INSPECT_ATTENDANCE_PAGE,
  REQUEST_ATTENDANCE_PAGE,
  WAIT_FOR_ATTENDANCE_PAGE,
  type AttendanceContentResponse,
  type CaptureAttendancePageResponse,
  type InspectAttendancePageResponse,
  type RequestAttendancePageResponse,
  type WaitForAttendancePageResponse,
} from "@/features/target-page/inspection-message";

const PAGE_WAIT_TIMEOUT_MS = 25_000;
const PAGE_CHECK_WINDOW_MS = 1_200;
const PAGE_CHECK_INTERVAL_MS = 250;

export function createChromeTabDriver(tabId: number, signal?: AbortSignal): AttendancePageDriver {
  return {
    async inspect() {
      await assertTabActive(tabId, signal);
      const response = await sendMessage<InspectAttendancePageResponse>(
        tabId,
        { type: INSPECT_ATTENDANCE_PAGE },
        signal,
      );
      return unwrap(response);
    },

    async requestPage(page) {
      await assertTabActive(tabId, signal);
      try {
        const response = await sendMessage<RequestAttendancePageResponse>(
          tabId,
          { type: REQUEST_ATTENDANCE_PAGE, page },
          signal,
        );
        unwrap(response);
      } catch (error) {
        if (signal?.aborted) throw new CollectionCancelledError();
        if (error instanceof PageDriverError) throw error;
        // A full navigation can destroy the content script before it sends an acknowledgement.
        // waitForPage() below confirms whether the click actually took effect.
        await assertTabActive(tabId, signal);
      }
    },

    async waitForPage(page, previousTableSignature) {
      const deadline = Date.now() + PAGE_WAIT_TIMEOUT_MS;
      let lastMessage = "页面内容尚未确认。";
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new CollectionCancelledError();
        await assertTabActive(tabId, signal);
        const remaining = deadline - Date.now();
        try {
          const response = await sendMessage<WaitForAttendancePageResponse>(
            tabId,
            {
              type: WAIT_FOR_ATTENDANCE_PAGE,
              page,
              previousTableSignature,
              timeoutMs: Math.max(1, Math.min(PAGE_CHECK_WINDOW_MS, remaining)),
              stableMs: 400,
            },
            signal,
          );
          if (response.ok) return response.value;
          lastMessage = response.error.message;
          if (response.error.code === "URL_MISMATCH" || response.error.code === "CANCELLED") {
            throw new PageDriverError(response.error.code, response.error.message);
          }
        } catch (error) {
          if (signal?.aborted || error instanceof CollectionCancelledError) {
            throw new CollectionCancelledError();
          }
          if (error instanceof PageDriverError) throw error;
          lastMessage = getMessage(error);
        }
        await delay(PAGE_CHECK_INTERVAL_MS, signal);
      }
      throw new PageDriverError(
        "PAGE_NOT_READY",
        `等待第 ${page} 页超时：${lastMessage}`,
      );
    },

    async capturePage(page) {
      await assertTabActive(tabId, signal);
      const response = await sendMessage<CaptureAttendancePageResponse>(
        tabId,
        { type: CAPTURE_ATTENDANCE_PAGE, page },
        signal,
      );
      const value = unwrap(response);
      return value satisfies CapturedAttendancePage;
    },
  };
}

async function sendMessage<T extends AttendanceContentResponse<unknown>>(
  tabId: number,
  request: { type: string; [key: string]: unknown },
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new CollectionCancelledError();
  const pending = chrome.tabs.sendMessage(tabId, request) as Promise<T>;
  return raceAbort(pending, signal);
}

function unwrap<T>(response: AttendanceContentResponse<T>): T {
  if (!response || typeof response !== "object" || !("ok" in response)) {
    throw new Error("目标页面返回了无法识别的响应。 ");
  }
  if (!response.ok) throw new PageDriverError(response.error.code, response.error.message);
  return response.value;
}

async function assertTabActive(tabId: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new CollectionCancelledError();
  try {
    await chrome.tabs.get(tabId);
  } catch {
    throw new PageDriverError("PAGE_NOT_READY", "目标标签页已关闭。 ");
  }
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id !== tabId) {
    throw new PageDriverError("PAGE_NOT_READY", "目标标签页已切换，请返回该页面后重新开始。 ");
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new CollectionCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new CollectionCancelledError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new CollectionCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "内容脚本暂不可用。";
}

export class PageDriverError extends Error {
  constructor(
    readonly code: TargetPageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PageDriverError";
  }
}

class CollectionCancelledError extends Error {
  constructor() {
    super("采集任务已取消。 ");
    this.name = "CollectionCancelledError";
  }
}
