// The Brew Slack app, made and kept from docs/slack-app-manifest.json with the Slack CLI's own sign-in (`slack login`).
//   node tools/slack-app.mjs create   makes the app without its event and button URLs (Slack checks those at once, and Brew
//                                     can only answer once it has the signing secret), and puts its keys in Secret Manager
//   node tools/slack-app.mjs update   after deploying with the keys: the full manifest, events and Approve included
// The app id is kept in ~/.slack/brew-app.json. Keys never touch the repo or the terminal.
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir(), KEEP = `${HOME}/.slack/brew-app.json`;
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/slack-app-manifest.json', import.meta.url)));
const creds = JSON.parse(fs.readFileSync(`${HOME}/.slack/credentials.json`, 'utf8'));
const acct = Object.values(creds)[0]; if (!acct?.token) throw new Error('Run `slack login` first.');
const call = async (method, body) => {
  const r = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${acct.token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(`${method}: ${j.error} ${JSON.stringify(j.errors || '')}`); return j;
};
const secret = (name, value) => {
  const run = (args) => execFileSync('gcloud', [...args, '--project=squareup-492617', '--data-file=-'], { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
  try { run(['secrets', 'create', name, '--replication-policy=automatic']); } catch { run(['secrets', 'versions', 'add', name]); }
  execFileSync('gcloud', ['secrets', 'add-iam-policy-binding', name, '--project=squareup-492617', '--member=serviceAccount:brew-runtime@squareup-492617.iam.gserviceaccount.com', '--role=roles/secretmanager.secretAccessor'], { stdio: 'ignore' });
};

const step = process.argv[2];
if (step === 'create') {
  const m = structuredClone(manifest); delete m.settings.event_subscriptions; delete m.settings.interactivity;
  const j = await call('apps.manifest.create', { manifest: JSON.stringify(m) });
  fs.writeFileSync(KEEP, JSON.stringify({ app_id: j.app_id, team: acct.team_domain || acct.team_id, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  secret('SLACK_CLIENT_ID', j.credentials.client_id); secret('SLACK_CLIENT_SECRET', j.credentials.client_secret); secret('SLACK_SIGNING_SECRET', j.credentials.signing_secret);
  console.log(`Made the Brew Slack app ${j.app_id} in ${acct.team_domain || acct.team_id}; its keys are in Secret Manager.`);
} else if (step === 'update') {
  const { app_id } = JSON.parse(fs.readFileSync(KEEP, 'utf8'));
  await call('apps.manifest.update', { app_id, manifest: JSON.stringify(manifest) });
  console.log(`Brew Slack app ${app_id}: events and Approve are on.`);
} else console.log('node tools/slack-app.mjs create|update');
