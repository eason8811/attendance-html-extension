import { isTargetAttendanceUrl } from "@/features/target-page/target-config";
import {
  TargetPageInspectionError,
  inspectAttendancePage,
  waitForAttendancePage,
} from "@/features/target-page/inspect-page";
import {
  isAttendancePageRequest,
  type AttendanceContentResponse,
  type AttendanceContentRequest,
} from "@/features/target-page/inspection-message";
import { requestAttendancePage } from "@/features/target-page/pagination-adapter";
import { serializeAttendanceDocument } from "@/features/target-page/snapshot";

export default defineContentScript({
  matches: [
    "https://ncpc.ibuy.ccb.com:9092/member/techworkload/queryMonWorkLoadAttendanceDetails.htm*",
  ],
  main() {
    if (!isTargetAttendanceUrl(location.href)) return;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isAttendancePageRequest(message)) return;

      void handlePageRequest(message)
        .then((response) => sendResponse(response))
        .catch((error: unknown) => sendResponse(toErrorResponse(error)));

      return true;
    });
  },
});

async function handlePageRequest(
  request: AttendanceContentRequest,
): Promise<AttendanceContentResponse<unknown>> {
  switch (request.type) {
    case "attendance:inspect-page":
      return { ok: true, value: inspectAttendancePage(location.href, document) };
    case "attendance:wait-page":
      return {
        ok: true,
        value: await waitForAttendancePage(location.href, document, {
          expectedPage: request.page,
          previousTableSignature: request.previousTableSignature,
          timeoutMs: request.timeoutMs ?? 1_500,
          stableMs: request.stableMs ?? 400,
        }),
      };
    case "attendance:request-page":
      requestAttendancePage(location.href, document, request.page);
      return { ok: true, value: { requestedPage: request.page } };
    case "attendance:capture-page": {
      const page = inspectAttendancePage(location.href, document);
      if (page.currentPage !== request.page) {
        throw new TargetPageInspectionError(
          "PAGE_NUMBER_MISMATCH",
          `请求保存第 ${request.page} 页，但页面当前为第 ${page.currentPage} 页。`,
        );
      }
      const { html } = serializeAttendanceDocument(document);
      return { ok: true, value: { page, html } };
    }
  }
}

function toErrorResponse(error: unknown): AttendanceContentResponse<never> {
  return {
    ok: false,
    error:
      error instanceof TargetPageInspectionError
        ? { code: error.code, message: error.message }
        : { code: "PAGE_NOT_READY", message: "检查页面结构时发生未知错误。" },
  };
}
