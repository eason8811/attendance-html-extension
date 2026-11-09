export type DirectoryPermissionState = "granted" | "denied" | "prompt";

export function isDirectoryPickerAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickWritableDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = window.showDirectoryPicker;
  if (!picker) {
    throw new Error("此浏览器没有提供目录选择功能，请使用支持该功能的 Chromium 桌面版。 ");
  }

  return picker.call(window, { mode: "readwrite", id: "attendance-html-collector" });
}

export function queryWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermissionState> {
  return handle.queryPermission({ mode: "readwrite" });
}

export function requestWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermissionState> {
  return handle.requestPermission({ mode: "readwrite" });
}

export async function writeDirectoryProbe(
  directory: FileSystemDirectoryHandle,
): Promise<{ fileName: string; bytes: number }> {
  const fileName = await createUniqueProbeName(directory);
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const content = [
    "Attendance HTML Collector local write check",
    `Created: ${new Date().toISOString()}`,
    "This file contains no attendance records.",
  ].join("\n");

  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Keep the write/close error as the useful failure reason.
    }
    throw error;
  }

  return { fileName, bytes: new TextEncoder().encode(content).byteLength };
}

export interface AttendanceTaskDirectory {
  name: string;
  writePage(page: number, html: string): Promise<{ fileName: string; bytes: number }>;
}

export async function createAttendanceTaskDirectory(
  root: FileSystemDirectoryHandle,
  now = new Date(),
): Promise<AttendanceTaskDirectory> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const name = `attendance-${formatLocalTimestamp(now)}-${crypto.randomUUID().slice(0, 10)}`;
    try {
      await root.getDirectoryHandle(name);
      continue;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const directory = await root.getDirectoryHandle(name, { create: true });
    return {
      name,
      async writePage(page, html) {
        if (!Number.isSafeInteger(page) || page < 1) {
          throw new Error("页码必须是正整数。 ");
        }
        const fileName = `page-${String(page).padStart(3, "0")}.html`;
        try {
          await directory.getFileHandle(fileName);
          throw new Error(`文件 ${fileName} 已存在，为避免覆盖已停止写入。`);
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }

        const fileHandle = await directory.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable({ keepExistingData: false });
        try {
          await writable.write(html);
          await writable.close();
        } catch (error) {
          try {
            await writable.abort();
          } catch {
            // Preserve the original write/close error.
          }
          throw error;
        }

        return { fileName, bytes: new TextEncoder().encode(html).byteLength };
      },
    };
  }

  throw new Error("无法生成不与现有任务目录重名的目录名。 ");
}

async function createUniqueProbeName(directory: FileSystemDirectoryHandle): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const fileName = `attendance-write-check-${timestamp}-${suffix}.txt`;

    try {
      await directory.getFileHandle(fileName);
    } catch (error) {
      if (isNotFoundError(error)) return fileName;
      throw error;
    }
  }

  throw new Error("无法生成一个不与现有文件重名的测试文件名。 ");
}

function formatLocalTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    part(date.getMonth() + 1),
    part(date.getDate()),
    "-",
    part(date.getHours()),
    part(date.getMinutes()),
    part(date.getSeconds()),
  ].join("");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}
