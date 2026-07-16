#!/usr/bin/env node
/** Stdio JSON-RPC bridge for headless RL simulation in Node. */

import readline from "node:readline";

function parseArgs(argv) {
  let query = process.env.NODE_SIM_QUERY ?? "headless=1&external=1&mode=battle";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--query" && argv[i + 1]) {
      query = argv[++i];
    }
  }
  return query;
}

const query = parseArgs(process.argv);
process.env.NODE_SIM_QUERY = query;

const api = await import("./js/sim/node-entry.js");

function writeResponse(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function handleRequest(req) {
  const { id, method, params = {} } = req;
  try {
    let result;
    switch (method) {
      case "ping":
        result = { ok: true, query };
        break;
      case "reset":
        result = api.rlReset(params);
        break;
      case "step":
        result = api.rlStep(params.action ?? params);
        break;
      case "set_rollout_policy":
        result = api.rlSetRolloutPolicy(params.policy ?? params);
        break;
      case "rollout":
        result = api.rlRollout(params);
        break;
      case "get_ranking":
        result = api.getRanking();
        break;
      case "get_opponent_approvals":
        result = api.getOpponentApprovals(params.playerChar ?? params.player_character);
        break;
      case "decide_headless_action":
        result = api.decideHeadlessAction(params.weights ?? params);
        break;
      case "get_episode_ranking":
        result = api.getEpisodeRanking();
        break;
      case "headless_eval":
        result = api.runHeadlessModelEval(params);
        break;
      default:
        writeResponse({ id, error: `Unknown method: ${method}` });
        return;
    }
    writeResponse({ id, result });
  } catch (err) {
    writeResponse({ id, error: String(err?.message ?? err) });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (err) {
    writeResponse({ id: null, error: `Invalid JSON: ${err.message}` });
    return;
  }
  handleRequest(req);
});

process.stderr.write(`sim-server ready query=${query}\n`);
