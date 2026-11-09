import { describe, expect, it, vi } from "vitest";
import { createAttendanceTaskDirectory } from "../features/filesystem/directory-access";

interface FakeDirectory {
  directory: FileSystemDirectoryHandle;
  files: Map<string, string>;
  directories: Map<string, FakeDirectory>;
  close: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
}

function createFakeDirectory(): FakeDirectory {
  const directories = new Map<string, FakeDirectory>();
  const files = new Map<string, string>();
  const close = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const write = vi.fn(async (content: string | BufferSource) => {
    files.set("page-001.html", String(content));
  });

  const directory = {
    name: "fake-root",
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const existing = directories.get(name);
      if (existing) return existing.directory;
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      const child = createFakeDirectory();
      directories.set(name, child);
      return child.directory;
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (files.has(name)) return fakeFileHandle as unknown as FileSystemFileHandle;
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      files.set(name, "");
      return fakeFileHandle as unknown as FileSystemFileHandle;
    },
    get files() {
      return files;
    },
    get directories() {
      return directories;
    },
  };
  const fakeFileHandle = {
    async createWritable() {
      return { write, close, abort } as unknown as FileSystemWritableFileStream;
    },
  };

  return {
    directory: directory as unknown as FileSystemDirectoryHandle,
    files,
    directories,
    close,
    abort,
    write,
  };
}

describe("createAttendanceTaskDirectory", () => {
  it("creates a timestamped unique directory and closes a UTF-8 page file", async () => {
    const fake = createFakeDirectory();
    const now = new Date(2026, 10, 9, 14, 30, 15);
    const task = await createAttendanceTaskDirectory(
      fake.directory as unknown as FileSystemDirectoryHandle,
      now,
    );
    const created = fake.directories.get(task.name)!;
    const html = "<!DOCTYPE html><html lang=\"zh-CN\"></html>";

    const result = await task.writePage(1, html);

    expect(task.name).toMatch(/^attendance-20261109-143015-/);
    expect(result).toEqual({
      fileName: "page-001.html",
      bytes: new TextEncoder().encode(html).byteLength,
    });
    expect(created.write).toHaveBeenCalledOnce();
    expect(created.close).toHaveBeenCalledOnce();
    expect(created.files.get("page-001.html")).toContain("<!DOCTYPE html>");
  });

  it("refuses to overwrite an existing page file", async () => {
    const fake = createFakeDirectory();
    const task = await createAttendanceTaskDirectory(
      fake.directory as unknown as FileSystemDirectoryHandle,
    );
    const created = fake.directories.get(task.name)!;
    created.files.set("page-001.html", "keep existing content");

    await expect(task.writePage(1, "replace attempt")).rejects.toThrow(/已存在/);
    expect(created.files.get("page-001.html")).toBe("keep existing content");
    expect(created.write).not.toHaveBeenCalled();
  });

  it("aborts a failed writable stream and rejects the page write", async () => {
    const fake = createFakeDirectory();
    const task = await createAttendanceTaskDirectory(
      fake.directory as unknown as FileSystemDirectoryHandle,
    );
    const created = fake.directories.get(task.name)!;
    created.close.mockRejectedValue(new Error("close failed"));

    await expect(task.writePage(1, "html")).rejects.toThrow("close failed");
    expect(created.abort).toHaveBeenCalledOnce();
  });

  it("rejects invalid page numbers before opening a file", async () => {
    const fake = createFakeDirectory();
    const task = await createAttendanceTaskDirectory(
      fake.directory as unknown as FileSystemDirectoryHandle,
    );

    await expect(task.writePage(0, "html")).rejects.toThrow(/正整数/);
  });
});
