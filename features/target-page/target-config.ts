export const TARGET_ATTENDANCE_PAGE = {
  protocol: "https:",
  hostname: "ncpc.ibuy.ccb.com",
  port: "9092",
  pathname: "/member/techworkload/queryMonWorkLoadAttendanceDetails.htm",
} as const;

export const TARGET_CONTENT_SCRIPT_MATCH =
  "https://ncpc.ibuy.ccb.com:9092/member/techworkload/queryMonWorkLoadAttendanceDetails.htm*";

export function isTargetAttendanceUrl(input: string | URL): boolean {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return false;
  }

  return (
    url.protocol === TARGET_ATTENDANCE_PAGE.protocol &&
    url.hostname === TARGET_ATTENDANCE_PAGE.hostname &&
    url.port === TARGET_ATTENDANCE_PAGE.port &&
    url.pathname === TARGET_ATTENDANCE_PAGE.pathname
  );
}
