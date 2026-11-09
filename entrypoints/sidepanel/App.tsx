import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  FileCheck2,
  FilePlus2,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  createAttendanceTaskDirectory,
  isDirectoryPickerAvailable,
  pickWritableDirectory,
  queryWritePermission,
  requestWritePermission,
  writeDirectoryProbe,
  type DirectoryPermissionState,
} from "@/features/filesystem/directory-access";
import {
  createChromeTabDriver,
} from "@/features/collection/chrome-tab-driver";
import {
  runAttendanceCollection,
  type CollectionTaskState,
} from "@/features/collection/collection-task";
import type { AttendancePageInspection } from "@/features/target-page/inspect-page";
import {
  INSPECT_ATTENDANCE_PAGE,
  type InspectAttendancePageResponse,
} from "@/features/target-page/inspection-message";
import {
  loadSelectedDirectory,
  saveSelectedDirectory,
} from "@/features/filesystem/directory-store";

type DirectoryStatus =
  | "checking"
  | "unsupported"
  | "not-selected"
  | "ready"
  | "permission-needed"
  | "error";

type TargetStatus = "checking" | "not-target" | "ready" | "error";

type Notice = {
  tone: "success" | "warning" | "error" | "neutral";
  title: string;
  detail: string;
};

const EMPTY_TASK: CollectionTaskState = {
  phase: "idle",
  totalPages: 0,
  currentPage: 0,
  savedPages: 0,
  failedPages: 0,
  taskDirectoryName: null,
  message: "采集任务尚未开始。",
};

