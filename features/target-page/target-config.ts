export const TARGET_ATTENDANCE_PAGE = {
  protocol: "https:",
  hostname: "ncpc.ibuy.ccb.com",
  port: "9092",
  pathname: "/member/techworkload/queryMonWorkLoadAttendanceDetails.htm",
} as const;

export const TARGET_CONTENT_SCRIPT_MATCH =
  "https://ncpc.ibuy.ccb.com:9092/member/techworkload/queryMonWorkLoadAttendanceDetails.htm*";

export const TARGET_CONTENT_SCRIPT_MATCHES = [
  TARGET_CONTENT_SCRIPT_MATCH,
  "file:///*",
] as const;

const LOCAL_ATTENDANCE_SNAPSHOT_NAME = "考勤明细.html";

export function isLocalAttendanceSnapshotUrl(input: string | URL): boolean {
  const url = parseUrl(input);
  if (!url || url.protocol !== "file:") return false;

  const encodedName = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(encodedName) === LOCAL_ATTENDANCE_SNAPSHOT_NAME;
  } catch {
    return false;
  }
}

export function isTargetAttendanceUrl(input: string | URL): boolean {
  const url = parseUrl(input);
  if (!url) return false;

  return isOnlineAttendanceUrl(url) || isLocalAttendanceSnapshotUrl(url);
}

function isOnlineAttendanceUrl(url: URL): boolean {
  return (
    url.protocol === TARGET_ATTENDANCE_PAGE.protocol &&
    url.hostname === TARGET_ATTENDANCE_PAGE.hostname &&
    url.port === TARGET_ATTENDANCE_PAGE.port &&
    url.pathname === TARGET_ATTENDANCE_PAGE.pathname
  );
}

function parseUrl(input: string | URL): URL | null {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }
  return url;
}
