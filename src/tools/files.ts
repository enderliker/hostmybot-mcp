import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import { formatBytes, withToolHandler } from "../format.js";

interface FileObjectAttributes {
  name: string;
  mode: string;
  size: number;
  is_file: boolean;
  is_symlink: boolean;
  modified_at: string;
}

interface FileListResponse {
  data: Array<{ attributes: FileObjectAttributes }>;
}

interface SignedUrlResponse {
  attributes: { url: string };
}

function formatFileEntry(attr: FileObjectAttributes) {
  const type = attr.is_symlink ? "symlink" : attr.is_file ? "file" : "dir";
  return {
    name: attr.name,
    type,
    size: attr.is_file ? formatBytes(attr.size) : undefined,
    size_bytes: attr.is_file ? attr.size : undefined,
    modified_at: attr.modified_at,
    mode: attr.mode,
  };
}

export function registerFileTools(server: McpServer, client: PterodactylClient): void {
  server.registerTool(
    "list_files",
    {
      description: "List files and directories inside a server directory (defaults to '/').",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        directory: z.string().optional().describe("Directory path inside container (default '/')"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, directory = "/" }) => {
      const res = await client.request<FileListResponse>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/list`,
        { query: { directory } },
      );
      const entries = res.data
        .map((item) => formatFileEntry(item.attributes))
        .sort((a, b) => {
          if (a.type === "dir" && b.type !== "dir") return -1;
          if (a.type !== "dir" && b.type === "dir") return 1;
          return a.name.localeCompare(b.name);
        });
      return { directory, count: entries.length, entries };
    }),
  );

  server.registerTool(
    "read_file_contents",
    {
      description:
        "Read the text contents of a file on the server. Automatically truncates very large files to protect context size unless max_chars is increased.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        file: z.string().min(1).describe("File path inside container (e.g. '/package.json')"),
        max_chars: z
          .number()
          .int()
          .min(100)
          .max(500000)
          .optional()
          .describe("Maximum characters to return (default 50000)"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, file, max_chars = 50000 }) => {
      const content = await client.request<string>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/contents`,
        { query: { file }, responseType: "text" },
      );
      if (content.length <= max_chars) {
        return content;
      }
      return `${content.slice(0, max_chars)}\n\n[Truncated at ${max_chars} of ${content.length} chars]`;
    }),
  );

  server.registerTool(
    "write_file",
    {
      description: "Create or overwrite a text file directly on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        file: z.string().min(1).describe("Target file path inside container (e.g. '/index.js')"),
        content: z.string().describe("Full text content to write to the file"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({ server_id, file, content }) => {
      await client.request("POST", `/api/client/servers/${encodeURIComponent(server_id)}/files/write`, {
        query: { file },
        rawBody: content,
        contentType: "text/plain; charset=utf-8",
      });
      return { ok: true, server_id, file, bytes: Buffer.byteLength(content, "utf8") };
    }),
  );

  server.registerTool(
    "upload_file",
    {
      description:
        "Upload a local file (binary or text) from disk to a server directory using Pterodactyl's two-step signed upload URL.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        local_path: z.string().min(1).describe("Absolute or relative path to the local file to upload"),
        directory: z
          .string()
          .optional()
          .describe("Destination directory inside container (default '/')"),
        remote_filename: z
          .string()
          .optional()
          .describe("Optional filename override on the server (defaults to local basename)"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, local_path, directory = "/", remote_filename }) => {
      const resolvedPath = path.resolve(local_path);
      const info = await stat(resolvedPath);
      if (!info.isFile()) {
        throw new Error(`Path is not a regular file: ${resolvedPath}`);
      }
      const bytes = await readFile(resolvedPath);
      const filename = remote_filename?.trim() || path.basename(resolvedPath);

      const uploadMeta = await client.request<SignedUrlResponse>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/upload`,
      );
      await client.uploadFileToSignedUrl(uploadMeta.attributes.url, filename, bytes, directory);

      return {
        ok: true,
        server_id,
        directory,
        filename,
        size: formatBytes(bytes.byteLength),
        size_bytes: bytes.byteLength,
      };
    }),
  );

  server.registerTool(
    "get_download_url",
    {
      description: "Get a temporary signed download URL for a file on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        file: z.string().min(1).describe("File path inside container"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, file }) => {
      const res = await client.request<SignedUrlResponse>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/download`,
        { query: { file } },
      );
      return { file, download_url: res.attributes.url };
    }),
  );

  server.registerTool(
    "create_folder",
    {
      description: "Create a new directory on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        name: z.string().min(1).describe("Folder name to create"),
        root: z.string().optional().describe("Parent directory path (default '/')"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, name, root = "/" }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/create-folder`,
        { body: { root, name } },
      );
      return { ok: true, root, name };
    }),
  );

  server.registerTool(
    "rename_files",
    {
      description: "Rename or move one or more files/folders within a server directory.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        root: z.string().optional().describe("Base directory path (default '/')"),
        files: z
          .array(
            z.object({
              from: z.string().min(1),
              to: z.string().min(1),
            }),
          )
          .min(1)
          .describe("List of { from, to } paths relative to root"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, root = "/", files }) => {
      await client.request(
        "PUT",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/rename`,
        { body: { root, files } },
      );
      return { ok: true, root, count: files.length };
    }),
  );

  server.registerTool(
    "copy_file",
    {
      description: "Duplicate a file on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        location: z.string().min(1).describe("File path to copy (e.g. '/config.json')"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, location }) => {
      await client.request("POST", `/api/client/servers/${encodeURIComponent(server_id)}/files/copy`, {
        body: { location },
      });
      return { ok: true, copied: location };
    }),
  );

  server.registerTool(
    "delete_files",
    {
      description: "Permanently delete one or more files or directories on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        root: z.string().optional().describe("Base directory path (default '/')"),
        files: z.array(z.string().min(1)).min(1).describe("File or folder names relative to root"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, root = "/", files }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/delete`,
        { body: { root, files } },
      );
      return { ok: true, root, deleted: files };
    }),
  );

  server.registerTool(
    "compress_files",
    {
      description: "Compress selected files/folders into a .tar.gz archive on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        root: z.string().optional().describe("Base directory path (default '/')"),
        files: z.array(z.string().min(1)).min(1).describe("Files/folders relative to root"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, root = "/", files }) => {
      const res = await client.request<{ attributes: FileObjectAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/compress`,
        { body: { root, files } },
      );
      return formatFileEntry(res.attributes);
    }),
  );

  server.registerTool(
    "decompress_file",
    {
      description: "Extract an archive (.tar.gz, .zip, etc.) on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        root: z.string().optional().describe("Directory containing the archive (default '/')"),
        file: z.string().min(1).describe("Archive filename relative to root"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, root = "/", file }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/files/decompress`,
        { body: { root, file } },
      );
      return { ok: true, root, extracted: file };
    }),
  );

  server.registerTool(
    "chmod_files",
    {
      description: "Change Unix permissions (mode) on files or folders on the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        root: z.string().optional().describe("Base directory path (default '/')"),
        files: z
          .array(
            z.object({
              file: z.string().min(1),
              mode: z.string().min(3).max(4).describe("Octal permissions, e.g. '755' or '0644'"),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({ server_id, root = "/", files }) => {
      await client.request("POST", `/api/client/servers/${encodeURIComponent(server_id)}/files/chmod`, {
        body: { root, files },
      });
      return { ok: true, root, updated: files.length };
    }),
  );
}
