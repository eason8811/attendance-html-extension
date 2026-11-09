type LocalFilePermissionMode = "read" | "readwrite";
type LocalFilePermissionState = "granted" | "denied" | "prompt";

interface FileSystemHandle {
  queryPermission(options?: { mode?: LocalFilePermissionMode }): Promise<LocalFilePermissionState>;
  requestPermission(options?: { mode?: LocalFilePermissionMode }): Promise<LocalFilePermissionState>;
}

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: LocalFilePermissionMode;
  }) => Promise<FileSystemDirectoryHandle>;
}
