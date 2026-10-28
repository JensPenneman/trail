import { workerCommand } from "./cli/commands/workerCommand";

process.setSourceMapsEnabled(true);
// The worker's entry in development (`npm run dev:worker -w @trail/api`); the image runs `trail worker`.
process.exitCode = await workerCommand(import.meta.url);
