import {
  TargetPageInspectionError,
  inspectAttendancePage,
} from "./inspect-page";

/** Click only controls already rendered by the target page. Never constructs a business request. */
export function requestAttendancePage(
  input: string | URL,
  documentRef: Document,
  targetPage: number,
): void {
  const current = inspectAttendancePage(input, documentRef);
  if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > current.totalPages) {
    throw new TargetPageInspectionError(
      "PAGINATION_CONTROL_MISSING",
      `目标页码 ${targetPage} 不在有效页数范围内。`,
    );
  }
  if (current.currentPage === targetPage) return;

  const pagination = documentRef.querySelector(".table-pagination");
  const numberedLink = Array.from(
    pagination?.querySelectorAll<HTMLAnchorElement>(".ebs-pager a.page[page]") ?? [],
  ).find(
    (link) =>
      link.getAttribute("page") === String(targetPage) &&
      !isDirectionalPageLink(link),
  );

  if (numberedLink) {
    clickEnabledControl(numberedLink, targetPage);
    return;
  }

  const pageInput = documentRef.querySelector<HTMLInputElement>("#pgnIpt");
  const pageGo = documentRef.querySelector<HTMLElement>("#pageGo");
  if (!pageInput || !pageGo || isDisabled(pageGo)) {
    throw new TargetPageInspectionError(
      "PAGINATION_CONTROL_MISSING",
      `页面没有可用的第 ${targetPage} 页控件。`,
    );
  }

  setNativeInputValue(pageInput, String(targetPage));
  pageGo.click();
}

function isDirectionalPageLink(link: HTMLAnchorElement): boolean {
  const ariaLabel = link.getAttribute("aria-label")?.toLowerCase();
  return ariaLabel === "next" || ariaLabel === "previous";
}

function clickEnabledControl(control: HTMLElement, targetPage: number): void {
  if (isDisabled(control)) {
    throw new TargetPageInspectionError(
      "PAGINATION_CONTROL_MISSING",
      `第 ${targetPage} 页控件当前不可用。`,
    );
  }
  control.click();
}

function isDisabled(control: HTMLElement): boolean {
  return (
    control.matches(":disabled") ||
    control.getAttribute("aria-disabled") === "true" ||
    control.closest("li")?.classList.contains("disabled") === true
  );
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
