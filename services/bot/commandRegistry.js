import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export async function loadCommandsFromDir(commandsObj, commandsDir) {
  const files = fs
    .readdirSync(commandsDir)
    .filter((file) => file.endsWith(".js"));

  for (const file of files) {
    const cmdModule = await import(pathToFileURL(path.join(commandsDir, file)).href);
    const cmd = cmdModule.default;
    if (!cmd || !cmd.name) continue;

    const normalizedName = String(cmd.name).trim().toLowerCase();
    if (!normalizedName) continue;

    cmd.name = normalizedName;
    commandsObj.set(normalizedName, cmd);

    if (cmd.aliases && Array.isArray(cmd.aliases)) {
      const normalizedAliases = cmd.aliases
        .map((alias) => String(alias).trim().toLowerCase())
        .filter((alias) => alias && alias !== normalizedName);
      cmd.aliases = [...new Set(normalizedAliases)];

      for (const alias of cmd.aliases) {
        commandsObj.set(alias, cmd);
      }
    }
  }
}

export function refreshCommandRegistry(commandsObj, client = null) {
  const uniqueCommands = [...new Set(commandsObj.values())];
  const commandNames = uniqueCommands
    .map((cmd) => String(cmd.name || "").toLowerCase())
    .filter(Boolean)
    .sort();

  if (client) {
    client.commands = commandsObj;
  }

  return { uniqueCommands, commandNames };
}

export function suggestCommands(commandNames, input, limit = 4) {
  const keyword = String(input || "").toLowerCase();
  if (!keyword) return commandNames.slice(0, limit);

  const startsWithMatches = commandNames.filter((name) => name.startsWith(keyword));
  if (startsWithMatches.length >= limit) return startsWithMatches.slice(0, limit);

  const includesMatches = commandNames.filter(
    (name) => name.includes(keyword) && !startsWithMatches.includes(name),
  );
  return [...startsWithMatches, ...includesMatches].slice(0, limit);
}

