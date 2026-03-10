#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerDbCommands } from "./commands/db.js";
import { registerPlaylistCommands } from "./commands/playlists.js";
import { registerLexiconCommands } from "./commands/lexicon.js";
import { registerDownloadCommands } from "./commands/download.js";
import { registerMatchCommands } from "./commands/matches.js";
import { registerSyncCommand } from "./commands/sync.js";
import { setupShutdownHandler, onShutdown } from "./utils/shutdown.js";
import { closeDb } from "./db/client.js";

setupShutdownHandler();
onShutdown(closeDb);

const program = new Command();

program
  .name("crate-sync")
  .description("Manage Spotify playlists and sync them with Lexicon DJ")
  .version("0.1.0");

registerAuthCommands(program);
registerDbCommands(program);
registerPlaylistCommands(program);
registerLexiconCommands(program);
registerDownloadCommands(program);
registerMatchCommands(program);
registerSyncCommand(program);

program.parse();
