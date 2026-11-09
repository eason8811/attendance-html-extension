import type {
  AttendancePageInspection,
  TargetPageErrorCode,
} from "./inspect-page";

export const INSPECT_ATTENDANCE_PAGE = "attendance:inspect-page" as const;
export const WAIT_FOR_ATTENDANCE_PAGE = "attendance:wait-page" as const;
export const REQUEST_ATTENDANCE_PAGE = "attendance:request-page" as const;
export const CAPTURE_ATTENDANCE_PAGE = "attendance:capture-page" as const;

export interface InspectAttendancePageRequest {
  type: typeof INSPECT_ATTENDANCE_PAGE;
}

export interface WaitForAttendancePageRequest {
  type: typeof WAIT_FOR_ATTENDANCE_PAGE;
  page: number;
  previousTableSignature?: string;
  timeoutMs?: number;
  stableMs?: number;
}

export interface RequestAttendancePageRequest {
  type: typeof REQUEST_ATTENDANCE_PAGE;
  page: number;
}

export interface CaptureAttendancePageRequest {
  type: typeof CAPTURE_ATTENDANCE_PAGE;
  page: number;
}

export type AttendanceContentRequest =
  | InspectAttendancePageRequest
  | WaitForAttendancePageRequest
  | RequestAttendancePageRequest
  | CaptureAttendancePageRequest;

export type AttendanceContentResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: TargetPageErrorCode; message: string } };

export type InspectAttendancePageResponse = AttendanceContentResponse<AttendancePageInspection>;
export type WaitForAttendancePageResponse = AttendanceContentResponse<AttendancePageInspection>;
export type RequestAttendancePageResponse = AttendanceContentResponse<{ requestedPage: number }>;
export type CaptureAttendancePageResponse = AttendanceContentResponse<{
  page: AttendancePageInspection;
  html: string;
}>;

export function isAttendancePageRequest(value: unknown): value is AttendanceContentRequest {
  if (!isRecord(value)) return false;
  if (value.type === INSPECT_ATTENDANCE_PAGE) return true;
  if (value.type === REQUEST_ATTENDANCE_PAGE || value.type === CAPTURE_ATTENDANCE_PAGE) {
    return isPositiveInteger(value.page);
  }
  if (value.type === WAIT_FOR_ATTENDANCE_PAGE) {
    return (
      isPositiveInteger(value.page) &&
      (value.previousTableSignature === undefined ||
        typeof value.previousTableSignature === "string") &&
      (value.timeoutMs === undefined || isPositiveInteger(value.timeoutMs)) &&
      (value.stableMs === undefined || isNonNegativeInteger(value.stableMs))
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
