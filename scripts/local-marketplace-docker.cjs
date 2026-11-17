const { execFileSync } = require('node:child_process');
const { lstatSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const label = 'fb08.marketplace-payments-local';
const network = 'fb08-marketplace-payments-local';
const dbName = 'marketplace_payments_local';
const db = { name: 'fb08-marketplace-payments-local-db', image: 'postgres:17-alpine', containerPort: '5432/tcp', hostPort: '55449', config: `POSTGRES_DB=${dbName}` };
const rest = { name: 'fb08-marketplace-payments-local-rest', image: 'public.ecr.aws/supabase/postgrest:v14.18', containerPort: '3000/tcp', hostPort: '55450', config: `PGRST_DB_URI=postgres://postgres@${db.name}:5432/${dbName}` };

// Only errors with fixed, presence-only messages are shown to the caller.
class LocalHarnessError extends Error {}

function runDocker(args, { env, input } = {}) {
  return execFileSync('docker', args, { env, input, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
}

function isLocalEndpoint(endpoint) {
  if (process.platform === 'win32') {
    return ['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(endpoint);
  }
  const sockets = [
    '/var/run/docker.sock', '/run/docker.sock',
    join(homedir(), '.docker', 'desktop', 'docker.sock'), join(homedir(), '.docker', 'run', 'docker.sock'),
  ];
  if (process.getuid) sockets.push(`/run/user/${process.getuid()}/docker.sock`);
  const socket = sockets.find(path => endpoint === `unix://${path}`);
  return Boolean(socket && lstatSync(socket, { throwIfNoEntry: false })?.isSocket());
}

function openLocalDocker() {
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME, TEMP: process.env.TEMP, TMP: process.env.TMP,
  };
  // Context inspection reads CLI metadata. It does not contact the selected daemon.
  const context = process.env.DOCKER_CONTEXT;
  const endpoint = (!context && process.env.DOCKER_HOST) || runDocker([
    'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', '--', ...(context ? [context] : []),
  ], { env: { ...env, DOCKER_CONFIG: process.env.DOCKER_CONFIG } }).trim();
  if (!isLocalEndpoint(endpoint)) throw new LocalHarnessError('Refusing Docker endpoint outside an approved local socket or named pipe.');

  // Every daemon command targets this exact endpoint, regardless of ambient CLI settings.
  const args = command => ['--host', endpoint, ...command];
  const run = (command, { input, extraEnv } = {}) => runDocker(args(command), { env: { ...env, ...extraEnv }, input });
  if (run(['version', '--format', '{{.Server.Os}}']).trim() !== 'linux') throw new LocalHarnessError('The owned stack requires a local Linux Docker engine.');
  return { endpoint, args, env, run };
}

function inspectOwnedNetwork(docker) {
  const [info] = JSON.parse(docker.run(['network', 'inspect', network]));
  if (info.Name !== network || info.Labels?.[label] !== 'true' || info.Driver !== 'bridge' || info.Scope !== 'local') {
    throw new LocalHarnessError('Owned local Docker network guard failed.');
  }
  return info.Id;
}

function hasExactBinding(bindings, target) {
  const ports = Object.entries(bindings ?? {});
  if (ports.length !== 1 || ports[0][0] !== target.containerPort) return false;
  const values = ports[0][1];
  return Array.isArray(values) && values.length === 1 && values[0].HostIp === '127.0.0.1' && values[0].HostPort === target.hostPort;
}

function inspectOwnedContainer(docker, target, networkId) {
  const [info] = JSON.parse(docker.run(['container', 'inspect', target.name]));
  const networks = info.NetworkSettings.Networks ?? {};
  const configPrefix = target.config.slice(0, target.config.indexOf('=') + 1);
  const targetSettings = info.Config.Env.filter(value => value.startsWith(configPrefix));
  if (info.Name !== `/${target.name}` || !/^[a-f0-9]{64}$/.test(info.Id) || info.Config.Labels?.[label] !== 'true'
    || info.Config.Image !== target.image || !info.State.Running || info.HostConfig.NetworkMode !== network
    || Object.keys(networks).length !== 1 || networks[network]?.NetworkID !== networkId
    || targetSettings.length !== 1 || targetSettings[0] !== target.config
    || !hasExactBinding(info.HostConfig.PortBindings, target) || !hasExactBinding(info.NetworkSettings.Ports, target)) {
    throw new LocalHarnessError('Owned local Docker container guard failed.');
  }
  return info;
}

module.exports = { db, rest, dbName, network, label, LocalHarnessError, openLocalDocker, inspectOwnedContainer, inspectOwnedNetwork };
