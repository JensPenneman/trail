import { createHash } from "node:crypto";
import { constants, type ReadStream } from "node:fs";
import { type FileHandle, lstat, open, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { errorCodes } from "../db/errorChain";
import { MapDataError } from "./mapDataError";

/** A file of an artefact, open for reading. */
export interface ArtefactFile {
  name: string;
  handle: FileHandle;
  bytes: number;
}

/** The artefact's directory as a real path; the operator may name it through a link. */
export async function artefactDirectory(dir: string): Promise<string> {
  try {
    const real = await realpath(dir);
    if ((await stat(real)).isDirectory()) return real;
  } catch {
    // reported below, without the system's wording
  }
  throw new MapDataError(`${dir} is not a directory`);
}

/**
 * Opens the file `name` of the artefact in `dir` (a fixed name, never one
 * from the manifest). It must be a regular file there, not a link (followed,
 * it could be anything on the node) nor a pipe or device (O_NONBLOCK: opening
 * a pipe would wait for a writer), of at most `maxBytes`, and of the size the
 * manifest gives when it gives one.
 */
export async function openArtefactFile(
  dir: string,
  name: string,
  limits: { maxBytes: number; bytes?: number },
): Promise<ArtefactFile> {
  let handle: FileHandle;
  try {
    handle = await open(
      join(dir, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const codes = errorCodes(error);
    if (codes.includes("ENOENT")) throw new MapDataError(`${name} is missing`);
    if (codes.includes("ELOOP")) throw new MapDataError(`${name} is a symbolic link`);
    throw new MapDataError(`${name} cannot be read (${codes[0] ?? "unknown error"})`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new MapDataError(`${name} is not a regular file`);
    if (info.size > limits.maxBytes) {
      throw new MapDataError(`${name} is larger than ${limits.maxBytes} bytes`);
    }
    if (limits.bytes !== undefined && info.size !== limits.bytes) {
      throw new MapDataError(`${name} has ${info.size} bytes, manifest.json says ${limits.bytes}`);
    }
    return { name, handle, bytes: info.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** The bytes of the file from its start; the handle stays open for the next read. */
export const fileChunks = (file: ArtefactFile): ReadStream =>
  file.handle.createReadStream({ start: 0, autoClose: false });

/** The SHA-256 of the whole file, hex, streamed. */
export async function sha256Hex(file: ArtefactFile): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fileChunks(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** A small file of the artefact (manifest.json), whole. */
export async function readArtefactFile(
  dir: string,
  name: string,
  maxBytes: number,
): Promise<Buffer> {
  const file = await openArtefactFile(dir, name, { maxBytes });
  try {
    return await file.handle.readFile();
  } finally {
    await file.handle.close();
  }
}

/** Whether the artefact has a file of this name at all (of any kind: opening it checks the rest). */
export async function hasArtefactFile(dir: string, name: string): Promise<boolean> {
  try {
    await lstat(join(dir, name));
    return true;
  } catch (error) {
    if (errorCodes(error).includes("ENOENT")) return false;
    throw error;
  }
}
