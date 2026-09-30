#!/usr/bin/env node
import { runCli } from "./cli/runCli";

process.setSourceMapsEnabled(true);
process.exitCode = await runCli(process.argv.slice(2), import.meta.url);