function App() {
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [directoryStatus, setDirectoryStatus] =
    useState<DirectoryStatus>("checking");
  const [permission, setPermission] =
    useState<DirectoryPermissionState | null>(null);
  const [busyAction, setBusyAction] = useState<"choose" | "authorize" | "write" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastProbe, setLastProbe] = useState<{ fileName: string; bytes: number } | null>(null);
  const [targetStatus, setTargetStatus] = useState<TargetStatus>("checking");
  const [targetPage, setTargetPage] = useState<AttendancePageInspection | null>(null);
  const [targetDetail, setTargetDetail] = useState("正在检查当前活动标签页。");
  const [taskState, setTaskState] = useState<CollectionTaskState>(EMPTY_TASK);
  const collectionController = useRef<AbortController | null>(null);

  const collectionActive = isCollectionActive(taskState.phase);

  async function refreshTargetPage() {
    setTargetStatus("checking");
    setTargetPage(null);
    setTargetDetail("正在检查当前活动标签页。");

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab?.id === undefined) {
        setTargetStatus("not-target");
        setTargetDetail("没有可检查的活动标签页。");
        return;
      }

      const response = (await chrome.tabs.sendMessage(activeTab.id, {
        type: INSPECT_ATTENDANCE_PAGE,
      })) as InspectAttendancePageResponse;

      if (!response.ok) {
        setTargetStatus(response.error.code === "URL_MISMATCH" ? "not-target" : "error");
        setTargetDetail(response.error.message);
        return;
      }

      setTargetPage(response.value);
      setTargetStatus("ready");
      setTargetDetail(
        response.value.source === "local-snapshot"
          ? "本地 HTML 样例结构已通过检查。静态文件不支持分页采集；请打开在线考勤明细页面进行采集。"
          : "页面地址、标题、表格表头和分页信息均已通过检查。",
      );
    } catch {
      setTargetStatus("not-target");
      setTargetDetail(
        "当前标签页没有返回采集脚本。打开本地样例时，请到 chrome://extensions 的扩展详情启用“允许访问文件网址”，再刷新 HTML；在线页面请确认地址匹配并刷新。",
      );
    }
  }

  useEffect(() => {
    let mounted = true;

    async function restoreDirectory() {
      if (!isDirectoryPickerAvailable()) {
        setDirectoryStatus("unsupported");
        return;
      }

      try {
        const handle = await loadSelectedDirectory();
        if (!mounted) return;
        if (!handle) {
          setDirectoryStatus("not-selected");
          return;
        }

        const currentPermission = await queryWritePermission(handle);
        if (!mounted) return;
        setDirectoryHandle(handle);
        setPermission(currentPermission);
        setDirectoryStatus(currentPermission === "granted" ? "ready" : "permission-needed");
      } catch {
        if (!mounted) return;
        setDirectoryStatus("error");
        setNotice({
          tone: "error",
          title: "无法恢复保存位置",
          detail: "本地目录授权记录读取失败，请重新选择目录。",
        });
      }
    }

    void restoreDirectory();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => () => collectionController.current?.abort(), []);

  useEffect(() => {
    const onTabActivated = () => void refreshTargetPage();
    const onTabUpdated = (_tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (changeInfo.status === "complete" || changeInfo.url) {
        void refreshTargetPage();
      }
    };

    void refreshTargetPage();
    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    window.addEventListener("focus", onTabActivated);

    return () => {
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      window.removeEventListener("focus", onTabActivated);
    };
  }, []);

  async function chooseDirectory() {
    setBusyAction("choose");
    setNotice(null);
    setLastProbe(null);

    try {
      const handle = await pickWritableDirectory();
      await saveSelectedDirectory(handle);
      const currentPermission = await queryWritePermission(handle);
      setDirectoryHandle(handle);
      setPermission(currentPermission);
      setDirectoryStatus(currentPermission === "granted" ? "ready" : "permission-needed");
      setNotice({
        tone: currentPermission === "granted" ? "success" : "warning",
        title: currentPermission === "granted" ? "保存位置已就绪" : "需要确认目录权限",
        detail:
          currentPermission === "granted"
            ? `已选择“${handle.name}”，目录句柄已保存到扩展本地 IndexedDB。`
            : "已记住所选目录。点击“重新授权”后，才能写入文件。",
      });
    } catch (error) {
      if (isAbortError(error)) {
        setNotice({ tone: "neutral", title: "已取消选择", detail: "保存位置没有变化。" });
      } else {
        setNotice({
          tone: "error",
          title: "无法选择目录",
          detail: describeError(error),
        });
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function authorizeDirectory() {
    if (!directoryHandle) return;
    setBusyAction("authorize");
    setNotice(null);

    try {
      const currentPermission = await requestWritePermission(directoryHandle);
      setPermission(currentPermission);
      setDirectoryStatus(currentPermission === "granted" ? "ready" : "permission-needed");
      setNotice(
        currentPermission === "granted"
          ? {
              tone: "success",
              title: "目录权限已恢复",
              detail: `扩展现在可以向“${directoryHandle.name}”写入文件。`,
            }
          : {
              tone: "warning",
              title: "目录权限未获准",
              detail: "浏览器没有授予写入权限。可以重新授权或选择其他目录。",
            },
      );
    } catch (error) {
      setNotice({ tone: "error", title: "重新授权失败", detail: describeError(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function runWriteProbe() {
    if (!directoryHandle) return;
    setBusyAction("write");
    setNotice(null);
    setLastProbe(null);

    try {
      const currentPermission = await queryWritePermission(directoryHandle);
      setPermission(currentPermission);
      if (currentPermission !== "granted") {
        setDirectoryStatus("permission-needed");
        setNotice({
          tone: "warning",
          title: "当前没有写入权限",
          detail: "请先点击“重新授权”，再进行写入检查。",
        });
        return;
      }

      const result = await writeDirectoryProbe(directoryHandle);
      setLastProbe(result);
      setDirectoryStatus("ready");
      setNotice({
        tone: "success",
        title: "目录写入检查通过",
        detail: `已新建 ${result.fileName}（${result.bytes} 字节）。文件只包含探针文本。`,
      });
    } catch (error) {
      setNotice({ tone: "error", title: "目录写入检查失败", detail: describeError(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function startCollection() {
    if (collectionController.current || !directoryHandle) return;
    setNotice(null);
    const controller = new AbortController();
    collectionController.current = controller;
    setTaskState({ ...EMPTY_TASK, phase: "validating", message: "正在检查目录授权和目标页面。" });

    try {
      const currentPermission = await queryWritePermission(directoryHandle).catch(
        () => "denied" as const,
      );
      setPermission(currentPermission);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (currentPermission !== "granted") {
        setDirectoryStatus("permission-needed");
        setTaskState(EMPTY_TASK);
        setNotice({
          tone: "warning",
          title: "需要重新授权保存目录",
          detail: "请先点击“重新授权”，然后再开始采集。",
        });
        return;
      }
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab?.id === undefined) throw new Error("没有可用的活动标签页。");
      const rootDirectory = directoryHandle;
      const result = await runAttendanceCollection({
        driver: createChromeTabDriver(activeTab.id, controller.signal),
        createTaskDirectory: () => createAttendanceTaskDirectory(rootDirectory),
        signal: controller.signal,
        onState: setTaskState,
      });
      setTaskState(result);
      if (result.phase === "completed") {
        setNotice({
          tone: "success",
          title: "页面采集完成",
          detail: `${result.savedPages} 页已写入“${result.taskDirectoryName ?? ""}”。`,
        });
      } else if (result.phase === "failed") {
        setNotice({
          tone: "error",
          title: "采集已停止",
          detail: `${result.message} 已成功保存 ${result.savedPages} 页。`,
        });
      } else if (result.phase === "cancelled") {
        setNotice({
          tone: "neutral",
          title: "采集已取消",
          detail: result.taskDirectoryName
            ? `已成功保存 ${result.savedPages} 页，文件保留在“${result.taskDirectoryName}”。`
            : "采集目录尚未创建，没有生成页面文件。",
        });
      }
    } catch (error) {
      const message = controller.signal.aborted ? "采集已取消。" : describeError(error);
      setTaskState({
        ...EMPTY_TASK,
        phase: controller.signal.aborted ? "cancelled" : "failed",
        message,
      });
      setNotice({
        tone: controller.signal.aborted ? "neutral" : "error",
        title: controller.signal.aborted ? "采集已取消" : "无法开始采集",
        detail: message,
      });
    } finally {
      if (collectionController.current === controller) collectionController.current = null;
      void refreshTargetPage();
    }
  }

  function cancelCollection() {
    collectionController.current?.abort();
  }

  const directoryLabel = getDirectoryLabel(directoryStatus, directoryHandle, permission);
  const pickerAvailable = isDirectoryPickerAvailable();
  const progress = taskState.totalPages > 0
    ? Math.round((taskState.savedPages / taskState.totalPages) * 100)
    : 0;
  const canStartCollection =
    targetStatus === "ready" &&
    targetPage?.source === "online" &&
    directoryHandle !== null &&
    permission === "granted" &&
    busyAction === null &&
    !collectionActive;

  return (
    <main className="panel-shell min-h-screen px-4 py-5 sm:px-5">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <header className="space-y-4 pb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <FileCheck2 aria-hidden="true" size={19} strokeWidth={2.1} />
              </div>
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Attendance / HTML
                </p>
                <h1 className="text-[17px] leading-6 font-semibold tracking-tight">
                  考勤明细采集器
                </h1>
              </div>
            </div>
            <Badge variant="outline" className="gap-1.5 border-primary/20 bg-card/80 text-primary">
              <LockKeyhole aria-hidden="true" size={12} />
              本地处理
            </Badge>
          </div>

          <p className="max-w-sm text-[12px] leading-5 text-muted-foreground">
            逐页保存已登录页面的 DOM 快照。采集期间请保持此侧边栏和目标标签页打开。
          </p>

          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5">
            <WorkflowStep icon={<ScanSearch size={14} />} label="识别页面" state="pending" />
            <ArrowRight aria-hidden="true" size={13} className="text-muted-foreground/60" />
            <WorkflowStep icon={<FolderOpen size={14} />} label="确认目录" state="current" />
            <ArrowRight aria-hidden="true" size={13} className="text-muted-foreground/60" />
            <WorkflowStep icon={<FilePlus2 size={14} />} label="写入快照" state="pending" />
          </div>
        </header>

        <Card size="sm">
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ScanSearch aria-hidden="true" size={16} className="text-primary" />
                <CardTitle className="text-sm">目标页面</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                <Badge
                  variant="outline"
                  className={
                    targetStatus === "ready"
                      ? "status-success border-current/20"
                      : targetStatus === "error"
                        ? "status-warning border-current/20"
                        : "text-muted-foreground"
                  }
                >
                  {targetStatus === "checking"
                    ? "检测中"
                    : targetStatus === "ready"
                      ? targetPage?.source === "local-snapshot"
                        ? "样例已识别"
                        : "已识别"
                      : targetStatus === "error"
                        ? "结构异常"
                        : "未匹配"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="重新检测目标页面"
                  onClick={() => void refreshTargetPage()}
                  disabled={targetStatus === "checking"}
                >
                  <RotateCw aria-hidden="true" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {targetDetail}
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/75 px-3 py-2">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                {targetPage ? "当前页" : "静态样例"}
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {targetPage
                  ? `${targetPage.currentPage} / ${targetPage.totalPages}`
                  : "结构已确认"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/75 px-3 py-2">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                {targetPage ? "记录 / 每页" : "样例分页"}
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {targetPage
                  ? `${targetPage.totalRecords} / ${targetPage.pageSize}`
                  : "23 页 · 50 条/页"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <HardDrive aria-hidden="true" size={16} className="text-primary" />
                <CardTitle className="text-sm">保存位置</CardTitle>
              </div>
              <Badge
                variant="outline"
                className={directoryStatus === "ready" ? "status-success border-current/20" : "text-muted-foreground"}
              >
                {directoryStatus === "checking" ? (
                  <LoaderCircle aria-hidden="true" className="mr-1 animate-spin" size={12} />
                ) : null}
                {directoryLabel}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              目录句柄保存在扩展 IndexedDB；重新打开侧边栏时会重新检查授权。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {directoryHandle ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
                <FolderOpen aria-hidden="true" size={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={directoryHandle.name}>
                  {directoryHandle.name}
                </span>
                {permission === "granted" ? (
                  <Check aria-label="有写入权限" size={15} className="status-success shrink-0" />
                ) : (
                  <CircleAlert aria-label="需要写入授权" size={15} className="status-warning shrink-0" />
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-background/50 px-3 py-3 text-xs text-muted-foreground">
                {pickerAvailable
                  ? "选择一个本机目录。浏览器不会向扩展提供完整绝对路径。"
                  : "当前浏览器上下文没有提供目录选择 API。"}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => void chooseDirectory()}
                disabled={busyAction !== null || collectionActive || !pickerAvailable}
              >
                {busyAction === "choose" ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <FolderOpen aria-hidden="true" />
                )}
                选择目录
              </Button>
              {directoryHandle && permission !== "granted" ? (
                <Button
                  variant="outline"
                  onClick={() => void authorizeDirectory()}
                  disabled={busyAction !== null || collectionActive}
                >
                  {busyAction === "authorize" ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <RotateCw aria-hidden="true" />
                  )}
                  重新授权
                </Button>
              ) : null}
            </div>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void runWriteProbe()}
              disabled={!directoryHandle || permission !== "granted" || busyAction !== null || collectionActive}
            >
              {busyAction === "write" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <FilePlus2 aria-hidden="true" />
              )}
              写入测试文件
            </Button>
            <p className="text-[11px] leading-4 text-muted-foreground">
              点击后会新建随机命名的纯文本文件，不会覆盖已有文件，也不含考勤数据。
            </p>
          </CardContent>
        </Card>

        {notice ? <NoticePanel notice={notice} /> : null}

        <Card size="sm" className="overflow-visible">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck2 aria-hidden="true" size={16} className="text-primary" />
                <CardTitle className="text-sm">采集任务</CardTitle>
              </div>
              <Badge variant="outline">本地 HTML 采集</Badge>
            </div>
            <Progress value={progress} aria-label="采集进度" className="gap-0" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <p className="text-xs text-muted-foreground">
                {getCollectionPhaseLabel(taskState.phase)} · {taskState.message}
              </p>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {taskState.savedPages} / {taskState.totalPages} 页
              </p>
            </div>
            {collectionActive ? (
              <Button className="w-full" variant="destructive" onClick={cancelCollection}>
                <CircleAlert aria-hidden="true" />
                取消采集
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void startCollection()} disabled={!canStartCollection}>
                <FileCheck2 aria-hidden="true" />
                开始采集
              </Button>
            )}
            {taskState.currentPage > 0 && taskState.totalPages > 0 ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                当前处理第 {taskState.currentPage} 页；失败 {taskState.failedPages} 页。
                {taskState.taskDirectoryName ? ` 保存目录：${taskState.taskDirectoryName}` : ""}
              </p>
            ) : null}
            <p className="text-[11px] leading-4 text-muted-foreground">
              总进度只按成功关闭写入流的文件计算；翻页或页面结构无法确认时会停止。
            </p>
          </CardContent>
        </Card>

        <footer className="flex items-start gap-2 px-1 pb-2 text-[11px] leading-4 text-muted-foreground">
          <ShieldCheck aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-primary" />
          <span>页面检查仅在目标在线页面或本地“考勤明细.html”样例上启用；快照仅写入你选择的目录。</span>
        </footer>

        {lastProbe ? <span className="sr-only">上次目录写入测试通过。</span> : null}
      </div>
    </main>
  );
}

function WorkflowStep({
  icon,
  label,
  state,
}: {
  icon: React.ReactNode;
  label: string;
  state: "pending" | "current";
}) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${state === "current" ? "text-primary" : "text-muted-foreground"}`}>
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-background/80 ring-1 ring-border/80">
        {icon}
      </span>
      <span className="truncate text-[10px] font-medium">{label}</span>
    </div>
  );
}

function NoticePanel({ notice }: { notice: Notice }) {
  const Icon =
    notice.tone === "success"
      ? Check
      : notice.tone === "error"
        ? CircleAlert
        : notice.tone === "warning"
          ? CircleAlert
          : ShieldCheck;

  return (
    <Alert
      variant={notice.tone === "error" ? "destructive" : "default"}
      className={
        notice.tone === "success"
          ? "border-primary/20 bg-primary/[0.045]"
          : notice.tone === "warning"
            ? "border-amber-600/20 bg-amber-500/[0.06]"
            : undefined
      }
    >
      <Icon aria-hidden="true" />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.detail}</AlertDescription>
    </Alert>
  );
}

function getDirectoryLabel(
  status: DirectoryStatus,
  handle: FileSystemDirectoryHandle | null,
  permission: DirectoryPermissionState | null,
): string {
  if (status === "checking") return "检查中";
  if (status === "unsupported") return "API 不可用";
  if (status === "error") return "读取失败";
  if (!handle) return "未选择";
  if (permission === "granted") return "可写入";
  return "需授权";
}

function isCollectionActive(phase: CollectionTaskState["phase"]): boolean {
  return ["validating", "preparing", "capturing", "turning", "waiting"].includes(phase);
}

function getCollectionPhaseLabel(phase: CollectionTaskState["phase"]): string {
  switch (phase) {
    case "validating":
      return "校验页面";
    case "preparing":
      return "准备或写入文件";
    case "capturing":
      return "读取页面";
    case "turning":
      return "翻页中";
    case "waiting":
      return "等待页面稳定";
    case "completed":
      return "已完成";
    case "failed":
      return "已停止";
    case "cancelled":
      return "已取消";
    default:
      return "待开始";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "浏览器拒绝了本次文件操作或目录授权。";
    if (error.name === "SecurityError") return "浏览器安全策略阻止了本次文件操作。";
    if (error.name === "QuotaExceededError") return "本地存储空间不足。";
    return `浏览器文件操作失败（${error.name}）。`;
  }
  if (error instanceof Error) return error.message;
  return "发生未知错误。";
}

export default App;
